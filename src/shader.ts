/**
 * Single-pass compositor. Everything is in device px, y down (screen space).
 * Outside the window: the mirrored camera. Inside: dark glass, the person as a
 * character silhouette, glowing eyes from iris landmarks.
 */
export const VERT = /* glsl */ `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

export const FRAG = /* glsl */ `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;
uniform vec4 uMap;          // ox, oy, dw, dh
uniform sampler2D uVideo;
uniform sampler2D uMask;
uniform float uHasMask;
uniform float uTime;        // s
uniform float uDpr;
uniform vec2 uQ[4];         // TL TR BR BL
uniform float uWin;         // window alpha
uniform float uFlash;       // 1 → 0 after the window opens
uniform float uFace;
uniform vec2 uEyeL;
uniform vec2 uEyeR;
uniform vec2 uOpen;         // eye openness L, R
uniform vec2 uC;
uniform vec2 uUx;
uniform vec2 uUy;
uniform float uS;           // eye distance px
uniform int uChar;          // 0 shadow, 1 web, 2 anime

const vec3 PAPER = vec3(0.93, 0.90, 0.84);

vec2 toUV(vec2 p) { return vec2(1.0 - (p.x - uMap.x) / uMap.z, (p.y - uMap.y) / uMap.w); }
vec3 cam(vec2 p) { return texture(uVideo, toUV(p)).rgb; }
float maskAt(vec2 p) { return uHasMask > 0.5 ? texture(uMask, toUV(p)).r : 0.0; }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

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
/** >0 inside (distance to nearest edge), <0 outside. Winding-agnostic. */
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

/** face-local coords: unit = eye distance, origin = between the eyes, +y up the face */
vec2 toLocal(vec2 p) { vec2 d = p - uC; return vec2(dot(d, uUx), dot(d, uUy)) / uS; }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

/** Glowing eye: hot core, darker rim ring, soft halo. q is eye-local (eye-distance units). */
void eye(inout vec3 col, vec2 q, float open, float r, vec3 hot, vec3 rim, vec3 glow, float glowAmt) {
  float o = max(open, 0.07);
  vec2 qq = vec2(q.x, q.y / o);
  float d = length(qq) / r;
  float fw = 1.5 / (uS * r * o);
  float core = 1.0 - smoothstep(1.0 - fw, 1.0, d);
  float ring = smoothstep(1.0, 1.0 + fw, d) * (1.0 - smoothstep(1.16, 1.16 + fw, d));
  vec3 c = mix(hot, rim, smoothstep(0.15, 1.0, d));
  float spec = 1.0 - smoothstep(0.0, 0.28, length(qq / r - vec2(-0.32, 0.34)));
  c += vec3(1.0) * spec * 0.55;
  col *= 1.0 - ring * 0.55;
  col = mix(col, c, core);
  col += glow * exp(-max(d - 1.0, 0.0) * 2.4) * (1.0 - core) * glowAmt * smoothstep(0.05, 0.4, open);
}

vec3 shadowChar(vec2 p, vec3 glass, float m, float edge, vec2 L) {
  vec3 col = mix(glass, vec3(0.006, 0.005, 0.008), m * 0.97);
  col += vec3(0.30, 0.24, 0.16) * edge * 0.18;
  if (uFace > 0.5) {
    vec2 eL = toLocal(uEyeL), eR = toLocal(uEyeR);
    // dashed centre line down the face
    float aa = 1.2 / uS;
    float dash = smoothstep(0.42, 0.42 + aa * 6.0, fract(L.y * 7.0)) ;
    float span = smoothstep(1.1, 0.9, L.y) * smoothstep(-2.2, -1.9, L.y);
    float line = (1.0 - smoothstep(0.5 / uS, 1.3 * uDpr / uS, abs(L.x))) * dash * span;
    col += vec3(0.55, 0.53, 0.50) * line * 0.45 * m;
    // eyes light the silhouette around them
    float spill = exp(-length(L - eL) * 3.0) + exp(-length(L - eR) * 3.0);
    col += vec3(1.0, 0.72, 0.30) * spill * 0.07 * m * (uOpen.x + uOpen.y) * 0.5;
    vec3 hot = vec3(1.0, 0.97, 0.80), rim = vec3(0.93, 0.72, 0.30), glow = vec3(1.0, 0.70, 0.25);
    eye(col, L - eL, uOpen.x, 0.2, hot, rim, glow, 0.55);
    eye(col, L - eR, uOpen.y, 0.2, hot, rim, glow, 0.55);
  }
  return col;
}

