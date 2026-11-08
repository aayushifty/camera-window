import { CHARACTERS } from './characters';
import { BlinkPair, Cover, OneEuro2, WindowGate, blinkShut, eyeOpenness, faceAxes, isPinched, smoothLandmarks, windowQuad, type Pt } from './geom';
import { Renderer, type FaceUniforms } from './renderer';
import { FaceRig } from './rig';
import { simHands } from './sim';
import { SnapDetector } from './snap';
import { Vanish } from './vanish';
import type { Src, Vision, VisionFrame } from './vision';

/** Face outline in order, and 5 points along each eyebrow (MediaPipe face mesh indices). */
const OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const BROWS = [46, 53, 52, 65, 55, 276, 283, 282, 295, 285];

const d2 = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
/**
 * Whole-head box (centre xy, half size xy) from the face outline in face units. Hair and ears reach past the
 * outline; when the head turns, the nose moves one way and the back of the head shows on the other side.
 */
function headBox(oval: Pt[], noseX: number): [number, number, number, number] {
  const xs = oval.map((q) => q.x), ys = oval.map((q) => q.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return [(x0 + x1) / 2 - noseX * 0.7, (y0 + y1) / 2 + 0.45, (x1 - x0) / 2 + 0.6, (y1 - y0) / 2 + 1.0];
}

type MaskMesh = Parameters<Renderer['draw']>[0]['mask'];
const NO_VISION: VisionFrame = { hands: [], world: [], face: null, shapes: {}, mask: null };

export interface EngineOptions {
  /** Scripted hands instead of detected ones (?sim=1). hold: frozen with the window open; tall: window over the head. */
  sim?: { hold: boolean; tall: boolean };
}

/**
 * One frame of henshin: camera → vision → face uniforms and the hand window → renderer.
 * Shared by the app page and the browser extension.
 */
export class Engine {
  readonly renderer: Renderer;
  character = 0;
  /** Web look: 0 raised silver webbing, 1 thin black webbing. */
  webStyle = 0;
  /** Effect over the whole frame without the hand window (video calls). */
  fullFrame = false;
  /** Snap your fingers to vanish into dust; snap again or hold an open palm to come back. */
  snapEnabled = true;
  readonly snap = new SnapDetector();
  readonly vanish = new Vanish();
  /** Read-outs: hands in device px, window state, face found, frame rate. */
  hands: Pt[][] = [];
  open = false;
  win = 0;
  faceSeen = false;
  fps = 0;
  quad: [Pt, Pt, Pt, Pt] = [
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
    { x: 0, y: 0 },
  ];

  private readonly cover = new Cover();
  private readonly rig = new FaceRig();
  private readonly gate: WindowGate;
  private readonly blinks = new BlinkPair();
  private readonly cornerF = [0, 1, 2, 3].map(() => new OneEuro2(1.4, 0.02));
  private readonly eyeF = [new OneEuro2(2.0, 0.03), new OneEuro2(2.0, 0.03)];
  private src: Src | null = null;
  private still = false;
  private vw = 1;
  private vh = 1;
  private flash = 0;
  private wasOpen = false;
  private openL = 1;
  private openR = 1;
  private lastT = 0;
  private uploaded = false;
  /** Last good face, reused for a moment when tracking drops so the face never flashes through. */
  private held: { face: FaceUniforms; mask: MaskMesh; t: number } | null = null;
  private frameNo = 0;
  /** Camera white balance × exposure, sampled every few frames from an 8×8 thumbnail. */
  private readonly tctx: CanvasRenderingContext2D;
  private cam: [number, number, number] = [1, 1, 1];
  /** Key light direction on the face (image space, toward the light; −z = toward the camera). */
  private readonly lctx: CanvasRenderingContext2D;
  private light: [number, number, number] = [-0.25, -0.6, -1];
  private pendingVanish: 'snap' | 'restore' | null = null;
  /** Face landmarks smoothed over time for everything drawn on the face (blinks still read the raw ones). */
  private faceS: { x: number; y: number; z: number }[] = [];
  private readonly personCtx = document.createElement('canvas').getContext('2d')!;

  constructor(canvas: HTMLCanvasElement, private readonly vision: Vision, private readonly opts: EngineOptions = {}) {
    this.renderer = new Renderer(canvas);
    this.renderer.setMaskIndices(this.rig.tris);
    this.gate = new WindowGate(!!opts.sim?.hold);
    const small = (n: number) => {
      const c = document.createElement('canvas');
      c.width = c.height = n;
      return c.getContext('2d', { willReadFrequently: true })!;
    };
    this.tctx = small(8);
    this.lctx = small(4);
  }

  setSource(src: Src, vw: number, vh: number, still: boolean): void {
    this.src = src;
    this.vw = vw;
    this.vh = vh;
    this.still = still;
    this.uploaded = false;
  }

  private toPx = (p: Pt) => ({ x: p.x * this.vw, y: p.y * this.vh });

  private lidRatio(lm: Pt[], c1: number, c2: number, top: number, bot: number): number {
    const w = d2(this.toPx(lm[c1]!), this.toPx(lm[c2]!)) || 1e-6;
    return d2(this.toPx(lm[top]!), this.toPx(lm[bot]!)) / w;
  }

  private sampleFaceLight(s: Src, lm: Pt[]) {
    const xs = [234, 454, 10, 152].map((i) => lm[i]!.x * this.vw), ys = [234, 454, 10, 152].map((i) => lm[i]!.y * this.vh);
    const x0 = Math.min(...xs), y0 = Math.min(...ys), w = Math.max(...xs) - x0, h = Math.max(...ys) - y0;
    if (w < 8 || h < 8) return;
    this.lctx.drawImage(s, x0, y0, w, h, 0, 0, 4, 4);
    const d = this.lctx.getImageData(0, 0, 4, 4).data;
    let lx = 0, ly = 0, tot = 0;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
      const i = (y * 4 + x) * 4;
      const v = 0.299 * d[i]! + 0.587 * d[i + 1]! + 0.114 * d[i + 2]!;
      lx += v * (x - 1.5);
      ly += v * (y - 1.5);
      tot += v;
    }
    const k = 4 / Math.max(tot, 1);
    const target = [lx * k, ly * k - 0.45, -1];
    const n = Math.hypot(target[0]!, target[1]!, target[2]!);
    this.light = this.light.map((c, i) => c + (target[i]! / n - c) * 0.3) as typeof this.light;
  }

  private sampleCamera(s: Src) {
    this.tctx.drawImage(s, 0, 0, 8, 8);
    const d = this.tctx.getImageData(0, 0, 8, 8).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i]!;
      g += d[i + 1]!;
      b += d[i + 2]!;
    }
    const n = (d.length / 4) * 255;
    r /= n; g /= n; b /= n;
    const l = 0.299 * r + 0.587 * g + 0.114 * b || 1e-3;
    const exp = Math.min(1.25, Math.max(0.5, l / 0.4));
    // keep the tint gentle: halfway between neutral and the camera's cast
    const target: [number, number, number] = [((1 + r / l) / 2) * exp, ((1 + g / l) / 2) * exp, ((1 + b / l) / 2) * exp];
    this.cam = this.cam.map((c, i) => c + (target[i]! - c) * 0.3) as typeof this.cam;
  }

  /** Run one frame at time `now` (ms). */
  step(now: number): void {
    const src = this.src;
    if (!src) return;
    if (src instanceof HTMLVideoElement && src.readyState < 2) return;
    const { vw, vh, cover, renderer } = this;
    const t = now / 1000;
    const dt = Math.min(0.1, this.lastT ? t - this.lastT : 1 / 60);
    this.lastT = t;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;

    this.vision.setMaxHands(this.fullFrame ? 1 : 2);
    const vf = this.vision.ready ? this.vision.process(src, vw, vh, this.still) : NO_VISION;
    cover.update(renderer.canvasWidth, renderer.canvasHeight, vw, vh);
    if (this.snapEnabled && this.vision.ready && !this.still) {
      this.vanish.update(src, vw, vh, vf.mask, now);
      const ev = this.snap.update(vf.world, now, this.vanish.state === 'gone');
      if (ev === 'snap' && this.vanish.state === 'live') this.pendingVanish = 'snap';
      else if (ev && this.vanish.state === 'gone') this.pendingVanish = 'restore';
    }

    // face → eyes
    let face: FaceUniforms | null = null;
    let maskMesh: MaskMesh = null;
    if (this.frameNo++ % 10 === 0) this.sampleCamera(src);
    this.faceSeen = !!vf.face && vf.face.length >= 478;
    let eyeCentre: Pt | null = null;
    let eyeDistPx = 0;
    if (vf.face && this.faceSeen) {
      const lm = vf.face;
      const prevNose = this.faceS[1];
      const faceW = Math.hypot(lm[454]!.x - lm[234]!.x, lm[454]!.y - lm[234]!.y) || 0.1;
      const speed = prevNose ? Math.hypot(lm[1]!.x - prevNose.x, lm[1]!.y - prevNose.y) / faceW / Math.max(dt, 1e-3) : 0;
      const ls = (this.faceS = smoothLandmarks(this.faceS, lm, dt, speed));
      const a = cover.toScreen(lm[468]!), b = cover.toScreen(lm[473]!);
      const oa = eyeOpenness(this.lidRatio(lm, 33, 133, 159, 145));
      const ob = eyeOpenness(this.lidRatio(lm, 263, 362, 386, 374));
      const aIsLeft = a.x <= b.x;
      const sl = this.eyeF[0]!.filter(aIsLeft ? a : b, t), sr = this.eyeF[1]!.filter(aIsLeft ? b : a, t);
      const tl = aIsLeft ? oa : ob, tr = aIsLeft ? ob : oa;
      this.openL += (tl - this.openL) * Math.min(1, dt * 18);
      this.openR += (tr - this.openR) * Math.min(1, dt * 18);
      const ax = faceAxes(sl, sr);
      const S = (i: number) => cover.toScreen(ls[i]!);
      const irisR = (c: number) => {
        const o = S(c);
        let r = 0;
        for (let k = 1; k <= 4; k++) r += d2(o, S(c + k));
        return [o.x, o.y, r / 4] as [number, number, number];
      };
      const lid = (u: number, d: number) => {
        const p = S(u), q = S(d);
        return [p.x, p.y, q.x, q.y] as [number, number, number, number];
      };
      const inFace = (i: number) => {
        const q = S(i);
        const dx = q.x - ax.c.x, dy = q.y - ax.c.y;
        return { x: (dx * ax.ux.x + dy * ax.ux.y) / ax.s, y: (dx * ax.uy.x + dy * ax.uy.y) / ax.s };
      };
      const half = (Math.abs(inFace(234).x) + Math.abs(inFace(454).x)) / 2;
      const sh = vf.shapes;
      this.blinks.learn(1 - oa, 1 - ob, sh.eyeBlinkLeft ?? 0, sh.eyeBlinkRight ?? 0);
      const side = (k: string) => this.blinks.pair(sh[`${k}Left`] ?? 0, sh[`${k}Right`] ?? 0);
      const shut = side('eyeBlink').map(blinkShut) as [number, number];
      face = {
        ...ax,
        open: [this.openL, this.openR],
        irisA: irisR(468),
        irisB: irisR(473),
        lidA: lid(159, 145),
        lidB: lid(386, 374),
        hairTop: [inFace(10).y, half],
        oval: OVAL.flatMap((i) => [S(i).x, S(i).y]),
        brow: BROWS.flatMap((i) => [S(i).x, S(i).y]),
        cornA: [S(33).x, S(33).y, S(133).x, S(133).y],
        cornB: [S(263).x, S(263).y, S(362).x, S(362).y],
        blink: shut,
        mouth: [S(61).x, S(61).y, S(291).x, S(291).y],
        lips: [S(13).x, S(13).y, S(14).x, S(14).y],
        mouthS: [sh.jawOpen ?? 0, ((sh.mouthSmileLeft ?? 0) + (sh.mouthSmileRight ?? 0)) / 2],
        cheeks: [S(50).x, S(50).y, S(280).x, S(280).y],
        nose: [S(1).x, S(1).y, S(2).x, S(2).y],
        chin: inFace(152).y,
        head: headBox(OVAL.map(inFace), inFace(1).x),
        hub: [inFace(168).x, inFace(168).y],
      };
      if (this.frameNo % 10 === 1) this.sampleFaceLight(src, lm);
      const sq = side('eyeSquint'), wide = side('eyeWide');
      const lens = (i: 0 | 1) => Math.max(0, Math.min(1.2, 1 - shut[i] - 0.2 * sq[i] + 0.25 * wide[i]));
      if (CHARACTERS[this.character]!.id === 'web') maskMesh = this.rig.mask(ls, vw, vh, cover, [lens(0), lens(1)], this.light, this.webStyle);
      eyeCentre = { x: (lm[468]!.x + lm[473]!.x) / 2, y: (lm[468]!.y + lm[473]!.y) / 2 };
      eyeDistPx = d2(this.toPx(lm[468]!), this.toPx(lm[473]!));
    } else {
      this.eyeF.forEach((f) => f.reset());
    }
    if (face) this.held = { face, mask: maskMesh, t };
    else if (this.held && t - this.held.t < 0.6) {
      face = this.held.face;
      maskMesh = CHARACTERS[this.character]!.id === 'web' ? this.held.mask : null;
    }

    // hands → window
    const sim = this.opts.sim;
    const handsImg = sim ? simHands(sim.hold ? 5000 : now, eyeCentre, eyeDistPx, vw, vh, sim.tall ? 3.2 : 1).hands : vf.hands;
    const hands = handsImg.map((h) => h.map((p) => cover.toScreen(p)));
    this.hands = hands;
    const both = hands.length >= 2;
    const open = this.gate.update(both, both && hands.every((h) => isPinched(h)), t) || this.fullFrame;
    this.open = open;
    if (this.fullFrame) {
      // just past the canvas edge, so the window's frame line stays out of the picture
      const W = renderer.canvasWidth + 8, H = renderer.canvasHeight + 8;
      this.quad = [{ x: -8, y: -8 }, { x: W, y: -8 }, { x: W, y: H }, { x: -8, y: H }];
    } else if (open && both) {
      const raw = windowQuad(hands[0]!, hands[1]!);
      this.quad = raw.map((p, i) => this.cornerF[i]!.filter(p, t)) as typeof this.quad;
    } else if (!open) {
      this.cornerF.forEach((f) => f.reset());
    }
    if (open && !this.wasOpen) this.flash = 1;
    this.wasOpen = open;
    this.win += ((open ? 1 : 0) - this.win) * Math.min(1, dt * (open ? 14 : 6));
    this.flash = Math.max(0, this.flash - dt * 2.2);

    if (!this.still || !this.uploaded) renderer.setSource(src);
    this.uploaded = true;
    renderer.setMask(vf.mask);
    renderer.draw({
      map: [cover.ox, cover.oy, cover.dw, cover.dh],
      time: t,
      quad: this.quad,
      win: this.win,
      flash: this.flash,
      cam: this.cam,
      face,
      character: this.character,
      mask: maskMesh,
    });
    // dust is made from the picture as it looks right now (the character included), so it is read
    // back from the canvas in the same frame it was drawn
    if (this.pendingVanish) {
      const c = this.personCtx;
      c.canvas.width = vw;
      c.canvas.height = vh;
      c.setTransform(-vw / cover.dw, 0, 0, vh / cover.dh, vw + (cover.ox * vw) / cover.dw, (-cover.oy * vh) / cover.dh);
      c.drawImage(renderer.canvas, 0, 0);
      if (this.pendingVanish === 'snap') this.vanish.snap(c.canvas);
      else this.vanish.restore(c.canvas);
      this.pendingVanish = null;
    }
  }

  /** Snap or come back by key/button, same as the gestures. */
  toggleVanish(): void {
    if (this.vanish.state === 'live') this.pendingVanish = 'snap';
    else if (this.vanish.state === 'gone') this.pendingVanish = 'restore';
  }

  /**
   * Draw the vanish overlay (room where you stood, and dust) over the picture.
   * space: 'image' for a canvas in camera orientation, 'screen' for one laid out like the renderer's canvas.
   */
  drawVanish(ctx: CanvasRenderingContext2D, space: 'image' | 'screen'): void {
    if (this.vanish.state === 'live') return;
    const { cover, vw, vh } = this;
    if (space === 'screen') ctx.setTransform(-cover.dw / vw, 0, 0, cover.dh / vh, cover.ox + cover.dw, cover.oy);
    else ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.vanish.layer, 0, 0, vw, vh);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}
