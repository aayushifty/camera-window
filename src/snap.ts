/**
 * Finger-snap and open-palm detection from MediaPipe hand world landmarks (metres, 21 points).
 *
 * A snap is judged by speed, not by exact positions: thumb and middle finger were together, and within
 * SNAP.windowMs they are far apart with the middle finger curled toward the palm. One frame of each is
 * enough, and a frame or two lost to motion blur in between doesn't matter. Things that are not snaps:
 * a relaxed hand drifting (never jumps that far that fast), slowly letting go of a pinch (too slow), and
 * a fist opening (the middle finger moves away from the palm, not toward it).
 */
import type { P3 } from './face';

const WRIST = 0, THUMB_CMC = 1, THUMB_MCP = 2, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_DIP = 11, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_PIP = 14, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_TIP = 20;

/** Distances below are in palm lengths (wrist to middle knuckle), so they hold at any hand size or distance. */
export const SNAP = {
  near: 0.45, // thumb–middle gap that counts as "together" before the snap
  jump: 0.35, // how much that gap must open...
  curl: 0.15, // ...while the middle fingertip moves this much closer to the palm...
  windowMs: 350, // ...within this time
  cooldownMs: 1200,
  palmHoldMs: 2000, // open palm held this long brings you back
};

const d3 = (a: P3, b: P3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const avg = (...ps: P3[]): P3 => ({
  x: ps.reduce((s, p) => s + p.x, 0) / ps.length,
  y: ps.reduce((s, p) => s + p.y, 0) / ps.length,
  z: ps.reduce((s, p) => s + p.z, 0) / ps.length,
});

export interface HandFeatures {
  /** thumb tip to middle fingertip (or its last joint), palm lengths */
  pinch: number;
  /** middle fingertip to the thumb base / palm centre, palm lengths */
  slam: number;
  open: boolean;
}

export function handFeatures(w: P3[]): HandFeatures | null {
  if (w.length < 21) return null;
  const s = Math.max(d3(w[WRIST]!, w[MIDDLE_MCP]!), d3(w[INDEX_MCP]!, w[PINKY_MCP]!) * 1.25, 0.04);
  const pinch = Math.min(d3(w[THUMB_TIP]!, w[MIDDLE_TIP]!), d3(w[THUMB_TIP]!, w[MIDDLE_DIP]!) * 1.05) / s;
  const thenar = avg(w[THUMB_CMC]!, w[THUMB_MCP]!, w[WRIST]!);
  const palm = avg(w[WRIST]!, w[INDEX_MCP]!, w[MIDDLE_MCP]!, w[RING_MCP]!, w[PINKY_MCP]!);
  const slam = Math.min(d3(w[MIDDLE_TIP]!, thenar), d3(w[MIDDLE_TIP]!, palm)) / s;
  // finger straightness: tip-to-knuckle over middle-joint-to-knuckle
  const ext = (tip: number, pip: number, mcp: number) => d3(w[tip]!, w[mcp]!) / (d3(w[pip]!, w[mcp]!) || 1e-6);
  const open =
    ext(INDEX_TIP, INDEX_PIP, INDEX_MCP) > 1.25 &&
    ext(MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP) > 1.25 &&
    ext(RING_TIP, RING_PIP, RING_MCP) > 1.18 &&
    ext(PINKY_TIP, PINKY_PIP, PINKY_MCP) > 1.12 &&
    pinch > 0.6 &&
    d3(w[THUMB_TIP]!, w[PINKY_MCP]!) / s > 0.7;
  return { pinch, slam, open };
}

interface Sample {
  t: number;
  pinch: number;
  slam: number;
}

export type SnapEvent = 'snap' | 'palm';

export class SnapDetector {
  // shortcut: hands keyed by MediaPipe's list order, which can swap when two hands cross; fine for one snapping hand
  /** recent frames per hand, kept by time (not by presence), so a hand lost to blur mid-snap still counts */
  private hist: Sample[][] = [];
  private lastSnap = -1e9;
  private palmSince: number | null = null;
  private palmLast = -1e9;
  /** 0..1 while an open palm is being held to come back */
  palmProgress = 0;
  /** last features per hand, for on-screen tuning */
  debug: HandFeatures[] = [];

  /** gone: you are currently vanished (enables the open-palm return). */
  update(world: P3[][], now: number, gone: boolean): SnapEvent | null {
    let event: SnapEvent | null = null;
    let anyOpen = false;
    this.debug = [];
    world.forEach((w, i) => {
      const f = handFeatures(w);
      if (!f) return;
      this.debug.push(f);
      anyOpen ||= f.open;
      const h = (this.hist[i] ??= []);
      while (h.length && now - h[0]!.t > SNAP.windowMs) h.shift();
      if (!event && now - this.lastSnap > SNAP.cooldownMs) {
        const before = h.find((s) => s.pinch <= SNAP.near && f.pinch - s.pinch >= SNAP.jump && s.slam - f.slam >= SNAP.curl);
        if (before) {
          this.lastSnap = now;
          event = 'snap';
          h.length = 0;
          return;
        }
      }
      h.push({ t: now, pinch: f.pinch, slam: f.slam });
    });

    if (gone && anyOpen) {
      this.palmSince ??= now;
      this.palmLast = now;
    } else if (this.palmSince !== null && now - this.palmLast > 400) {
      this.palmSince = null;
    }
    this.palmProgress = gone && this.palmSince !== null ? Math.min(1, (now - this.palmSince) / SNAP.palmHoldMs) : 0;
    if (!event && this.palmProgress >= 1) {
      this.palmSince = null;
      this.palmProgress = 0;
      event = 'palm';
    }
    return event;
  }
}