uniform vec3 uCam;        // camera white balance x exposure
uniform vec3 uIrisA;      // screen x, y, radius (lm 468, the lm 33 eye)
uniform vec3 uIrisB;      // lm 473
uniform vec4 uLidA;       // upper lid xy, lower lid xy (lm 159, 145)
uniform vec4 uLidB;       // lm 386, 374
uniform vec2 uHairTop;    // hairline y (lm 10) and face half width, compositor face units
uniform vec2 uOval[36];   // face outline, screen px, in order
uniform vec2 uBrow[10];   // 5 points per eyebrow
uniform vec4 uCornA;      // outer, inner corner of eye A (lm 33, 133)
uniform vec4 uCornB;      // lm 263, 362
uniform vec2 uBlink;      // blendshape blink A, B
uniform vec4 uMouth;      // corners lm 61, 291
uniform vec4 uLips;       // lm 13, 14
uniform vec2 uMouthS;     // jawOpen, mouthSmile
uniform vec4 uCheeks;     // lm 50, 280
uniform vec4 uNose;       // lm 1 (tip), lm 2 (base)
uniform float uChin;      // lm 152, compositor face units
uniform float uWebStyle;  // 0 silver webbing, 1 black
uniform vec4 uHead;       // head centre xy, half size xy, compositor face units (follows head turns)
uniform vec2 uWebHub;     // nose bridge (lm 168), compositor face units

vec3 graded(vec3 v, vec3 tint) {
  float l = luma(v);
  return mix(vec3(l), v, 0.85) * tint;
}

/** Face-axis coords of p relative to point o, in eye-distance units (y up the face). */
vec2 fl(vec2 p, vec2 o) { vec2 d = p - o; return vec2(dot(d, uUx), dot(d, uUy)) / uS; }

/** Edge-preserving smoothing (4-sector Kuwahara): flattens texture into paint. */
vec3 kuwahara(vec2 p, float st) {
  vec3 m0 = vec3(0), m1 = vec3(0), m2 = vec3(0), m3 = vec3(0);
  vec3 s0 = vec3(0), s1 = vec3(0), s2 = vec3(0), s3 = vec3(0);
  for (int j = 0; j <= 2; j++) for (int i = 0; i <= 2; i++) {
    vec2 o = vec2(float(i), float(j)) * st;
    vec3 c;
    c = cam(p + vec2(-o.x, -o.y)); m0 += c; s0 += c * c;
    c = cam(p + vec2(o.x, -o.y));  m1 += c; s1 += c * c;
    c = cam(p + vec2(-o.x, o.y));  m2 += c; s2 += c * c;
    c = cam(p + vec2(o.x, o.y));   m3 += c; s3 += c * c;
  }
  m0 /= 9.0; m1 /= 9.0; m2 /= 9.0; m3 /= 9.0;
  vec3 v0 = s0 / 9.0 - m0 * m0, v1 = s1 / 9.0 - m1 * m1, v2 = s2 / 9.0 - m2 * m2, v3 = s3 / 9.0 - m3 * m3;
  float a0 = v0.r + v0.g + v0.b, a1 = v1.r + v1.g + v1.b, a2 = v2.r + v2.g + v2.b, a3 = v3.r + v3.g + v3.b;
  vec3 best = m0; float bv = a0;
  if (a1 < bv) { bv = a1; best = m1; }
  if (a2 < bv) { bv = a2; best = m2; }
  if (a3 < bv) { best = m3; }
  return best;
}

