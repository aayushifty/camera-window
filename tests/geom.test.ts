import { describe, expect, it } from 'vitest';
import { BlinkPair, Cover, OneEuro2, WindowGate, blinkShut, eyeOpenness, faceAxes, isPinched, windowQuad, type Pt } from '../src/geom';

/** Minimal 21-point hand: wrist, thumb tip, index tip, middle MCP set; rest at wrist. */
function hand(wrist: Pt, thumb: Pt, index: Pt): Pt[] {
  const h: Pt[] = Array.from({ length: 21 }, () => ({ ...wrist }));
  h[4] = thumb;
  h[8] = index;
  h[9] = { x: wrist.x, y: wrist.y - 0.1 };
  return h;
}

describe('Cover (mirrored cover-fit)', () => {
  it('maps image corners to mirrored screen and back', () => {
    const c = new Cover();
    c.update(1000, 500, 1280, 720);
    const tl = c.toScreen({ x: 0, y: 0 });
    expect(tl.x).toBeCloseTo(c.ox + c.dw); // image left → screen right
    expect(tl.y).toBeCloseTo(c.oy);
    const back = c.toImage(c.toScreen({ x: 0.3, y: 0.7 }));
    expect(back.x).toBeCloseTo(0.3);
    expect(back.y).toBeCloseTo(0.7);
    expect(c.dw).toBeGreaterThanOrEqual(1000);
    expect(c.dh).toBeGreaterThanOrEqual(500);
  });
});

describe('windowQuad', () => {
  it('orders corners TL,TR,BR,BL from the screen-left and screen-right hands', () => {
    // screen px already: hand A on the left, hand B on the right, index above thumb
    const A = hand({ x: 100, y: 400 }, { x: 120, y: 300 }, { x: 110, y: 200 });
    const B = hand({ x: 700, y: 400 }, { x: 680, y: 310 }, { x: 690, y: 190 });
    const q = windowQuad(B, A); // order of arguments must not matter
    expect(q).toEqual([
      { x: 110, y: 200 },
      { x: 690, y: 190 },
      { x: 680, y: 310 },
      { x: 120, y: 300 },
    ]);
  });
});

describe('isPinched', () => {
  it('uses thumb–index distance relative to hand size', () => {
    const open = hand({ x: 0, y: 1 }, { x: 0.2, y: 0.6 }, { x: 0.1, y: 0.4 });
    const closed = hand({ x: 0, y: 1 }, { x: 0.1, y: 0.5 }, { x: 0.105, y: 0.505 });
    expect(isPinched(open)).toBe(false);
    expect(isPinched(closed)).toBe(true);
  });
});

describe('faceAxes / eyeOpenness', () => {
  it('builds a screen-space face frame from two eye centres', () => {
    const f = faceAxes({ x: 400, y: 300 }, { x: 300, y: 300 }); // given right-then-left
    expect(f.eyeL).toEqual({ x: 300, y: 300 });
    expect(f.s).toBeCloseTo(100);
    expect(f.ux.x).toBeCloseTo(1);
    expect(f.uy.y).toBeCloseTo(-1); // up on screen
    expect(f.c).toEqual({ x: 350, y: 300 });
  });
  it('maps eyelid gap ratio to 0..1', () => {
    expect(eyeOpenness(0.3)).toBe(1);
    expect(eyeOpenness(0.02)).toBe(0);
    const m = eyeOpenness(0.16);
    expect(m).toBeGreaterThan(0);
    expect(m).toBeLessThan(1);
  });
});

describe('OneEuro2', () => {
  it('converges to a constant and damps jitter', () => {
    const f = new OneEuro2(1.5, 0.02);
    let p = { x: 0, y: 0 };
    for (let i = 0; i < 120; i++) p = f.filter({ x: 100 + (i % 2 ? 1 : -1), y: 50 }, i / 60);
    expect(Math.abs(p.x - 100)).toBeLessThan(0.6);
    expect(p.y).toBeCloseTo(50, 1);
  });
});

describe('WindowGate', () => {
  const run = (g: WindowGate, steps: [boolean, boolean][], t0 = 0) =>
    steps.map(([both, pinched], i) => g.update(both, pinched, t0 + i / 30));

  it('never opens for two hands that did not pinch first', () => {
    const g = new WindowGate();
    expect(run(g, Array(60).fill([true, false])).some(Boolean)).toBe(false);
  });

  it('opens after a held pinch is released, not during the pinch', () => {
    const g = new WindowGate();
    const out = run(g, [...Array(10).fill([true, true]), [true, false], [true, false]]);
    expect(out.slice(0, 10).some(Boolean)).toBe(false);
    expect(out[10]).toBe(true);
  });

  it('ignores a one-frame pinch blip', () => {
    const g = new WindowGate();
    expect(run(g, [[true, false], [true, true], [true, false], [true, false]]).some(Boolean)).toBe(false);
  });

  it('survives a short dropout, closes on loss, and needs a new pinch to reopen', () => {
    const g = new WindowGate();
    run(g, [...Array(10).fill([true, true]), [true, false]]);           // open at t = 10/30
    expect(g.update(false, false, 0.45)).toBe(true);                      // 0.12 s gap: still open
    expect(g.update(false, false, 0.8)).toBe(false);                      // > 0.3 s without hands: closed
    expect(g.update(true, false, 0.9)).toBe(false);                       // hands back, no pinch: stays closed
  });

  it('pre-armed gate opens without a pinch (screenshot mode)', () => {
    expect(new WindowGate(true).update(true, false, 0)).toBe(true);
  });
});

describe('blink', () => {
  it('maps the blink score to full closure: open at rest, shut well before 1', () => {
    expect(blinkShut(0.1)).toBe(0);
    expect(blinkShut(0.65)).toBe(1);
    expect(blinkShut(0.45)).toBeGreaterThan(0.3);
  });
  it('pairs eyeBlinkRight with eye A by default', () => {
    expect(new BlinkPair().pair(0.1, 0.9)).toEqual([0.9, 0.1]);
  });
  it('swaps the pairing when winks show the names are mirrored', () => {
    const b = new BlinkPair();
    // eye A (lm 33) is shut by its lids, but the score named "Left" is the high one
    for (let i = 0; i < 5; i++) b.learn(0.9, 0.1, 0.85, 0.05);
    expect(b.pair(0.85, 0.05)).toEqual([0.85, 0.05]);
  });
  it('ignores symmetric frames (a normal blink says nothing about sides)', () => {
    const b = new BlinkPair();
    for (let i = 0; i < 20; i++) b.learn(0.9, 0.9, 0.8, 0.8);
    expect(b.pair(0.1, 0.9)).toEqual([0.9, 0.1]);
  });
});
