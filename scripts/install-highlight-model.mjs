import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
const path =
  process.env.HIGHLIGHT_MODEL_PATH || ".data/highlight-models/yamnet.tflite";
const checksum =
  "4d8b4a53282dc83ef04e3e7dbc4fbc98082e34e44ed798e16c3a0cdd4c584faf";
const valid = (bytes) =>
  createHash("sha256").update(bytes).digest("hex") === checksum;
if (
  !(await readFile(path)
    .then(valid)
    .catch(() => false))
) {
  const response = await fetch(
    "https://storage.googleapis.com/mediapipe-models/audio_classifier/yamnet/float32/1/yamnet.tflite",
  );
  if (!response.ok)
    throw new Error(`YAMNet download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes)) throw new Error("YAMNet checksum mismatch");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}
console.log("YAMNet CPU model ready (Google AudioSet model, Apache-2.0).");