/** Signed distance to the face outline: > 0 inside. */
float ovalSD(vec2 p) {
  float d = 1e9;
  bool inside = false;
  for (int i = 0; i < 36; i++) {
    vec2 a = uOval[i], b = uOval[(i + 1) % 36];
    d = min(d, sdSeg(p, a, b));
    if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside ? d : -d;
}

const vec3 INK = vec3(0.36, 0.20, 0.15);  // warm brown line art

/** Hand-painted eye. corn = outer.xy, inner.zw. Paint mask in .a. */
vec4 animeEye(vec2 p, vec4 corn, vec3 I, float blink) {
  vec2 outer = corn.xy, inner = corn.zw;
  vec2 c = (outer + inner) * 0.5 + uUy * 0.02 * uS;
  vec2 ax = normalize(outer - inner);
  vec2 d = p - c;
  float qx = dot(d, ax), qy = dot(d, uUy);
  float hw = 0.5 * length(outer - inner) * 1.35;
  float open = 1.0 - clamp(blink, 0.0, 1.0);
  float ht = 0.22 * uS * open, hb = 0.115 * uS * open;
  float x = qx / hw;
  float ax2 = clamp(1.0 - x * x, 0.0, 1.0);
  float yu = ht * pow(ax2, 0.55) + 0.02 * uS * x - 0.035 * uS * ax2 * (1.0 - open);   // shut lid bows down
  float yl = -hb * pow(ax2, 0.8);
  float aa = uDpr;
  float inEye = smoothstep(-aa, aa, yu - qy) * smoothstep(-aa, aa, qy - yl) * step(abs(x), 1.0);
  vec3 col = mix(vec3(0.82, 0.80, 0.84), vec3(0.99, 0.98, 0.96), smoothstep(yu, yu - 0.06 * uS, qy));
  // big iris with a vertical gradient, pupil, dark rim, two catchlights
  vec2 ic = I.xy;
  float ir = max(I.z * 1.75, 0.145 * uS);
  float up = dot(p - ic, uUy) / ir;
  float id = length(vec2(dot(p - ic, uUx) / ir, up * 0.82));
  // amber-brown iris: warm glow low, deep brown under the lid
  vec3 iris = mix(vec3(0.90, 0.60, 0.30), vec3(0.30, 0.14, 0.07), smoothstep(-0.8, 0.7, up));
  iris = mix(iris, vec3(0.10, 0.05, 0.03), 1.0 - smoothstep(0.34, 0.42, id));
  iris = mix(iris, vec3(0.22, 0.10, 0.05), smoothstep(0.84, 0.98, id));
  iris = mix(iris, vec3(1.0, 0.80, 0.48), smoothstep(0.35, 0.8, id) * smoothstep(-0.2, -0.8, up) * (1.0 - smoothstep(0.86, 0.95, id)) * 0.55);  // warm glow low in the iris
  col = mix(col, iris, 1.0 - smoothstep(1.0 - 1.5 * aa / ir, 1.0, id));
  vec2 cq = vec2(dot(p - ic, uUx) / ir, up);
  float cl = 1.0 - smoothstep(0.22, 0.29, length(cq - vec2(-0.3, 0.36)));          // big sparkle
  cl = max(cl, 1.0 - smoothstep(0.11, 0.15, length(cq - vec2(0.32, -0.28))));     // small sparkle
  cl = max(cl, 1.0 - smoothstep(0.05, 0.07, length(cq - vec2(0.02, 0.58))));      // tiny glint
  col = mix(col, vec3(1.0, 0.97, 0.92), cl * 0.85);
  // thick upper lash line with an outer flick; thin lower lid on the outer half
  float lashW = (0.026 - 0.012 * abs(x)) * uS + 0.6 * aa;
  float upper = abs(qy - yu) - lashW * smoothstep(1.12, 0.9, abs(x));
  float flick = sdSeg(vec2(qx, qy), vec2(hw * 0.92, yu), vec2(hw * 1.1, yu + 0.04 * uS)) - 0.008 * uS;
  float lash = (1.0 - smoothstep(-aa, aa, min(upper, flick))) * step(abs(x), 1.2);
  float lower = (1.0 - smoothstep(0.3 * aa, 1.4 * aa, abs(qy - yl))) * smoothstep(0.1, 0.5, x) * step(abs(x), 1.0) * open;
  // double-eyelid crease: a thin line above the outer two thirds of the lid
  float yc = yu + 0.055 * uS * pow(ax2, 0.5);
  float crease = (1.0 - smoothstep(0.3 * aa, 1.3 * aa, abs(qy - yc))) * smoothstep(-0.6, 0.1, x) * step(abs(x), 0.95) * open;
  float a = max(max(inEye, max(lash, lower * 0.7)), crease * 0.5);
  col = mix(col, INK * 0.6, max(lash, lower * 0.7));
  col = mix(col, INK * 0.85, crease * (1.0 - inEye));
  return vec4(col, a);
}


/** Room hue on painted hair, never its exposure. */
vec3 hairTint(vec3 c) { return c * mix(vec3(1.0), uCam / max(luma(uCam), 0.05), 0.2); }

/** Screen px of face-local L (inverse of toLocal). */
vec2 fromLocal(vec2 L) { return uC + (L.x * uUx + L.y * uUy) * uS; }

/** Pointed tuft profile round the head at e (head-box units): (0 ... 1 at a tip, tip size 0 ... 1). */
vec2 tuft(vec2 e) {
  float at = abs(atan(e.x, e.y)), sg = e.x < 0.0 ? -1.0 : 1.0;
  float kf = at * 9.0 / 3.14159 + 0.9 * noise(vec2(at * 2.6, sg * 7.0));
  float f = fract(kf), hs = hash(vec2(floor(kf), sg));
  return vec2(pow(f < 0.6 ? f / 0.6 : (1.0 - f) / 0.4, 1.8 + 1.4 * hs), hs * hs);   // tips lean outward and down
}

/** Hair silhouette at p: the person mask pushed out into pointed tufts. */
float hairShape(vec2 p) {
  vec2 e = (toLocal(p) - uHead.xy) / uHead.zw;
  vec2 tf = tuft(e);
  float push = uS * (0.05 + 0.15 * tf.y) * tf.x * smoothstep(-0.6, -0.2, e.y);
  vec2 toC = normalize(fromLocal(uHead.xy) - p + 1e-4);
  return max(maskAt(p), maskAt(p + toC * push));
}

/**
 * The user's own hair drawn as anime line art: flat navy-black fill (darker at the crown), thin tapered black
 * strand lines flowing down from the crown, small pale highlight ticks, ink outline. outline: ink amount at p.
 */
vec3 toonHair(vec3 col, vec2 L, float hair, float outline) {
  vec2 e = (L - uHead.xy) / uHead.zw;
  float hrm = 0.5 * (uHead.z + uHead.w), px = uDpr / uS;
  vec3 c = mix(vec3(0.25, 0.25, 0.40), vec3(0.11, 0.11, 0.19), smoothstep(-0.4, 0.9, e.y));
  // strand lines: tapered strokes on a field that flows down from the crown and curves outward
  vec2 eK = e - vec2(0.0, 0.95);
  float aK = atan(eK.x, -eK.y), rK = length(eK), sg = aK < 0.0 ? -1.0 : 1.0;
  float kc = abs(aK) * 10.0 / 3.14159 + 0.6 * noise(vec2(abs(aK) * 3.1, sg * 5.0)) - 0.5 * rK * rK;
  float fc = fract(kc), slot = floor(kc), h1 = hash(vec2(slot, sg + 3.0)), h2 = hash(vec2(slot, sg + 9.0));
  float r0 = 0.2 + 0.4 * h1, r1 = r0 + 0.35 + 0.5 * h2;
  float t = clamp((rK - r0) / (r1 - r0), 0.0, 1.0);
  float lw = (0.4 + 1.2 * sin(3.14159 * t)) * px;                     // thin ends, thicker middle
  float dl = min(fc, 1.0 - fc) * (3.14159 / 10.0) * rK * hrm;
  float on = step(r0, rK) * step(rK, r1) * step(0.2, h1);
  c = mix(c, vec3(0.04, 0.04, 0.08), (1.0 - smoothstep(lw - 0.7 * px, lw + 0.7 * px, dl)) * on);
  // pale highlight ticks: a small pair on some clumps, along the strand direction
  float rc = 0.5 + 0.12 * h2;
  for (int j = 0; j < 2; j++) {
    float fx = j == 0 ? 0.36 : 0.6;
    vec2 q = vec2((fc - fx) * (3.14159 / 10.0) * rK * hrm / 0.02, (rK - rc + 0.03 * float(j)) * hrm / 0.07);
    c = mix(c, vec3(0.78, 0.80, 0.96), (1.0 - smoothstep(0.8, 1.0, length(q))) * step(0.45, h2) * smoothstep(0.0, 0.3, e.y + 0.3));
  }
  c = mix(c, vec3(0.03, 0.03, 0.06), outline);
  return mix(col, hairTint(c), max(hair, outline));
}

vec3 animeChar(vec2 p, vec3 v, float m, float edge, vec2 L) {
  // the whole window turns painterly with a warm grade
  vec3 k = kuwahara(p, 2.4 * uDpr);
  vec3 col = mix(vec3(luma(k)), k, 1.15) * vec3(1.05, 1.0, 0.9);
  // warm orange world behind the person
  col = mix(col, col * vec3(1.04, 0.98, 0.9), 1.0 - smoothstep(0.2, 0.6, m));
  if (uFace < 0.5) return col;
  float f = smoothstep(0.0, 2.0 * uDpr, ovalSD(p)) * smoothstep(0.2, 0.5, m);
  if (f > 0.0) {
    // cel-shaded skin: 3 warm tones picked from the smoothed light on the real face
    // light level from a wide soft blur, so the cel bands follow face shape, not skin texture
    float lb = 0.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 0.5236;
      vec2 o = vec2(cos(a), sin(a));
      lb += luma(cam(p + o * 0.07 * uS)) + luma(cam(p + o * 0.15 * uS));
    }
    lb = (lb / 24.0) * 0.6 + luma(cam(p)) * 0.4;
    float ln = lb / max(0.42 * luma(uCam), 0.05);
    ln = mix(ln, 0.8, 0.3);                       // painted light is flatter than real light
    vec3 light = vec3(0.97, 0.81, 0.70), mid = vec3(0.92, 0.70, 0.60), dark = vec3(0.79, 0.53, 0.47);  // warm peach skin
    // flatten the real eyes, brows and mouth into skin before painting features
    float hide = 0.0;
    for (int i = 0; i < 4; i++) {
      float dB = min(sdSeg(p, uBrow[i], uBrow[i + 1]), sdSeg(p, uBrow[i + 5], uBrow[i + 6]));
      hide = max(hide, 1.0 - smoothstep(0.06, 0.1, dB / uS));
    }
    vec2 mq = fl(p, (uMouth.xy + uMouth.zw) * 0.5);
    hide = max(hide, 1.0 - smoothstep(0.75, 1.0, length(mq / vec2(0.42, 0.16))));
    for (int e = 0; e < 2; e++) {
      vec4 cn = e == 0 ? uCornA : uCornB;
      vec2 eq = fl(p, (cn.xy + cn.zw) * 0.5);
      hide = max(hide, 1.0 - smoothstep(0.8, 1.05, length(eq / vec2(0.44, 0.27))));
    }
    ln = mix(ln, 0.75, hide);
    float inD = ovalSD(p) / uS;
    ln = min(ln, mix(0.45, 2.0, smoothstep(0.08, 0.14, inD + 0.1 * (0.6 - L.x))));   // side shadow band
    ln = min(ln, mix(0.45, 2.0, smoothstep(0.08, 0.16, inD + 0.6 * max(L.y - uChin - 0.5, 0.0))));  // under-jaw shade
    vec3 skin = mix(dark, mix(mid, light, smoothstep(0.58, 0.78, ln)), smoothstep(0.30, 0.50, ln));  // soft bands
    skin *= mix(vec3(1.0), uCam / max(luma(uCam), 0.05), 0.25);  // room hue only: exposure would bleach it
    // blush
    for (int e = 0; e < 2; e++) {
      vec2 q = fl(p, e == 0 ? uCheeks.xy : uCheeks.zw) / vec2(0.26, 0.13);
      skin = mix(skin, vec3(0.97, 0.60, 0.58), exp(-dot(q, q)) * 0.45);
    }
    // blush and a highlight on the nose tip
    vec2 nq = fl(p, uNose.xy);
    skin = mix(skin, vec3(0.97, 0.66, 0.62), exp(-dot(nq / vec2(0.09, 0.06), nq / vec2(0.09, 0.06))) * 0.35);
    skin = mix(skin, vec3(1.0, 0.98, 0.96), (1.0 - smoothstep(0.014, 0.022, length(nq - vec2(0.02, 0.035)))) * 0.7);
    // nose: one small shadow stroke at the base
    float nose = sdSeg(fl(p, uNose.zw), vec2(-0.06, 0.02), vec2(0.03, -0.01));
    skin = mix(skin, dark * 0.85, (1.0 - smoothstep(0.008, 0.008 + uDpr / uS, nose)) * 0.8);
    // eyebrows: soft tapered strokes
    for (int i = 0; i < 4; i++) {
      float w = (0.035 - 0.006 * float(i)) + 0.5 * uDpr / uS;
      float b = min(sdSeg(p, uBrow[i], uBrow[i + 1]), sdSeg(p, uBrow[i + 5], uBrow[i + 6])) / uS;
      skin = mix(skin, INK * 0.9, 1.0 - smoothstep(w - uDpr / uS, w, b));
    }
    // mouth: a simple line that curves with the smile and opens with the jaw
    vec2 mL = uMouth.xy, mR = uMouth.zw;
    vec2 mc = (mL + mR) * 0.5 + (0.5 * (uLips.xy + uLips.zw) - (mL + mR) * 0.5) * 0.3;
    float halfW = 0.5 * length(mR - mL) / uS * 0.7;
    vec2 q = fl(p, mc);
    float x = q.x / max(halfW, 1e-3);
    float sm = uMouthS.y, jo = smoothstep(0.08, 0.6, uMouthS.x);
    float yLine = -0.035 * sm * (1.0 - x * x) + 0.02 * sm * x * x;
    float inX = step(abs(x), 1.0);
    float ml = (1.0 - smoothstep(0.6 * uDpr, 1.6 * uDpr, abs(q.y - yLine) * uS)) * inX * smoothstep(1.0, 0.85, abs(x));
    float op = max(jo, 0.55 * smoothstep(0.35, 0.85, sm));          // a big smile opens into a "D"
    float openH = 0.16 * op * (1.0 - x * x);
    float yBot = yLine - openH;
    float inside = inX * step(q.y, yLine) * step(yBot, q.y) * step(0.01, op);
    skin = mix(skin, vec3(0.42, 0.14, 0.15), inside);                                       // mouth interior
    skin = mix(skin, vec3(0.88, 0.47, 0.48), inside * smoothstep(yLine - openH * 0.5, yLine - openH * 0.95, q.y) * (1.0 - 0.6 * abs(x)));  // tongue
    // teeth: a white upper row under the lip line, a lower row once the jaw drops
    float tUp = min(0.035, openH * 0.4);
    float upper = inside * step(yLine - tUp, q.y) * (1.0 - smoothstep(0.8, 0.95, abs(x)));
    float lower = inside * step(q.y, yBot + min(0.022, openH * 0.25)) * (1.0 - smoothstep(0.55, 0.75, abs(x))) * smoothstep(0.45, 0.7, op);
    skin = mix(skin, vec3(0.99, 0.98, 0.96) * mix(0.88, 1.0, smoothstep(yLine - tUp, yLine - tUp * 0.4, q.y)), upper);
    skin = mix(skin, vec3(0.96, 0.95, 0.93), lower);
    // ink outline along the bottom of the open mouth
    ml = max(ml, (1.0 - smoothstep(0.6 * uDpr, 1.6 * uDpr, abs(q.y - yBot) * uS)) * inX * step(0.01, op) * smoothstep(1.0, 0.85, abs(x)));
    // small soft pink lips
    vec2 lq = (q - vec2(0.0, yLine - 0.03)) / vec2(max(halfW, 1e-3) * 0.7, 0.04);
    skin = mix(skin, vec3(0.93, 0.60, 0.60), exp(-dot(lq, lq)) * 0.5 * (1.0 - op));
    skin = mix(skin, INK, ml * 0.75);
    // eyes
    vec4 ea = animeEye(p, uCornA, uIrisA, uBlink.x);
    skin = mix(skin, ea.rgb, ea.a);
    vec4 eb = animeEye(p, uCornB, uIrisB, uBlink.y);
    skin = mix(skin, eb.rgb, eb.a);
    col = mix(col, skin, f);
  }
  // line art along the jaw and cheeks (the top of the outline sits under the hair)
  float od = abs(ovalSD(p));
  float jaw = smoothstep(uHairTop.x * 0.7, uHairTop.x * 0.35, L.y);
  col = mix(col, INK, (1.0 - smoothstep(0.7 * uDpr, 1.7 * uDpr, od)) * jaw * smoothstep(0.2, 0.5, m) * 0.85);
  // the user's own hair, kept where it is: a tufted silhouette around the head, plus the real dark fringe above the brows
  float browY = 0.25 * (toLocal(uBrow[1]).y + toLocal(uBrow[3]).y + toLocal(uBrow[6]).y + toLocal(uBrow[8]).y);
  // the hair never reaches past a tufted outline round the head or below the ears, so a person mask that spills
  // into a dark wall can't smear; both limits are part of the inked silhouette
  vec2 eH = (L - uHead.xy) / uHead.zw;
  vec2 tf = tuft(eH);
  float hrm = 0.5 * (uHead.z + uHead.w);
  float sdE = (1.0 + 0.1 * tf.y * tf.x - length(eH)) * hrm * uS;                          // px, > 0 inside
  float jag = 1.0 - abs(fract(L.x * 3.5 + noise(vec2(L.x * 2.0, 4.0))) - 0.5) * 2.0;
  float sdB = (L.y + 0.45 + 0.2 * jag * jag) * uS;                                         // jagged ends by the ears
  float zone = step(-2.0 * uDpr, min(sdE, sdB)) * mix(1.0, smoothstep(browY + 0.06, browY + 0.14, L.y), f);
  float hair = 0.0;
  if (zone > 0.0) {
    float skinL = max(0.5 * (luma(cam(uCheeks.xy)) + luma(cam(uCheeks.zw))), 0.05);
    float lb = 0.0;
    for (int i = 0; i < 6; i++) { float a = float(i) * 1.0472; lb += luma(cam(p + vec2(cos(a), sin(a)) * 2.0 * uDpr)); }
    // shortcut: hair is told from skin by darkness, so light blond hair reads as skin; add a hair segmenter then
    float dark = 1.0 - smoothstep(0.5, 0.62, (lb / 6.0) / skinL);
    float h0 = hairShape(p);
    vec2 g = vec2(hairShape(p + vec2(uDpr, 0.0)) - h0, hairShape(p + vec2(0.0, uDpr)) - h0) / uDpr;
    float sdH = min((h0 - 0.5) / max(length(g), 1e-3), min(sdE, sdB));   // px to the silhouette, > 0 inside
    // inside the real silhouette only dark pixels are hair (ears and skin stay); the tufts beyond it are all hair
    hair = zone * smoothstep(-0.7 * uDpr, 0.7 * uDpr, sdH) * mix(1.0, dark, smoothstep(0.3, 0.6, m));
    float ink = (1.0 - smoothstep(1.0 * uDpr, 1.8 * uDpr, abs(sdH - 0.9 * uDpr))) * (1.0 - f);   // outer outline
    ink = max(ink, (1.0 - abs(2.0 * dark - 1.0)) * smoothstep(0.3, 0.6, m) * 0.8);             // where hair meets skin
    col = toonHair(col, L, hair, ink * zone);
  }
  col += vec3(0.25, 0.65, 0.70) * edge * 0.08 * (1.0 - hair);    // soft teal rim on the body
  return col;
}

