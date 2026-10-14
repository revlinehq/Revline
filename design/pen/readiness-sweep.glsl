precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/** @label Highlight @color @default #ededed */
uniform vec3 u_highlight;
void main() {
  float x = gl_FragCoord.x / u_resolution.x;
  float center = mod(u_time * 0.38, 1.5) - 0.25;
  float sweep = exp(-pow((x - center) / 0.16, 2.0));
  gl_FragColor = vec4(u_highlight, 0.10 + sweep * 0.85);
}
