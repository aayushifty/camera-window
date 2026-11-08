/**
 * Geometry passes drawn on top of the compositor, clipped to the hand window:
 * a fabric mask UV-mapped on the face mesh.
 * Positions arrive in device px (y down).
 */
const COMMON = /* glsl */ `
uniform vec2 uRes;
uniform vec4 uMap;
uniform sampler2D uMask;
uniform float uHasMask;
uniform vec2 uQ[4];
uniform float uWin;
uniform float uDpr;
uniform float uTime;
uniform vec3 uCam;      // camera white balance × exposure

vec2 toUV(vec2 p) { return vec2(1.0 - (p.x - uMap.x) / uMap.z, (p.y - uMap.y) / uMap.w); }
float maskAt(vec2 p) { return uHasMask > 0.5 ? texture(uMask, toUV(p)).r : 1.0; }
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
float cr(vec2 a, vec2 b) { return a.x * b.y - a.y * b.x; }
float sdSeg(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * h);
}
float quadSD(vec2 p) {
  float d = 1e9;
  bool pos = true, neg = true;
  for (int i = 0; i < 4; i++) {
    vec2 a = uQ[i], b = uQ[(i + 1) % 4];
    d = min(d, sdSeg(p, a, b));
    float c = cr(b - a, p - a);
    pos = pos && c >= 0.0;
    neg = neg && c <= 0.0;
  }
  return (pos || neg) ? d : -d;
}
vec2 screenP() { return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y); }
float windowAlpha(vec2 p) { return smoothstep(0.0, uDpr, quadSD(p)) * uWin; }
vec3 grain(vec2 p, vec3 c) { return c + (hash(p + fract(uTime) * 91.0) - 0.5) * 0.03; }
`;

const VS_HEAD = /* glsl */ `#version 300 es
precision highp float;
uniform vec2 uRes;
vec4 clip(vec2 px, float z) { return vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, z, 1.0); }
`;

export const MASK_VS = VS_HEAD + /* glsl */ `
in vec3 aPos;     // screen px xy + depth
in vec3 aLocal;   // head-local coords (unit = outer eye distance)
in vec3 aNormal;  // image space, toward camera = -z
in float aEdge;   // 1 on the face outline
out vec3 vL;
out vec3 vN;
out float vEdge;
void main() {
  vL = aLocal; vN = aNormal; vEdge = aEdge;
  gl_Position = clip(aPos.xy, aPos.z);
}`;