/** Person mask grown outward by o px, so loose hair and ears at the silhouette are covered too. */
float maskGrow(vec2 p, float o) {
  return max(maskAt(p), max(max(maskAt(p + vec2(o, 0.0)), maskAt(p - vec2(o, 0.0))),
                            max(maskAt(p + vec2(0.0, o)), maskAt(p - vec2(0.0, o)))));
}

/**
 * Red suit fabric with the web. w: position relative to the web hub (y up), in units of unitPx screen px.
 * nz: form factor, 1 facing the camera ... 0 at the silhouette.
 */
vec3 webFabric(vec2 w, float nz, float unitPx) {
  vec3 fab = vec3(0.60, 0.035, 0.08) * (0.3 + 0.62 * nz);
  fab += vec3(0.9, 0.35, 0.3) * pow(1.0 - nz, 3.0) * 0.12;          // soft rim where the head turns away
  float r = length(w);
  float N = uWebStyle < 0.5 ? 16.0 : 12.0;
  float sg = 6.2831853 / N;
  float fk = fract(atan(w.x, -w.y) / sg + 0.5);
  float spoke = min(fk, 1.0 - fk) * sg * r;
  float spacing = uWebStyle < 0.5 ? 0.30 : 0.38;
  float reff = r * (1.0 + 0.09 * sin(3.14159 * fk));
  float dd = min(spoke, abs(fract(reff / spacing + 0.5) - 0.5) * spacing) * unitPx;  // px
  if (uWebStyle < 0.5) {
    float cord = 1.0 - smoothstep(0.9 * uDpr, 2.4 * uDpr, dd);
    float groove = (1.0 - smoothstep(2.2 * uDpr, 4.2 * uDpr, dd)) - cord;
    fab = mix(fab, fab * 0.45, groove * 0.6);
    fab = mix(fab, vec3(0.50, 0.50, 0.54) * (0.4 + 0.6 * nz), cord);
  } else {
    fab = mix(fab, vec3(0.02, 0.01, 0.012), 1.0 - smoothstep(0.5 * uDpr, 1.4 * uDpr, dd));
  }
  return fab;
}

