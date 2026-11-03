import type { ConvexHttpClient } from 'convex/browser';
import { api } from '../../convex/_generated/api';
import type { MediaWorkItem } from '../../convex/mediaTasks';
import { MEDIA_PROCESSOR_VERSION } from '../media-analysis/processor-version';
import { cacheJson } from '../media-analysis/frame-cache';

type Reservation = { state: 'hit'; key: string; r2Key: string; url: string } | { state: 'wait'; key: string } | { state: 'miss'; key: string; r2Key: string; uploadToken: string; uploadUrl: string };
/** Per-task promises also coalesce duplicate times inside one request. No pixels enter Convex. */
export class FrameCache {
  private pending = new Map<string, Promise<Buffer>>();
  constructor(private client: ConvexHttpClient, private task: Pick<MediaWorkItem, 'taskId' | 'leaseToken'>, private signal: AbortSignal) {}

  bytes(output: object, contentType: 'image/png' | 'application/json' | 'application/octet-stream', produce: () => Promise<Buffer>): Promise<Buffer> {
    const key = cacheJson(output), saved = this.pending.get(key);
    if (saved) return saved;
    const pending = this.resolve(output, contentType, produce);
    this.pending.set(key, pending);
    return pending;
  }
  /** Atomic reservations preserve grouped captures while decoding only the missing frames. */
  async batch(outputs: object[], produce: (missing: number[]) => Promise<Buffer[]>): Promise<Buffer[]> {
    const unique = [...new Map(outputs.map((output,index)=>[cacheJson(output),{output,index}])).values()];
    const fresh = unique.filter(({output})=>!this.pending.has(cacheJson(output)));
    if (fresh.length) {
      const reservations = await this.client.mutation(api.frameCache.reserveBatch,{...this.task,processorVersion:MEDIA_PROCESSOR_VERSION,outputs:fresh.map(item=>item.output)}) as Reservation[];
      const missing = fresh.flatMap((item,index)=>reservations[index].state==='miss'?[item.index]:[]);
      const captured = missing.length ? produce(missing) : Promise.resolve([] as Buffer[]);
      let fallback = captured.then(()=>{});
      for (const [index,{output,index:frame}] of fresh.entries()) {
        const reservation=reservations[index];
        const generate=async()=>{
          const images=await captured,slot=missing.indexOf(frame);
          if(slot>=0)return images[slot];
          const capture=fallback.then(()=>produce([frame]));
          fallback=capture.then(()=>{},()=>{});
          return (await capture)[0];
        };
        const pending=reservation.state==='wait'?this.resolve(output,'image/png',generate):this.consume(reservation,output,'image/png',generate);
        this.pending.set(cacheJson(output),pending);
      }
    }
    return Promise.all(outputs.map(output=>this.pending.get(cacheJson(output))!));
  }
  async json<T>(output: object, produce: () => Promise<T>): Promise<T> {
    return JSON.parse((await this.bytes(output, 'application/json', async () => Buffer.from(JSON.stringify(await produce())))).toString('utf8')) as T;
  }
  private async resolve(output: object, contentType: string, produce: () => Promise<Buffer>): Promise<Buffer> {
    const started = Date.now(), deadline = started + 14 * 60_000;
    let reservation: Reservation;
    for (;;) {
      this.signal.throwIfAborted();
      reservation = await this.client.mutation(api.frameCache.reserve, { ...this.task, output, processorVersion:MEDIA_PROCESSOR_VERSION }) as Reservation;
      if (reservation.state !== 'wait') break;
      if (Date.now() >= deadline) throw new Error('The shared frame decode did not finish. Retry this read.');
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(this.signal.reason); };
        const timer = setTimeout(() => { this.signal.removeEventListener('abort', abort); resolve(); }, 250);
        this.signal.addEventListener('abort', abort, { once: true });
      });
    }
    return this.consume(reservation,output,contentType,produce,started);
  }
  private async consume(reservation:Exclude<Reservation,{state:'wait'}>,output:object,contentType:string,produce:()=>Promise<Buffer>,started=Date.now()):Promise<Buffer> {
    if (reservation.state === 'hit') {
      const response = await fetch(reservation.url, { redirect: 'error', signal: this.signal });
      if (response.ok) {
        const bytes = Buffer.from(await response.arrayBuffer());
        console.info('[frame-cache]', { kind: (output as {kind?: string}).kind, outcome: 'hit', ms: Date.now() - started });
        return bytes;
      }
      // A missing object is a miss, never stale evidence. Invalidate through the authorized lease.
      await this.client.mutation(api.frameCache.evict, { ...this.task, output, key: reservation.key, r2Key: reservation.r2Key, processorVersion:MEDIA_PROCESSOR_VERSION });
      return this.resolve(output, contentType, produce);
    }
    try {
      const bytes = await produce();
      this.signal.throwIfAborted();
      const response = await fetch(reservation.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType, 'Content-Length': String(bytes.length) }, body: new Uint8Array(bytes), signal: this.signal });
      if (!response.ok) throw new Error(`Frame cache upload failed (${response.status}).`);
      await this.client.mutation(api.frameCache.finish, { ...this.task, key: reservation.key, r2Key: reservation.r2Key, uploadToken: reservation.uploadToken });
      console.info('[frame-cache]', { kind: (output as {kind?: string}).kind, outcome: 'miss', bytes: bytes.length, ms: Date.now() - started });
      return bytes;
    } catch (error) {
      await this.client.mutation(api.frameCache.finish, { ...this.task, key: reservation.key, r2Key: reservation.r2Key, uploadToken: reservation.uploadToken, failed: true }).catch(() => {});
      throw error;
    }
  }
}
