import { describe, expect, it } from 'vitest';
import type { P3 } from '../src/face';
import { SnapDetector, handFeatures } from '../src/snap';
import { Onset } from '../src/snapsound';

const v = (x: number, y: number, z = 0): P3 => ({ x, y, z });

/** A right hand in metres (palm length 9 cm); thumb tip and middle tip/DIP are set per frame. */
function hand(thumbTip: P3, middleTip: P3, middleDip: P3, open = false): P3[] {
  const h: P3[] = new Array(21);
  h[0] = v(0, 0); // wrist
  h[1] = v(0.025, -0.02);
  h[2] = v(0.04, -0.04);
  h[3] = v(0.05, -0.06);
  h[4] = thumbTip;
  const finger = (mcp: number, x: number, y0: number, len: number, curled: boolean) => {
    h[mcp] = v(x, y0);
    h[mcp + 1] = v(x, y0 - len);
    h[mcp + 2] = curled ? v(x, y0 - len * 0.8, -0.02) : v(x, y0 - len * 1.6);
    h[mcp + 3] = curled ? v(x, y0 - len * 0.4, -0.025) : v(x, y0 - len * 2.1);
  };
  finger(5, 0.025, -0.085, 0.035, !open);
  finger(9, 0, -0.09, 0.04, false);
  finger(13, -0.02, -0.085, 0.03, !open);
  finger(17, -0.038, -0.075, 0.025, !open);
  if (!open) {
    h[11] = middleDip;
    h[12] = middleTip;
  }
  return h;
}

const pressed = () => hand(v(0.04, -0.1, -0.03), v(0.04, -0.1, -0.03), v(0.03, -0.12, -0.02));
const landed = () => hand(v(0.06, -0.09, 0), v(0.015, -0.03, -0.01), v(0.01, -0.06, -0.03));
const openPalm = () => hand(v(0.09, -0.07), v(0, 0), v(0, 0), true);

/** Feed frames 33 ms apart; returns the events that fired. */
function run(frames: P3[][], d = new SnapDetector(), gone = false, t0 = 0) {
  return frames.map((f, i) => d.update([f], t0 + i * 33, gone)).filter(Boolean);
}

describe('snap gesture', () => {
  it('the fixture poses measure as intended', () => {
    const a = handFeatures(pressed())!, b = handFeatures(landed())!;
    expect(a.pinch).toBeLessThan(0.36);
    expect(a.slam).toBeGreaterThan(0.6);
    expect(b.pinch).toBeGreaterThan(0.7);
    expect(b.slam).toBeLessThan(0.7);
    expect(handFeatures(openPalm())!.open).toBe(true);
  });

  it('fires on a real snap: pressed, then thumb apart and middle on the palm', () => {
    expect(run([pressed(), pressed(), pressed(), landed()])).toEqual(['snap']);
  });

  it('survives one blurred frame with no hand between press and landing', () => {
    const d = new SnapDetector();
    d.update([pressed()], 0, false);
    d.update([pressed()], 33, false);
    d.update([], 66, false);
    expect(d.update([landed()], 99, false)).toBe('snap');
  });

  it('ignores a relaxed hand jittering around the old threshold', () => {
    const frames = Array.from({ length: 90 }, (_, i) => {
      const gap = 0.045 + 0.01 * Math.sin(i * 1.7); // thumb 0.4-0.6 palm lengths from the middle tip
      return hand(v(0.02 + gap, -0.07, -0.02), v(0.02, -0.07, -0.03), v(0.015, -0.08, -0.02));
    });
    expect(run(frames)).toEqual([]);
  });

  it('ignores letting go of a pinch slowly', () => {
    const steps = 30; // 1 s from pressed to landed
    const lerp = (a: P3, b: P3, t: number) => v(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
    const P = pressed(), L = landed();
    const frames = [P, P, ...Array.from({ length: steps }, (_, i) => P.map((p, k) => lerp(p, L[k]!, (i + 1) / steps)))];
    expect(run(frames)).toEqual([]);
  });

  it('ignores a fist opening (middle finger never held away from the palm)', () => {
    const fist = hand(v(0.02, -0.035, -0.01), v(0.015, -0.03, -0.01), v(0.01, -0.06, -0.03));
    expect(run([fist, fist, fist, landed(), openPalm()])).toEqual([]);
  });

  it('fires once per cooldown even if the hand snaps twice quickly', () => {
    expect(run([pressed(), pressed(), landed(), pressed(), pressed(), landed()])).toEqual(['snap']);
  });

  it('an open palm held while vanished brings you back, not while visible', () => {
    const palm = Array.from({ length: 80 }, openPalm); // 2.6 s
    expect(run(palm, new SnapDetector(), false)).toEqual([]);
    expect(run(palm, new SnapDetector(), true)).toEqual(['palm']);
  });
});

describe('snap by sound', () => {
  it('a click right after a thumb-on-middle pose is a snap, even if the hand blurs out', () => {
    const d = new SnapDetector();
    d.update([pressed()], 0, false);
    d.update([], 66, false); // hand lost in the motion blur
    expect(d.update([], 99, false, 80)).toBe('snap');
  });

  it('a click with an open hand, or no hand, is not a snap', () => {
    const d = new SnapDetector();
    d.update([openPalm()], 0, false);
    expect(d.update([openPalm()], 33, false, 20)).toBe(null);
    expect(new SnapDetector().update([], 33, false, 20)).toBe(null);
  });

  it('a click long after the pose is not a snap, and one click counts once', () => {
    const d = new SnapDetector();
    d.update([pressed()], 0, false);
    expect(d.update([], 1500, false, 1400)).toBe(null);
    const e = new SnapDetector();
    e.update([pressed()], 0, false);
    expect(e.update([pressed()], 33, false, 20)).toBe('snap');
    expect(e.update([pressed()], 66, false, 20)).toBe(null);
  });
});

describe('click onset', () => {
  it('fires on a sharp loud click over quiet room noise, not on a slow rise', () => {
    const o = new Onset();
    for (let i = 0; i < 50; i++) expect(o.push(0.004)).toBe(false);
    expect(o.push(0.12)).toBe(true);
    const s = new Onset();
    const fired = Array.from({ length: 60 }, (_, i) => s.push(0.004 + i * 0.002)).some(Boolean);
    expect(fired).toBe(false);
  });
});
