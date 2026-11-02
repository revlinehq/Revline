import { z } from 'zod';

const manifestSchema = z.object({
  asset: z.object({ version: z.string() }),
  buffers: z.array(z.object({ uri: z.string().optional() })).optional(),
  images: z.array(z.object({ uri: z.string().optional() })).optional(),
});

/** A GLB's JSON chunk or a glTF document, shared by preparation and the sandbox loader. */
export function modelResourceUris(data: ArrayBuffer) {
  const view = new DataView(data);
  const binary = data.byteLength >= 20 && view.getUint32(0, true) === 0x46546c67;
  const json = new TextDecoder().decode(binary ? new Uint8Array(data, 20, view.getUint32(12, true)) : data);
  const manifest = manifestSchema.parse(JSON.parse(json));
  return [...new Set([...(manifest.buffers ?? []), ...(manifest.images ?? [])].flatMap(item => item.uri && !item.uri.startsWith('data:') ? [item.uri] : []))];
}
