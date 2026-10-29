// Transition clip "Zoom into composer" (2.85 to 3.75 s, on the layer above the beats). The camera
// flies into the assembly beat's composer while that beat keeps playing its own fades underneath,
// then hands over to the chat beat, whose first frame is the same framing.
import { Transition } from 'revline';

export default function ZoomIntoComposer() {
  return <Transition kind="zoom-into" target="composer" origin={[.5, .589]} at={[.5, .56]} zoom={1.75} fade={[.9, 1]} />;
}
