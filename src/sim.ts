import type { Pt } from './geom';

/**
 * Scripted two-hand gesture for testing without a camera (?sim=1).
 * Loops: hands meet pinched → pull apart → open the window → hold with sway → close → drop.
 * Output is normalized, unmirrored image coords like MediaPipe.
 */
export const SIM_LOOP_MS = 9000;

const ease = (t: number) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};
const seg = (t: number, a: number, b: number) => ease((t - a) / (b - a));

export interface SimState {
  hands: Pt[][];
  /** half width and height of the window in eye-distance units */
  halfW: number;
  open: number;
}

/** `tall` > 1 stretches the window up over the whole head (test option `&tall=1`). */
export function simHands(tMs: number, eye: Pt | null, eyeDistPx: number, vw: number, vh: number, tall = 1): SimState {
  const t = (tMs % SIM_LOOP_MS) / 1000;
  const E = eye ? { x: eye.x * vw, y: eye.y * vh } : { x: vw / 2, y: vh * 0.4 };
  const s = eyeDistPx > 0 ? eyeDistPx : vw * 0.08;

  if (t > 8.2) return { hands: [], halfW: 0, open: 0 };
  const halfW = 0.25 + 2.55 * seg(t, 0.4, 2.4);
  const open = seg(t, 2.6, 3.8) * (1 - seg(t, 6.6, 7.6));
  const sway = Math.sin(t * 1.6) * 0.09 * seg(t, 3.6, 4.4) * (1 - seg(t, 6.4, 7.0));
  const persp = Math.sin(t * 1.1 + 0.7) * 0.12 * open;
  const drop = seg(t, 7.6, 8.2) * 4;
  const cy = 0.15 - (tall - 1) * 0.55 + drop; // window centre just below the eyes (eye units, y down)

  const hands: Pt[][] = [];
  for (const side of [-1, 1]) {
    const hx = side * halfW;
    const hh = (0.08 + 0.62 * open) * tall * (1 + side * persp);
    // rotate the window around its centre by `sway`
    const rot = (x: number, y: number): Pt => {
      const c = Math.cos(sway), sn = Math.sin(sway);
      return { x: E.x + (x * c - y * sn) * s, y: E.y + (x * sn + y * c) * s };
    };
    const index = rot(hx, cy - hh);
    const thumb = rot(hx + side * 0.06, cy + hh);
    const wrist = rot(hx + side * 0.55, cy + hh + 1.3);
    const mcp = rot(hx + side * 0.35, cy + hh + 0.35);
    const lm: Pt[] = Array.from({ length: 21 }, () => wrist);
    lm[4] = thumb;
    lm[8] = index;
    lm[9] = mcp;
    hands.push(lm.map((p) => ({ x: p.x / vw, y: p.y / vh })));
  }
  return { hands, halfW, open };
}
