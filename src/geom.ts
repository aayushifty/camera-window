/** Pure geometry: cover-fit mapping, window quad, pinch, face frame, smoothing. */
export interface Pt {
  x: number;
  y: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Normalized, unmirrored image coords (x right, y down) ↔ mirrored screen px (y down),
 * scaled to cover the screen like `object-fit: cover`.
 */
export class Cover {
  ox = 0;
  oy = 0;
  dw = 1;
  dh = 1;
  update(W: number, H: number, vw: number, vh: number): void {
    const k = Math.max(W / Math.max(1, vw), H / Math.max(1, vh));
    this.dw = vw * k;
    this.dh = vh * k;
    this.ox = (W - this.dw) / 2;
    this.oy = (H - this.dh) / 2;
  }
  toScreen(p: Pt): Pt {
    return { x: this.ox + (1 - p.x) * this.dw, y: this.oy + p.y * this.dh };
  }
  toImage(p: Pt): Pt {
    return { x: 1 - (p.x - this.ox) / this.dw, y: (p.y - this.oy) / this.dh };
  }
}

/** Fingertips used as window corners. */
export const THUMB_TIP = 4;
export const INDEX_TIP = 8;

/**
 * Window corners TL, TR, BR, BL (screen px) from two hands in screen px:
 * index tips form the top edge, thumb tips the bottom edge.
 */
export function windowQuad(a: Pt[], b: Pt[]): [Pt, Pt, Pt, Pt] {
  const [L, R] = a[0]!.x <= b[0]!.x ? [a, b] : [b, a];
  return [L[INDEX_TIP]!, R[INDEX_TIP]!, R[THUMB_TIP]!, L[THUMB_TIP]!];
}

/** Thumb tip touching index tip, relative to hand size (wrist → middle knuckle). */
export function isPinched(h: Pt[], ratio = 0.35): boolean {
  const size = dist(h[0]!, h[9]!) || 1e-6;
  return dist(h[THUMB_TIP]!, h[INDEX_TIP]!) / size < ratio;
}

export interface FaceAxes {
  /** screen-left / screen-right eye centres */
  eyeL: Pt;
  eyeR: Pt;
  /** midpoint between the eyes */
  c: Pt;
  /** unit vector toward the screen-right eye */
  ux: Pt;
  /** unit vector pointing up the face (screen y is down) */
  uy: Pt;
  /** eye distance in px — the face's local unit */
  s: number;
}

export function faceAxes(e1: Pt, e2: Pt): FaceAxes {
  const [eyeL, eyeR] = e1.x <= e2.x ? [e1, e2] : [e2, e1];
  const s = dist(eyeL, eyeR) || 1e-6;
  const ux = { x: (eyeR.x - eyeL.x) / s, y: (eyeR.y - eyeL.y) / s };
  return {
    eyeL,
    eyeR,
    c: { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 },
    ux,
    uy: { x: ux.y, y: -ux.x },
    s,
  };
}

/** Eyelid gap / eye width ratio → 0 (closed) .. 1 (open). */
export function eyeOpenness(ratio: number): number {
  const t = clamp01((ratio - 0.06) / (0.2 - 0.06));
  return t * t * (3 - 2 * t);
}

/** Blendshape eyeBlink score → closedness 0 (open) .. 1 (shut). The score rarely passes ~0.7 even fully shut. */
export function blinkShut(score: number): number {
  const t = clamp01((score - 0.3) / 0.3);
  return t * t * (3 - 2 * t);
}

/**
 * Pairs MediaPipe's Left/Right eye blendshapes with eye A (landmark 33 side) and eye B. Side names are easy to get
 * mirrored, so the pairing follows whichever agrees with the eyelid geometry when one eye is more shut than the other.
 */
export class BlinkPair {
  private vote = 0; // >= 0: the "Right" scores belong to eye A
  /** One frame of evidence: lid-geometry closedness per eye and the two eyeBlink scores. */
  learn(shutA: number, shutB: number, left: number, right: number): void {
    if (Math.abs(shutA - shutB) < 0.2 || Math.abs(left - right) < 0.2) return;
    const keep = Math.abs(shutA - right) + Math.abs(shutB - left);
    const swap = Math.abs(shutA - left) + Math.abs(shutB - right);
    this.vote = Math.max(-10, Math.min(10, this.vote + Math.sign(swap - keep)));
  }
  /** A Left/Right blendshape pair ordered as [eye A, eye B]. */
  pair(left: number, right: number): [number, number] {
    return this.vote >= 0 ? [right, left] : [left, right];
  }
}

/** One Euro filter on a 2D point (Casiez et al.): low jitter at rest, low lag in motion. */
export class OneEuro2 {
  private prev: Pt | null = null;
  private dprev: Pt = { x: 0, y: 0 };
  private tPrev = 0;
  constructor(
    private minCutoff = 1.2,
    private beta = 0.015,
    private dCutoff = 1,
  ) {}
  private static alpha(cutoff: number, dt: number): number {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(p: Pt, tSec: number): Pt {
    if (!this.prev) {
      this.prev = { ...p };
      this.tPrev = tSec;
      return { ...p };
    }
    const dt = Math.max(1e-3, tSec - this.tPrev);
    this.tPrev = tSec;
    const ad = OneEuro2.alpha(this.dCutoff, dt);
    const dx = (p.x - this.prev.x) / dt, dy = (p.y - this.prev.y) / dt;
    this.dprev = { x: this.dprev.x + ad * (dx - this.dprev.x), y: this.dprev.y + ad * (dy - this.dprev.y) };
    const cutoff = this.minCutoff + this.beta * Math.hypot(this.dprev.x, this.dprev.y);
    const a = OneEuro2.alpha(cutoff, dt);
    this.prev = { x: this.prev.x + a * (p.x - this.prev.x), y: this.prev.y + a * (p.y - this.prev.y) };
    return { ...this.prev };
  }
  reset(): void {
    this.prev = null;
    this.dprev = { x: 0, y: 0 };
  }
}

/**
 * Opens the window only on purpose: both hands pinch (thumb on index) for a moment, then pull open.
 * Two hands held up without that pinch never open it. Short tracking dropouts keep it open;
 * losing the hands closes it, and reopening needs a fresh pinch.
 */
export class WindowGate {
  private pinchSince = -1;
  private armed: boolean;
  private open = false;
  private lastBoth = -Infinity;
  /** `preArmed` skips the pinch (frozen screenshot pose). */
  constructor(private readonly preArmed = false) {
    this.armed = preArmed;
  }
  update(both: boolean, bothPinched: boolean, tSec: number): boolean {
    if (both) this.lastBoth = tSec;
    if (bothPinched) {
      if (this.pinchSince < 0) this.pinchSince = tSec;
      if (tSec - this.pinchSince >= 0.12) this.armed = true;
    } else this.pinchSince = -1;
    if (this.open) {
      if (tSec - this.lastBoth > 0.3) {
        this.open = false;
        this.armed = this.preArmed;
      }
    } else if (both && this.armed && !bothPinched) this.open = true;
    else if (!both && tSec - this.lastBoth > 0.5) this.armed = this.preArmed;
    return this.open;
  }
}
