---
name: "impact-and-overlays"
description: "Frame-exact impact looks and original procedural overlay recipes, with the existing montage effect controls."
---
# Impact frames and overlay pack

addImpactFrame takes at plus exactly one of frames or duration. frames counts PROJECT frames. duration is seconds snapped to the project grid. One frame through 30 seconds is supported. At 60 fps, frames:2 is 1/30 second. Presets: invert, black-white, posterize, manga. intensity 0..1 mixes the stylized image with the original, threshold .05.. .95 sets ink/BW tone, levels 2..8 sets posterization, speedLines 0..1 draws radial lines around centerX/Y, and flash 0..1 mixes white into the held look. Flash lasts the chosen range; use a separate shorter FX for a pulse. configureImpactFrame changes the existing FX; moving or deleting its clip changes the cue or removes it. Footage effects and sound outside its range stay intact.

Example on a verified hit at 3.2 seconds: addImpactFrame {at:3.2,frames:2,preset:"manga",threshold:.48,levels:3,speedLines:.3,flash:.08}. Inspect those full-resolution frames, especially the player's silhouette and weapon edges.

addOverlay takes at plus frames or duration, and preset light-leak, film-burn, lens-flare, dust or grain. blend is screen, add or overlay; intensity is 0..1. color is a hex color; seed makes the procedural texture reproducible, speed 0 freezes it, and fade is the fraction of duration faded at EACH edge (0.. .5). The implementation is original procedural drawing, with no scraped assets or third-party texture pack. configureOverlay edits an existing overlay. For a .6-second transition over a cut at 4 seconds, set at:3.7,duration:.6,preset:"light-leak",blend:"screen",intensity:.45. Use overlay blend for neutral grain, screen/add for light. Avoid a one-frame overlay with a fade envelope: choose fade:0 for a single-frame stamp.

Existing tools:
- addTimedEffect preset flash, shake, punch or zoom-blur; configureTimedEffect accepts flash strength/attack/release and shake strength/speed/direction. Flash attack and release are fractions of the FX duration; punch attack/release are seconds. A one-frame accent should use addImpactFrame rather than a pulse with zero brightness at its first sample.
- setVisualEffects zoomBlur {enabled:true,amount:.12,centerX:.5,centerY:.5}; animateEffect can ramp zoomBlur.amount back to zero around the hit.
- setVisualEffects glitch {enabled:true,intensity:.15,blockSize:24,rgbSplit:4}; keep it brief with animateEffect or a split footage span.
- setVisualEffects bloom {enabled:true,amount:.4,threshold:.7,radius:18} for highlight glow.
- setVisualEffects lensDistortion {enabled:true,amount:0,fringing:2} for lens fringing without warping. Keyframe lensDistortion.fringing for a short pulse.