vec3 webChar(vec2 p, vec3 v, float m, float edge, vec2 L) {
  vec3 bg = mix(v, graded(v, vec3(0.95, 0.97, 1.0)), 0.5) * 0.94;   // the real room, lightly graded
  vec3 col = mix(bg, graded(v, vec3(1.02, 0.95, 0.94)), m);
  if (uFace > 0.5) {
    // hood: every person pixel of the head (hair, ears, neck) becomes fabric; the face mesh draws on top.
    // Centred on the whole head (it shifts away from the nose when the head turns), not between the eyes.
    float mG = maskGrow(p, 0.08 * uS);
    vec2 he = (L - uHead.xy) / uHead.zw;
    float head = 1.0 - smoothstep(0.9, 1.05, length(he));
    float neck = (1.0 - smoothstep(0.45, 0.6, abs(L.x - uHead.x) / uHead.z)) * step(uChin - 1.2, L.y) * step(L.y, 0.0);
    float hood = smoothstep(0.12, 0.4, mG) * max(head, neck);
    if (hood > 0.0) {
      float nz = sqrt(max(1.0 - dot(he, he), 0.0));
      col = mix(col, webFabric(L - uWebHub, max(nz, 0.25), uS) * uCam, hood);   // no camera detail: no face traces
    }
    // suit: red chest and shoulders, blue sides, web lines; folds come from the real clothes
    float region = m * smoothstep(uChin - 0.35, uChin - 0.7, L.y);
    if (region > 0.0) {
      float ln = clamp(luma(v) / max(0.42 * luma(uCam), 0.05), 0.0, 1.8);
      float side = smoothstep(1.5, 1.7, abs(L.x)) * smoothstep(uChin - 1.4, uChin - 1.8, L.y);
      vec3 suit = mix(vec3(0.62, 0.045, 0.09), vec3(0.06, 0.12, 0.36), side) * (0.3 + 0.7 * ln);
      vec2 w = L - vec2(0.0, uChin - 2.3);
      float r = length(w);
      float sg = 6.2831853 / 18.0;
      float fk = fract(atan(w.x, w.y) / sg + 0.5);
      float spoke = min(fk, 1.0 - fk) * sg * r;
      float reff = r * (1.0 + 0.1 * sin(3.14159 * fk));
      float ring = abs(fract(reff / 0.38 + 0.5) - 0.5) * 0.38;
      float px = uDpr / uS;
      float lines = 1.0 - smoothstep(0.6 * px, 1.6 * px, min(spoke, ring));
      suit = mix(suit, vec3(0.02, 0.01, 0.015), lines * (1.0 - side) * 0.9);
      col = mix(col, suit * uCam, region);
    }
  } else {
    // no face found (yet): the person inside the window is still never shown
    vec2 wc = 0.25 * (uQ[0] + uQ[1] + uQ[2] + uQ[3]);
    float sc = max(0.5 * length(uQ[3] - uQ[0]), 30.0);
    float cover = smoothstep(0.12, 0.4, maskGrow(p, 6.0 * uDpr));
    col = mix(col, webFabric((p - wc) * vec2(1.0, -1.0) / sc, 0.7, sc) * uCam, cover);
  }
  return col;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 v = cam(p);
  vec3 col = v;
  if (uWin > 0.001) {
    float sd = quadSD(p);
    float inside = smoothstep(0.0, uDpr, sd);
    if (inside > 0.0) {
      float m = maskAt(p);
      float o = 3.0 * uDpr;
      float gx = maskAt(p + vec2(o, 0.0)) - maskAt(p - vec2(o, 0.0));
      float gy = maskAt(p + vec2(0.0, o)) - maskAt(p - vec2(0.0, o));
      float edge = clamp(length(vec2(gx, gy)) * 1.6, 0.0, 1.0);
      float lum = luma(v);
      vec3 glass = mix(vec3(lum), v, 0.7) * 0.26 + vec3(0.012);
      vec2 L = toLocal(p);
      vec3 ch;
      if (uChar == 1) {
        ch = webChar(p, v, m, edge, L);
      } else if (uChar == 2) {
        ch = animeChar(p, v, m, edge, L);
      } else {
        ch = shadowChar(p, glass, m, edge, L);
      }
      // glass: one soft diagonal sheen + fine grain
      vec2 cen = (uQ[0] + uQ[1] + uQ[2] + uQ[3]) * 0.25;
      float span = max(length(uQ[1] - uQ[0]), 1.0);
      float t = dot(p - cen, normalize(vec2(1.0, -0.55))) / span;
      ch += PAPER * 0.04 * exp(-pow((t + 0.14) * 7.0, 2.0));
      ch += (hash(p + fract(uTime) * 97.0) - 0.5) * 0.022;
      col = mix(col, ch, inside * uWin);
    }
    float d = abs(sd);
    float line = 1.0 - smoothstep(0.55 * uDpr, 1.45 * uDpr, d);
    col = mix(col, PAPER, line * 0.9 * uWin);
    col += PAPER * exp(-d / (5.0 * uDpr)) * (0.06 + 0.25 * uFlash) * uWin;
    for (int i = 0; i < 4; i++) {
      float cd = length(p - uQ[i]) / uDpr;
      col = mix(col, PAPER, (1.0 - smoothstep(2.0, 3.0, cd)) * uWin);
    }
  }
  outColor = vec4(col, 1.0);
}`;
