# Pen concepts

These are editable design previews, separate from the editor's released effect catalog.

- `nQJ3S`: six text looks. The original row `raHDX` contains Clean lower third, Difference title, and Neon echo. The additional row `rQ9Dj` contains Standard, Outline, and Mono note.
- `h4PBZa`: Crossfade, Wipe, and Slide between two sample scenes.
- `Q3CYV`: three Effects layouts with alternate Tools / My media navigation. `DYY8t` is the selected category rail layout.

The first three text looks and the transition samples use `motion-demo.glsl` with a four-second loop. `u_phase = -1` uses the live clock; values from 0 to 1 hold a frame. Exported board PNGs hold a representative frame. The three additional text looks are static typography options.

The SVGs keep the title artwork editable. PNGs are matching shader textures because the canvas shader sampler requires a file URL for local images. The canvas references the existing Unsplash sample photos already used in the design file; these are illustrative samples, not customer footage.

The template shader demonstrates the intended look. Application integration should use Remotion presentation components driven by the editor's playback and export clock.