export const MASK_FS = /* glsl */ `#version 300 es
precision highp float;
out vec4 outColor;
in vec3 vL;
in vec3 vN;
in float vEdge;
${COMMON}
uniform vec2 uHub;    // lm 168, local
uniform vec2 uEyeA;   // eye centre on the lm 33 side, local
uniform vec2 uEyeB;   // eye centre on the lm 263 side, local
uniform vec2 uOpen;   // lens openness A, B from blendshapes
uniform vec3 uLight;  // key light direction estimated from the camera image
uniform sampler2D uVideo;
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

const float PI = 3.14159265;

uniform float uWebStyle;  // 0 = raised silver webbing (film), 1 = thin black webbing (game)

/** Distance to the nearest honeycomb cell edge (fine suit texture). */
float hexEdge(vec2 p) {
  const vec2 s = vec2(1.0, 1.7320508);
  vec2 a = mod(p, s) - s * 0.5;
  vec2 b = mod(p - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 q = abs(g);
  return 0.5 - max(dot(q, s * 0.5), q.x);
}

/**
 * Angular lens: inner tip points down toward the nose, outer tip sweeps up and out.
 * Thick black frame with a metallic inner rim. q is eye-local, +x = outer, +y up.
 */
/** Lens outline at u (0 inner tip ... 1 outer end): top and bottom edge heights. */
vec2 lensTB(float u, float o) {
  u = clamp(u, 0.0, 1.0);
  float t = 0.5 * o * pow(u, 0.8) * pow(1.0 - u, 0.25) / 0.55;     // tall, rounded outer end
  float c = mix(-0.14, 0.06, u);                                    // inner tip sits low, by the nose
  return vec2(c + 0.62 * t, c - 0.38 * t);                          // near-straight top edge rising outward
}

/**
 * Big shield lens from the user's reference: pointed inner tip low by the nose, straight top edge rising
 * to a tall rounded outer end, thick even black frame, pale icy-blue glass. q: +x outer, +y up.
 */
void lens(inout vec3 col, vec2 L, vec2 c, float side, float open, float px, float diff) {
  vec2 q = vec2((L.x - c.x) * side, L.y - c.y) - vec2(0.06, -0.02);
  float hw = 0.36;
  float o = mix(0.03, 1.1, clamp(open, 0.0, 1.0));   // a blink shuts the lens to a dark slit
  float u = (q.x + hw) / (2.0 * hw);
  float e = 0.004;
  vec2 tb = lensTB(u, o);
  vec2 sl = (lensTB(u + e, o) - lensTB(u - e, o)) / (2.0 * e) / (2.0 * hw);   // edge slopes
  float dTop = (q.y - tb.x) / sqrt(1.0 + sl.x * sl.x);
  float dBot = (tb.y - q.y) / sqrt(1.0 + sl.y * sl.y);
  float d = max(max(dTop, dBot), abs(q.x) - hw);                  // ~signed distance, < 0 inside
  float frame = mix(0.04, 0.06, clamp(u, 0.0, 1.0));
  float fill = 1.0 - smoothstep(-px, px, d);
  float border = 1.0 - smoothstep(frame - px, frame + px, d);
  float g = clamp((q.y - tb.y) / max(tb.x - tb.y, 1e-3), 0.0, 1.0);
  vec3 glass = mix(vec3(0.70, 0.84, 0.89), vec3(0.88, 0.95, 0.97), smoothstep(0.0, 0.9, g));
  glass += vec3(0.06) * exp(-pow((u * 0.7 + g - 1.0) * 3.0, 2.0));
  glass *= 1.0 - 0.18 * (1.0 - smoothstep(-0.03, 0.0, d)) * smoothstep(0.55, 1.0, g);   // frame shadow
  vec3 frameCol = vec3(0.012) + vec3(0.06) * diff * sin(clamp(d / frame, 0.0, 1.0) * 3.14159);
  col = mix(col, frameCol, border);
  col = mix(col, glass * (0.85 + 0.15 * diff), fill);
}

void main() {
  vec2 p = screenP();
  float alpha = windowAlpha(p);
  // the face itself is always covered; the person mask only trims the mesh's outer rim off the background
  alpha *= max(smoothstep(0.4, 0.7, maskAt(p)), 1.0 - smoothstep(0.6, 0.9, vEdge));
  alpha *= smoothstep(0.0, 0.2, 1.0 - vEdge);
  if (alpha < 0.003) discard;

  vec2 L = vL.xy;
  float px = length(fwidth(L)) * 0.7071;
  vec3 n = normalize(vN);
  vec3 ld = normalize(mix(normalize(uLight), normalize(vec3(-0.3, -0.6, -1.0)), 0.4));   // measured light, steadied by a soft key
  float diff = max(dot(n, ld), 0.0);
  float rimL = pow(1.0 - abs(n.z), 2.5);

  // fabric: deep red, fine honeycomb, form shading from the room light
  float hx = hexEdge(L * 55.0);
  float cell = 0.8 + 0.3 * smoothstep(0.0, 0.3, hx);               // each hex cell is a small raised bump
  vec3 col = vec3(0.40, 0.02, 0.05) * cell * (0.94 + 0.12 * (fbm(L * 12.0) - 0.5));
  col *= 0.3 + 0.55 * diff + 0.15 * (0.5 - 0.5 * n.y);
  // fabric stretched over a real face: take its light and shadow (nose, cheeks, lips, brow) from the camera
  float rp = 0.55 / max(px, 1e-4);                                  // ~half an eye distance, in screen px
  float avg = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    avg += luma(texture(uVideo, toUV(p + vec2(cos(a), sin(a)) * rp)).rgb);
  }
  avg = max(avg / 8.0, 0.03);
  float c0 = 0.0;                                                   // blurred centre: eyes, lips and brows wash out
  for (int i = 0; i < 6; i++) {
    float a = float(i) * 1.0472;
    c0 += luma(texture(uVideo, toUV(p + vec2(cos(a), sin(a)) * rp * 0.5)).rgb);
  }
  float shade = clamp((c0 / 6.0) / avg, 0.65, 1.3);
  col *= mix(1.0, shade, 0.15);                                    // just enough to read the face's shape, never its features
  vec3 hv = normalize(ld + vec3(0.0, 0.0, -1.0));
  col += vec3(1.0, 0.55, 0.5) * pow(max(dot(n, hv), 0.0), 20.0) * 0.16;
  col += vec3(1.0, 0.45, 0.35) * rimL * 0.25;

  // webbing: spokes from the hub between the eyes, rings that sag toward it
  vec2 w = L - uHub;
  float r = length(w);
  float N = uWebStyle < 0.5 ? 16.0 : 12.0;
  float sg = 6.2831853 / N;
  float fk = fract(atan(w.x, -w.y) / sg + 0.5);
  float spoke = min(fk, 1.0 - fk) * sg * r;
  float spacing = uWebStyle < 0.5 ? 0.21 : 0.27;
  float reff = r * (1.0 + 0.09 * sin(3.14159 * fk));
  float ring = r > 0.06 ? abs(fract(reff / spacing + 0.5) - 0.5) * spacing : 1.0;
  float d = min(spoke, ring);
  if (uWebStyle < 0.5) {
    float lw = max(0.008, 1.1 * uDpr * px);                       // cord width scales with the face
    float cord = 1.0 - smoothstep(lw - 1.1 * px, lw + 1.1 * px, d);   // wide anti-aliasing: smooth, not jagged
    float groove = (1.0 - smoothstep(lw, lw * 2.2 + 2.0 * px, d)) - cord;
    float crown = 1.0 - smoothstep(0.0, lw, d);                     // rounded top of the cord catches light
    col = mix(col, col * 0.45, groove * 0.6);
    vec3 silver = vec3(0.50, 0.50, 0.54) * (0.4 + 0.6 * diff) * mix(1.0, shade, 0.2) + vec3(0.32) * crown * crown * (0.4 + 0.6 * diff);
    col = mix(col, silver, cord);
  } else {
    float lw = 0.6 * uDpr * px;
    float line = 1.0 - smoothstep(lw - 0.5 * px, lw + 0.5 * px, d);
    float halo = (1.0 - smoothstep(lw, lw + 1.4 * px, d)) - line;
    col = mix(col, col * 1.3 + 0.02, halo * 0.45 * diff);
    col = mix(col, vec3(0.02, 0.01, 0.012), line);
  }

  lens(col, L, uEyeA, -1.0, uOpen.x, px, diff);
  lens(col, L, uEyeB, 1.0, uOpen.y, px, diff);

  outColor = vec4(grain(p, col * uCam), alpha);
}`;
