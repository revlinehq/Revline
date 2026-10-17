import type { MediaAsset } from './types';
export async function inspectMedia(file:File,onThumbnail?:(image:Blob)=>void):Promise<{kind:MediaAsset['kind'];duration?:number;width?:number;height?:number}> {
  const kind=file.type.split('/')[0];if(kind!=='video'&&kind!=='audio'&&kind!=='image')throw new Error(`“${file.name}” is not a supported media file.`);
  if(!file.size)throw new Error('This file is empty.');
  const url=URL.createObjectURL(file);
  try {
    if(kind==='image')return await new Promise((resolve,reject)=>{const image=new Image();image.onload=()=>{if(!image.naturalWidth||!image.naturalHeight){reject(new Error('This image has no readable dimensions.'));return;}resolve({kind,width:image.naturalWidth,height:image.naturalHeight});};image.onerror=()=>reject(new Error('This image could not be read. Try JPG, PNG, or WebP.'));image.src=url;});
    return await new Promise((resolve,reject)=>{
      const element=document.createElement(kind);let finished=false,capturing=false;
      element.preload=onThumbnail&&kind==='video'?'auto':'metadata';
      const cleanup=()=>{clearTimeout(timer);element.onloadedmetadata=null;element.onloadeddata=null;element.onerror=null;element.removeAttribute('src');element.load();};
      const fail=(message:string)=>{if(finished)return;finished=true;cleanup();reject(new Error(message));};
      const timer=setTimeout(()=>fail('Media metadata timed out. Try an H.264 MP4 or MP3.'),15000);
      const finish=()=>{if(finished)return;finished=true;const video=element as HTMLVideoElement;const metadata={kind:kind==='video'&&!video.videoWidth&&!video.videoHeight?'audio' as const:kind as MediaAsset['kind'],duration:element.duration,...(kind==='video'&&video.videoWidth>0&&video.videoHeight>0?{width:video.videoWidth,height:video.videoHeight}:{})};cleanup();resolve(metadata);};
      element.onloadedmetadata=()=>{
        if(!Number.isFinite(element.duration)||element.duration<=0){fail('This file has no readable duration.');return;}
        const video=element as HTMLVideoElement;
        if(kind==='video'&&(video.videoWidth===0)!==(video.videoHeight===0)){fail('This video has incomplete dimensions. Try an H.264 MP4.');return;}
        if(!onThumbnail||kind!=='video'||!video.videoWidth){finish();return;}
        const capture=()=>{
          if(finished||capturing)return;capturing=true;
          try{const canvas=document.createElement('canvas'),scale=Math.min(352/video.videoWidth,352/video.videoHeight,1);canvas.width=Math.max(1,Math.round(video.videoWidth*scale));canvas.height=Math.max(1,Math.round(video.videoHeight*scale));
            canvas.getContext('2d')?.drawImage(video,0,0,canvas.width,canvas.height);canvas.toBlob(blob=>{if(finished)return;if(blob)onThumbnail(blob);finish();},'image/jpeg',.7);
          }catch{finish();}
        };
        if(element.readyState>=2)capture();else element.onloadeddata=capture;
      };
      element.onerror=()=>fail('Your browser cannot decode this media. Try an H.264 MP4, WebM, or MP3.');element.src=url;
    });
  }finally{URL.revokeObjectURL(url);}
}
export type UploadedPart = { partNumber: number; etag: string };
export function uploadPart(url: string, blob: Blob, onProgress: (bytes: number) => void, signal?: AbortSignal): Promise<UploadedPart> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const fail = (error: unknown) => { cleanup(); reject(error); };
    request.open('PUT', url); request.setRequestHeader('Content-Type', 'application/octet-stream');
    request.timeout = 10 * 60_000;
    request.upload.onprogress = event => onProgress(event.loaded);
    request.onload = () => {
      cleanup();
      if (request.status < 200 || request.status >= 300) { reject(new Error('Upload failed. Please try again.')); return; }
      try { const result = JSON.parse(request.responseText) as UploadedPart; if (!result.etag || !Number.isInteger(result.partNumber)) throw new Error(); resolve(result); }
      catch { reject(new Error('Cloudflare did not confirm this upload part.')); }
    };
    request.onerror = () => fail(new Error('Upload connection interrupted. Please try again.'));
    request.ontimeout = () => fail(new Error('The upload connection timed out. Please try again.'));
    request.onabort = () => fail(signal?.reason ?? new Error('Upload cancelled.'));
    signal?.addEventListener('abort', abort, { once: true });
    request.send(blob);
  });
}
export async function uploadMultipart(file: File, partSize: number, getUrl: (partNumber: number) => Promise<string>, onProgress: (percent: number) => void) {
  if (!Number.isFinite(partSize) || partSize <= 0) throw new Error('Invalid upload part size.');
  const partCount = Math.ceil(file.size / partSize), parts: UploadedPart[] = new Array(partCount);
  const loaded = new Array<number>(partCount).fill(0), controller = new AbortController();
  let nextPart = 0, loadedBytes = 0, lastPercent = -1;
  const report = (index: number, bytes: number, size: number) => {
    if (controller.signal.aborted) return;
    // Keep each part's high-water mark across retries; retransmitted bytes never
    // count twice or make the progress bar jump backwards.
    const amount = Math.max(loaded[index], Math.min(bytes, size));
    loadedBytes += amount - loaded[index]; loaded[index] = amount;
    const percent = Math.min(99, Math.round(loadedBytes / file.size * 100));
    if (percent !== lastPercent) { lastPercent = percent; onProgress(percent); }
  };
  try {
    await Promise.all(Array.from({ length: Math.min(3, partCount) }, async () => {
      while (!controller.signal.aborted) {
        const index = nextPart++;
        if (index >= partCount) return;
        const partNumber = index + 1, offset = index * partSize;
        const blob = file.slice(offset, Math.min(file.size, offset + partSize));
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const url = await getUrl(partNumber);
            const uploaded = await uploadPart(url, blob, bytes => report(index, bytes, blob.size), controller.signal);
            if (uploaded.partNumber !== partNumber) throw new Error('Cloudflare confirmed the wrong upload part.');
            parts[index] = uploaded; report(index, blob.size, blob.size); break;
          } catch (error) {
            if (controller.signal.aborted || attempt === 2) throw error;
            await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt));
            if (controller.signal.aborted) throw controller.signal.reason;
          }
        }
      }
    }));
  } catch (error) {
    // Stop sibling PUTs before uploadSourceFile releases the multipart lease.
    controller.abort(error); throw error;
  }
  onProgress(100); return parts;
}
