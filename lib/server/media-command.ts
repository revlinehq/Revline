import { execFile, type ExecFileOptions } from 'node:child_process';
import { promisify } from 'node:util';
import { retryMediaOperation } from '../media-analysis/network';
import { AnalysisError } from '../media-analysis/errors';

const execute = promisify(execFile);
/** HTTP reconnects resume the same byte stream; never treat a normal EOF as a failure. */
export function mediaInputOptions(input: string) {
  return /^https?:\/\//.test(input) ? ['-rw_timeout', '15000000', '-reconnect', '1', '-reconnect_on_network_error', '1', '-reconnect_on_http_error', '408,429,5xx', '-reconnect_streamed', '1', '-reconnect_delay_max', '4'] : [];
}

export function runMediaCommand(file: string, args: string[], options: ExecFileOptions & { encoding: 'buffer' }): Promise<{ stdout: Buffer; stderr: Buffer }>;
export function runMediaCommand(file: string, args: string[], options: ExecFileOptions): Promise<{ stdout: string; stderr: string }>;
export async function runMediaCommand(file: string, args: string[], options: ExecFileOptions): Promise<{ stdout: string | Buffer; stderr: string | Buffer }> {
  const remote = (file === 'ffmpeg' || file === 'ffprobe') && args.some(arg => /^https?:\/\//.test(arg));
  if (!remote) return execute(file, args, options);
  const prepared = args.flatMap((arg, index) => arg === '-i' ? [...mediaInputOptions(args[index + 1]), arg]
    : file === 'ffprobe' && /^https?:\/\//.test(arg) && args[index - 1] !== '-i' ? [...mediaInputOptions(arg), arg] : [arg]);
  return retryMediaOperation(async () => {
    try { return await execute(file, prepared, options); }
    catch (error) {
      const detail = error as { killed?: boolean; code?: string | number | null; signal?: string };
      if (!options.signal?.aborted && detail.killed && detail.code === null && detail.signal === 'SIGTERM') throw new AnalysisError('The source media read timed out. Retry this step when the connection recovers.', 504);
      throw error;
    }
  }, options.signal);
}
