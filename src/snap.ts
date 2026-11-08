/**
 * Finger-snap and open-palm detection from MediaPipe hand world landmarks (metres, 21 points).
 *
 * A snap only counts when all three phases happen, in order, fast:
 *   1. contact  — thumb tip pressed on the middle fingertip for 2+ frames, middle finger held away from the palm
 *   2. release  — thumb and middle clearly apart (a wide gap above the contact line, so jitter can't cross it)
 *   3. slam     — the middle fingertip lands on the palm, having dropped a long way since contact
 * and 2+3 within SNAP.windowMs of the last contact frame. A relaxed hand drifting near
 * the old single threshold, or slowly letting go of a pinch, never fires.
 */
import type { P3 } from './face';

const WRIST = 0, THUMB_CMC = 1, THUMB_MCP = 2, THUMB_TIP = 4;
const INDEX_MCP = 5, INDEX_PIP = 6, INDEX_TIP = 8;
const MIDDLE_MCP = 9, MIDDLE_PIP = 10, MIDDLE_DIP = 11, MIDDLE_TIP = 12;
const RING_MCP = 13, RING_PIP = 14, RING_TIP = 16;
const PINKY_MCP = 17, PINKY_PIP = 18, PINKY_TIP = 20;

/** Distances below are in palm lengths (wrist to middle knuckle), so they hold at any hand size or distance. */
export const SNAP = {
  contact: 0.36, // thumb–middle gap that counts as pressed together
  armAway: 0.6, // middle tip must be at least this far from the palm while pressed (rules out fists)
  release: 0.7, // thumb–middle gap after the snap
  land: 0.8, // middle tip this close to the palm = landed
  drop: 0.25, // how far the middle tip must travel toward the palm
  windowMs: 600, // release + slam must follow the last contact frame within this
  cooldownMs: 1500,
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

interface HandState {
  contactFrames: number;
  lastContact: number;
  armed: boolean;
  armSlam: number;
}

export type SnapEvent = 'snap' | 'palm';

export class SnapDetector {
  // shortcut: hands keyed by MediaPipe's list order, which can swap when two hands cross; fine for one snapping hand
  private hands: HandState[] = [];
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
      const st = (this.hands[i] ??= { contactFrames: 0, lastContact: -1e9, armed: false, armSlam: 0 });
      if (f.pinch < SNAP.contact) {
        st.contactFrames++;
        st.lastContact = now;
        st.armSlam = f.slam;
        st.armed = st.contactFrames >= 2 && f.slam >= SNAP.armAway;
        return;
      }
      st.contactFrames = 0;
      if (!st.armed) return;
      if (now - st.lastContact > SNAP.windowMs) {
        st.armed = false;
        return;
      }
      if (f.pinch >= SNAP.release && f.slam <= SNAP.land && st.armSlam - f.slam >= SNAP.drop) {
        st.armed = false;
        if (now - this.lastSnap > SNAP.cooldownMs) {
          this.lastSnap = now;
          event = 'snap';
        }
      }
    });
    this.hands.length = Math.min(this.hands.length, Math.max(world.length, 1));

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
