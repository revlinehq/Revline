# Landing demonstration footage

## Formula One racing hero

The landing hero and the fixed F1 recording demo use **F1 × NO BATIDAO** by Prime Editx (Suhrid Singh): https://www.youtube.com/watch?v=PWbO4NSObPo . The edit uses footage from *F1: The Movie* and the music *No Batidao* by ZXKAI. No Creative Commons or commercial reuse license is asserted for this source.

The requested local MP4 plays through Revline's native composition player. There is no YouTube iframe, runtime YouTube API, or provider branding overlay. Source attribution is in `public/demo/f1-edit/credits.html`.

`public/demo/f1-edit/source.mp4` is the full prepared edit. Its original audio is extracted to `source.m4a` for linked timeline audio. `landing.mp4` is a silent 13.2-second excerpt for the landing hero. The surrounding conversation and staged timeline are a prepared interface illustration, with no live AI calls.

`/editor/demo/hormozi-take-1` and `/editor/demo/f1-take-1` use the fixed F1 edit. The prior interview remains at `/editor/demo/interview-take-1`. Other demo routes keep their original sources.

The previous racing montage and its CC BY-SA source attribution remain in `public/demo/racing/` for the standalone racing demo.

## NASA launch

The workflow cards and space-footage feature examples use NASA's **Artemis II launch live**, released April 1, 2026 by NASA Goddard Space Flight Center.

- Official source and credits: https://svs.gsfc.nasa.gov/31385/
- Official metadata: https://svs.gsfc.nasa.gov/api/31385/
- Caption-free multicamera source: https://svs.gsfc.nasa.gov/vis/a030000/a031300/a031385/Artemis-2-launch-short-1080.mp4
- Source properties: 147.030229 seconds, 1920 × 1080, H.264, 60000/1001 fps. The bundled derivatives have no audio stream.
- SVS reuse guidance: https://svs.gsfc.nasa.gov/help/
- NASA media-use guidance: https://www.nasa.gov/nasa-brand-center/images-and-media/

SVS describes its material as public domain unless separately marked. The selected source page lists NASA production credits and has no separate third-party footage or music restriction. Only the visuals are used here. NASA's embedded footage marks remain in their original context; no NASA endorsement of Revline is asserted. Landing components credit **Footage: NASA** and link to the source page.

`public/demo/landing/nasa.mp4` is a 12-second, muted, 1280 × 720, 30 fps H.264 montage, encoded with CRF 27 and fast-start metadata. Its three clean shots are:

| Output range | Source range | Content |
| --- | --- | --- |
| 0–4.8 s | 3–7.8 s | Rocket on the pad |
| 4.8–7.7 s | 22.05–24.95 s | Liftoff and exhaust |
| 7.7–12 s | 45.12–49.42 s | Tracking view of the climb |

The space examples use editorial titles, not an invented transcript. Source audio and spoken launch commentary are omitted. The source camera already follows the rocket during the climb; the portrait example uses a fixed central crop rather than pretending to run object tracking.

`nasa-beats.mp4` is a separate 6-second montage with twelve genuine shot changes on a 0.5-second grid (120 BPM). Each segment takes 0.5 seconds from `nasa.mp4`, starting at 0.2, 4.9, 8.2, 1.2, 5.4, 8.8, 2.2, 5.9, 9.4, 3.2, 6.4, and 10 seconds. This is a prepared cut-rhythm example, without a soundtrack or a claim of live beat analysis.

WebP stills are extracted from the corresponding local derivative:

- `nasa.webp`: space-feature poster, 6 seconds, width 960.
- `nasa-shot-1.webp`: pad, 1 second, width 560.
- `nasa-shot-2.webp`: liftoff, 6 seconds, width 560.
- `nasa-shot-3.webp`: climb, 10 seconds, width 560.
- `nasa-beats.webp`: rhythm example poster, 0.6 seconds, width 960.


One canonical launch file is shared across examples. There are no duplicate video files for title, moment, or subject aliases. Both videos omit audio, use yuv420p for browser compatibility, and place MP4 metadata before media data for progressive playback.

## Existing interview caption example

The caption feature reuses the repository's existing `public/demo/hormozi-distractions.mp4`, its checked-in word timings, and its waveform. `captions.webp` is a still from that asset at 3.4 seconds, width 960. Existing source provenance in `lib/editor/hormozi-demo.ts` identifies Modern Wisdom episode 610, 19:07–19:52: https://www.youtube.com/watch?v=JuNOFW-oVn8 . This README does not assert a new stock or Creative Commons license for that existing interview material.
