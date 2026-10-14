precision mediump float;
/** @resolution */
uniform vec2 u_resolution;
/** @time */
uniform float u_time;
/**
 * @label Preview mode
 * @default 0
 * @range 0, 6
 */
uniform float u_mode;
/**
 * @label Still frame (-1 animates)
 * @default -1
 * @range -1, 1
 */
uniform float u_phase;
/** @label First image aspect ratio @default 1.5 */
uniform float u_aspect_a;
/** @label Second image aspect ratio @default 1.5 */
uniform float u_aspect_b;
/** @label First scene */
uniform sampler2D u_scene_a;
/** @label Second scene */
uniform sampler2D u_scene_b;
/** @label Title artwork */
uniform sampler2D u_title;

vec2 coverUv(vec2 uv, float aspect) {
  float target = u_resolution.x / u_resolution.y;
  vec2 crop = vec2(min(1.0, target / aspect), min(1.0, aspect / target));
  return (uv - 0.5) * crop + 0.5;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  uv.y = 1.0 - uv.y;
  float phase = u_phase >= 0.0 ? u_phase : mod(u_time, 4.0) / 4.0;
  float entrance = smoothstep(0.06, 0.27, phase);
  float exit = 1.0 - smoothstep(0.79, 0.96, phase);
  float show = entrance * exit;
  vec3 a = texture2D(u_scene_a, coverUv(uv, u_aspect_a)).rgb;
  vec3 b = texture2D(u_scene_b, coverUv(uv, u_aspect_b)).rgb;
  vec3 color = a;
  if (u_mode < 0.5) {
    vec2 titleUv = uv - vec2(0.0, (1.0 - entrance) * 0.025);
    vec4 title = texture2D(u_title, titleUv);
    float mask = 1.0 - smoothstep(entrance * 1.1 - 0.02, entrance * 1.1, uv.x);
    color *= 0.72;
    color = mix(color, title.rgb, title.a * mask * exit);
  } else if (u_mode < 1.5) {
    vec4 title = texture2D(u_title, uv);
    color = mix(a, abs(a - title.rgb), title.a * show);
  } else if (u_mode < 2.5) {
    float wobble = sin(u_time * 7.0) * 0.0005;
    float cyan = texture2D(u_title, uv + vec2(0.009 + wobble, 0.003)).a;
    float pink = texture2D(u_title, uv - vec2(0.009 + wobble, 0.003)).a;
    vec4 title = texture2D(u_title, uv);
    color *= 0.48;
    color = mix(color, vec3(0.23, 0.88, 1.0), cyan * show * 0.85);
    color = mix(color, vec3(1.0, 0.23, 0.58), pink * show * 0.85);
    color = mix(color, title.rgb, title.a * show);
  } else {
    float t = smoothstep(0.30, 0.65, phase);
    if (u_mode < 3.5) {
      color = mix(a, b, 1.0 - smoothstep(t - 0.015, t + 0.015, uv.x));
    } else if (u_mode < 4.5) {
      color = mix(a, b, t);
    } else if (u_mode < 5.5) {
      vec2 outgoing = uv + vec2(t, 0.0);
      vec2 incoming = uv - vec2(1.0 - t, 0.0);
      color = uv.x < 1.0 - t
        ? texture2D(u_scene_a, coverUv(outgoing, u_aspect_a)).rgb
        : texture2D(u_scene_b, coverUv(incoming, u_aspect_b)).rgb;
    } else if (u_mode < 6.5) {
      float noise = hash(floor(uv * 72.0));
      float edge = uv.x + sin(uv.y * 12.0) * 0.04 + noise * 0.08;
      float frontier = t * 1.24 - 0.12;
      float burn = exp(-abs(edge - frontier) * 20.0) * sin(t * 3.14159265);
      color = mix(a, b, 1.0 - smoothstep(frontier - 0.025, frontier + 0.025, edge));
      color += burn * vec3(1.25, 0.48, 0.12);
    } else {
      vec4 title = texture2D(u_title, uv);
      color *= 0.75;
      color = mix(color, title.rgb, title.a);
    }
  }
  gl_FragColor = vec4(color, 1.0);
}
