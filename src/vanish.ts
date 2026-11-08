/**
 * Snap-to-vanish: learns your room wherever you are not, and on a snap blows you away as dust,
 * leaving the room behind. Everything is in camera image space (not mirrored); the result is
 * `layer`, transparent while you are visible, to be drawn over the picture.
 */
import type { Mask, Src } from './vision';

export type VanishState = 'live' | 'vanishing' | 'gone' | 'returning';

const DUST_LAYERS = 20;
const DUST_MAX_W = 960;
const DURATION_MS = 2400;

/** Room capture: a countdown to step out of frame, then the empty room is recorded and locked. */
export const CAPTURE = { countdownMs: 3000, recordMs: 2500, doneShownMs: 2500 };

/** Where a room capture started at `start` stands at `now`. */
export function captureStage(start: number, now: number): { stage: 'countdown' | 'recording' | 'done'; secondsLeft: number } {
  const t = now - start;
  if (t < CAPTURE.countdownMs) return { stage: 'countdown', secondsLeft: Math.ceil((CAPTURE.countdownMs - t) / 1000) };
  if (t < CAPTURE.countdownMs + CAPTURE.recordMs) return { stage: 'recording', secondsLeft: 0 };
  return { stage: 'done', secondsLeft: 0 };
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
type Ctx = CanvasRenderingContext2D;
function pair(w: number, h: number, opts?: CanvasRenderingContext2DSettings): [HTMLCanvasElement, Ctx] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', opts)!];
}

interface Dust {
  layers: { c: HTMLCanvasElement; start: number; len: number; dx: number; dy: number; rot: number }[];
  embers: { x: number; y: number; li: number; vx: number; vy: number; s: number; warm: boolean }[];
  scratch: HTMLCanvasElement;
  scratchCtx: Ctx;
  LW: number;
  LH: number;
  cx: number;
  cy: number;
}

export class Vanish {
  state: VanishState = 'live';
  /** The overlay to draw: room where you were, plus dust while animating. */
  readonly layer: HTMLCanvasElement;
  private readonly ctx: Ctx;
  private W = 0;
  private H = 0;
  private c!: Record<'plate' | 'tmp' | 'fill' | 'pfill' | 'mRaw' | 'mHard' | 'mPrev' | 'mDil0' | 'mDil' | 'mExcl', [HTMLCanvasElement, Ctx]>;
  private levels: { c: HTMLCanvasElement; ctx: Ctx; w: number; h: number }[] = [];
  private sl: [HTMLCanvasElement, Ctx] | null = null;
  private maskImg: ImageData | null = null;
  private maskVersion = -1;
  private hasMask = false;
  private plateSeeded = false;
  private hasFill = false;
  /** a room capture in progress (start time), and whether the captured room is locked in */
  private capture: number | null = null;
  private captureDoneAt = -1e9;
  roomLocked = false;
  private dust: Dust | null = null;
  private animStart = 0;

  constructor() {
    [this.layer, this.ctx] = pair(1, 1);
  }

  private ensureSize(w: number, h: number, mw: number, mh: number): void {
    if (w === this.W && h === this.H && this.c?.mRaw[0].width === mw && this.c.mRaw[0].height === mh) return;
    this.W = this.layer.width = w;
    this.H = this.layer.height = h;
    this.c = {
      plate: pair(w, h),
      tmp: pair(w, h),
      fill: pair(w, h),
      pfill: pair(w, h),
      mRaw: pair(mw, mh),
      mHard: pair(mw, mh),
      mPrev: pair(mw, mh),
      mDil0: pair(mw, mh),
      mDil: pair(mw, mh),
      mExcl: pair(mw, mh),
    };
    this.levels = [];
    let lw = Math.max(4, Math.round(w / 4)), lh = Math.max(4, Math.round(h / 4));
    while (lw >= 2 && lh >= 2) {
      const [c, ctx] = pair(lw, lh);
      this.levels.push({ c, ctx, w: lw, h: lh });
      lw = Math.floor(lw / 2);
      lh = Math.floor(lh / 2);
    }
    this.maskImg = new ImageData(mw, mh);
    this.hasMask = this.plateSeeded = this.hasFill = false;
  }

  /** Per frame: learn the room from the camera frame and person mask, then redraw `layer`. */
  update(frame: Src, w: number, h: number, mask: Mask | null, now: number): void {
    if (!mask) return;
    this.ensureSize(w, h, mask.w, mask.h);
    if (mask.version !== this.maskVersion) {
      this.maskVersion = mask.version;
      this.updateMask(mask);
    }
    if (this.capture !== null && captureStage(this.capture, now).stage === 'done') {
      this.capture = null;
      this.roomLocked = true; // frozen from now on, so your shadow or a passer-by never gets baked in
      this.captureDoneAt = now;
    }
    this.updatePlate(frame, now);
    this.render(now);
  }

  /** Start a room capture: 3 s to step out of frame, then the empty room is recorded and locked. */
  captureRoom(now: number): void {
    if (this.state !== 'live') return;
    this.roomLocked = false;
    this.capture = now;
  }

  /** What to tell the user about a room capture right now, or null. */
  captureText(now: number): string | null {
    if (this.capture !== null) {
      const c = captureStage(this.capture, now);
      return c.stage === 'countdown' ? `Step out of frame… ${c.secondsLeft}` : 'Recording your room… stay out';
    }
    return now - this.captureDoneAt < CAPTURE.doneShownMs ? 'Room captured. Come back and snap' : null;
  }

  /** Start vanishing. person: the picture as it looks now, in image space, to turn to dust. */
  snap(person: CanvasImageSource): boolean {
    if (this.state !== 'live' || !this.hasMask) return false;
    this.fillPlate();
    this.dust = this.buildDust(person);
    this.animStart = performance.now();
    this.state = 'vanishing';
    return true;
  }

  restore(person: CanvasImageSource): boolean {
    if (this.state !== 'gone') return false;
    this.dust = this.buildDust(person);
    this.animStart = performance.now();
    this.state = 'returning';
    return true;
  }

  private updateMask(mask: Mask): void {
    const { mRaw, mHard, mPrev, mDil0, mDil, mExcl } = this.c;
    const img = this.maskImg!;
    for (let i = 0; i < mask.data.length; i++) img.data[i * 4 + 3] = mask.data[i]!;
    mRaw[1].putImageData(img, 0, 0);
    const aw = mask.w, ah = mask.h;

    // keep the previous mask: hiding uses the union of the last two, so a body that moved is still covered
    mPrev[1].globalCompositeOperation = 'copy';
    mPrev[1].drawImage(mHard[0], 0, 0);

    // hard mask: anything even partly you counts as you
    const hc = mHard[1];
    hc.globalCompositeOperation = 'copy';
    hc.drawImage(mRaw[0], 0, 0);
    hc.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 3; k++) hc.drawImage(mHard[0], 0, 0);

    // hide mask: union grown by a margin, then made solid with only a short feather
    const rad = Math.max(4, Math.round(aw * 0.028));
    mDil0[1].clearRect(0, 0, aw, ah);
    stamp(mDil0[1], mHard[0], rad);
    stamp(mDil0[1], mPrev[0], rad);
    const dc = mDil[1];
    dc.globalCompositeOperation = 'copy';
    dc.filter = `blur(${Math.max(1, Math.round(rad * 0.35))}px)`;
    dc.drawImage(mDil0[0], 0, 0);
    dc.filter = 'none';
    dc.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 3; k++) dc.drawImage(mDil[0], 0, 0);

    // room-learning exclusion: wider still, so your edges never get baked into the room
    mExcl[1].clearRect(0, 0, aw, ah);
    stamp(mExcl[1], mDil[0], Math.round(rad * 0.8));
    this.hasMask = true;
  }

  private updatePlate(frame: Src, now: number): void {
    const { W, H } = this;
    const { tmp, plate, mExcl } = this.c;
    const t = tmp[1];
    t.globalCompositeOperation = 'copy';
    t.drawImage(frame, 0, 0, W, H);
    t.globalCompositeOperation = 'destination-out';
    t.drawImage(mExcl[0], 0, 0, W, H);
    t.globalCompositeOperation = 'source-over';
    if (this.roomLocked) return;
    const p = plate[1];
    // while recording a capture, the room is taken at full strength; otherwise it is blended in gently
    const recording = this.capture !== null && captureStage(this.capture, now).stage === 'recording';
    p.globalAlpha = this.plateSeeded && !recording ? 0.4 : 1;
    p.drawImage(tmp[0], 0, 0);
    p.globalAlpha = 1;
    this.plateSeeded = true;
  }

  /** Push-pull hole filling, then a per-row bridge so walls continue across where you stood. */
  private fillPlate(): void {
    const L = this.levels;
    if (!L.length) return;
    const { plate, fill } = this.c;
    L[0]!.ctx.globalCompositeOperation = 'copy';
    L[0]!.ctx.drawImage(plate[0], 0, 0, L[0]!.w, L[0]!.h);
    for (let i = 1; i < L.length; i++) {
      L[i]!.ctx.globalCompositeOperation = 'copy';
      L[i]!.ctx.drawImage(L[i - 1]!.c, 0, 0, L[i]!.w, L[i]!.h);
    }
    // drawing a semi-transparent image over itself keeps its colour but pushes alpha toward 1
    const top = L[L.length - 1]!;
    top.ctx.globalCompositeOperation = 'source-over';
    for (let k = 0; k < 6; k++) top.ctx.drawImage(top.c, 0, 0);
    for (let i = L.length - 2; i >= 0; i--) {
      L[i]!.ctx.globalCompositeOperation = 'destination-over';
      L[i]!.ctx.drawImage(L[i + 1]!.c, 0, 0, L[i]!.w, L[i]!.h);
    }
    const f = fill[1];
    f.globalCompositeOperation = 'copy';
    f.drawImage(L[0]!.c, 0, 0, this.W, this.H);
    f.globalCompositeOperation = 'source-over';
    // strong blur: each bridged row is a flat colour band, and rows differ (walls vs furniture)
    f.filter = `blur(${Math.max(4, Math.round(this.W / 45))}px)`;
    f.drawImage(this.scanlineFill(), 0, 0, this.W, this.H);
    f.filter = 'none';
    f.drawImage(plate[0], 0, 0);
    this.hasFill = true;
  }

  private scanlineFill(): HTMLCanvasElement {
    const sw = Math.max(16, Math.round(this.W / 8)), sh = Math.max(9, Math.round(this.H / 8));
    if (!this.sl || this.sl[0].width !== sw || this.sl[0].height !== sh) this.sl = pair(sw, sh, { willReadFrequently: true });
    const [sc, c] = this.sl;
    c.globalCompositeOperation = 'copy';
    c.drawImage(this.c.plate[0], 0, 0, sw, sh);
    const img = c.getImageData(0, 0, sw, sh);
    bridgeRows(img.data, sw, sh);
    c.putImageData(img, 0, 0);
    return sc;
  }

  private render(now: number): void {
    const o = this.ctx;
    o.clearRect(0, 0, this.W, this.H);
    if (this.state === 'live') return;
    if (this.state === 'gone') {
      this.hidePerson(1);
    } else if (this.state === 'vanishing') {
      const t = clamp01((now - this.animStart) / DURATION_MS);
      this.hidePerson(1);
      this.drawDust(t, 1);
      if (t >= 1) {
        this.dust = null;
        this.state = 'gone';
      }
    } else {
      const p = clamp01((now - this.animStart) / (DURATION_MS * 0.8));
      const k = clamp01((p - 0.7) / 0.3); // final crossfade to the live you
      this.hidePerson(1 - k);
      this.drawDust(1 - p, 1 - k);
      if (p >= 1) {
        this.dust = null;
        this.state = 'live';
      }
    }
  }

  private hidePerson(alpha: number): void {
    if (!this.hasFill || alpha <= 0) return;
    const { pfill, fill, mDil } = this.c;
    if (this.roomLocked) {
      // a captured room replaces the whole picture: your shadow, and light you block, go with you
      this.ctx.globalAlpha = alpha;
      this.ctx.drawImage(fill[0], 0, 0);
      this.ctx.globalAlpha = 1;
      return;
    }
    const pf = pfill[1];
    pf.globalCompositeOperation = 'copy';
    pf.drawImage(fill[0], 0, 0);
    pf.globalCompositeOperation = 'destination-in';
    pf.drawImage(mDil[0], 0, 0, this.W, this.H);
    pf.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = alpha;
    this.ctx.drawImage(pfill[0], 0, 0);
    this.ctx.globalAlpha = 1;
  }

  /** Slice you into layers of random grains; each layer blows away on its own schedule. */
  private buildDust(source: CanvasImageSource): Dust {
    const { W, H } = this;
    const LW = Math.min(W, DUST_MAX_W), LH = Math.round((H * LW) / W);
    const [, sctx] = pair(LW, LH, { willReadFrequently: true });
    sctx.drawImage(source, 0, 0, LW, LH);
    sctx.globalCompositeOperation = 'destination-in';
    sctx.drawImage(this.c.mHard[0], 0, 0, LW, LH);
    const src = sctx.getImageData(0, 0, LW, LH).data;

    let minX = LW, maxX = 0, minY = LH, maxY = 0;
    for (let y = 0; y < LH; y += 4) {
      for (let x = 0; x < LW; x += 4) {
        if (src[(y * LW + x) * 4 + 3]! > 40) {
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (maxX <= minX) [minX, maxX, minY, maxY] = [0, LW, 0, LH];

    // low-frequency value noise so the dissolve eats away in organic patches
    const GW = 9, GH = 7;
    const grid = Array.from({ length: GW * GH }, Math.random);
    const noise = (x: number, y: number) => {
      const fx = (x / LW) * (GW - 1), fy = (y / LH) * (GH - 1);
      const ix = Math.min(GW - 2, fx | 0), iy = Math.min(GH - 2, fy | 0);
      const tx = fx - ix, ty = fy - iy;
      const a = grid[iy * GW + ix]!, b = grid[iy * GW + ix + 1]!;
      const c = grid[(iy + 1) * GW + ix]!, d = grid[(iy + 1) * GW + ix + 1]!;
      return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    };

    const K = DUST_LAYERS;
    const datas = Array.from({ length: K }, () => new ImageData(LW, LH));
    const embers: Dust['embers'] = [];
    const G = 2;
    const spanX = maxX - minX + 1;
    for (let y = 0; y < LH; y += G) {
      for (let x = 0; x < LW; x += G) {
        const i0 = (y * LW + x) * 4;
        if (src[i0 + 3]! < 12) continue;
        const v = clamp01((0.45 * ((x - minX) / spanX) + 0.55 * noise(x, y) + (Math.random() - 0.5) * 0.32 + 0.16) / 1.32);
        const li = Math.min(K - 1, (v * K) | 0);
        const dst = datas[li]!.data;
        for (let yy = y; yy < Math.min(LH, y + G); yy++) {
          for (let xx = x; xx < Math.min(LW, x + G); xx++) {
            const i = (yy * LW + xx) * 4;
            dst[i] = src[i]!;
            dst[i + 1] = src[i + 1]!;
            dst[i + 2] = src[i + 2]!;
            dst[i + 3] = src[i + 3]!;
          }
        }
        if (Math.random() < 0.006 && embers.length < 900) {
          embers.push({
            x: (x / LW) * W,
            y: (y / LH) * H,
            li,
            vx: (0.1 + Math.random() * 0.25) * W,
            vy: -(0.05 + Math.random() * 0.2) * H,
            s: 1 + Math.random() * 2.2,
            warm: Math.random() < 0.35,
          });
        }
      }
    }

    const layers = datas.map((data, i) => {
      const [c, ctx] = pair(LW, LH);
      ctx.putImageData(data, 0, 0);
      const ang = -0.15 - Math.random() * 0.55; // mostly up and to one side
      return {
        c,
        start: (i / K) * 0.55,
        len: 0.38 + Math.random() * 0.07,
        dx: Math.cos(ang) * (0.18 + Math.random() * 0.22) * W,
        dy: Math.sin(ang) * (0.18 + Math.random() * 0.22) * H * 1.4,
        rot: (Math.random() - 0.5) * 0.2,
      };
    });
    const [scratch, scratchCtx] = pair(LW, LH);
    return { layers, embers, scratch, scratchCtx, LW, LH, cx: ((minX + maxX) / 2 / LW) * W, cy: ((minY + maxY) / 2 / LH) * H };
  }

  private drawDust(t: number, alphaMul: number): void {
    const D = this.dust;
    if (!D || alphaMul <= 0) return;
    const o = this.ctx, s = D.scratchCtx, { W, H } = this;
    for (const L of D.layers) {
      const local = clamp01((t - L.start) / L.len);
      if (local >= 1) continue;
      const e = local * local;
      o.save();
      o.globalAlpha = Math.pow(1 - local, 1.4) * alphaMul;
      o.translate(D.cx + L.dx * e, D.cy + L.dy * e);
      o.rotate(L.rot * e);
      o.scale(1 + 0.08 * e, 1 + 0.08 * e);
      o.translate(-D.cx, -D.cy);
      if (local > 0) {
        // grains fade toward ash as they blow away
        s.globalCompositeOperation = 'copy';
        s.drawImage(L.c, 0, 0);
        s.globalCompositeOperation = 'source-atop';
        s.fillStyle = `rgba(62,48,40,${Math.min(0.75, local * 1.6)})`;
        s.fillRect(0, 0, D.LW, D.LH);
        o.drawImage(D.scratch, 0, 0, W, H);
      } else {
        o.drawImage(L.c, 0, 0, W, H);
      }
      o.restore();
    }
    o.save();
    o.globalCompositeOperation = 'lighter';
    for (const p of D.embers) {
      const L = D.layers[p.li]!;
      const local = clamp01((t - L.start) / (L.len * 1.4));
      if (local <= 0 || local >= 1) continue;
      const a = (1 - local) * alphaMul;
      o.fillStyle = p.warm ? `rgba(255,150,70,${a * 0.9})` : `rgba(190,170,150,${a * 0.6})`;
      const e = local * (0.6 + 0.4 * local);
      o.fillRect(p.x + p.vx * e, p.y + p.vy * e, p.s, p.s);
    }
    o.restore();
  }
}

/** Union of `src` shifted around a circle of radius r (a cheap dilation). */
function stamp(ctx: Ctx, src: HTMLCanvasElement, r: number): void {
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(src, 0, 0);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    ctx.drawImage(src, Math.cos(a) * r, Math.sin(a) * r);
    ctx.drawImage(src, Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5);
  }
}

/** Fill each row's unknown runs (alpha < 128) by blending the known colours on either side. RGBA, in place. */
export function bridgeRows(d: Uint8ClampedArray, sw: number, sh: number): void {
  const known = (i: number) => d[i * 4 + 3]! >= 128;
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    let x = 0;
    while (x < sw) {
      if (known(row + x)) {
        x++;
        continue;
      }
      const a = x;
      while (x < sw && !known(row + x)) x++;
      const L = a > 0 ? (row + a - 1) * 4 : -1;
      const R = x < sw ? (row + x) * 4 : -1;
      if (L < 0 && R < 0) continue; // whole row unknown: the push-pull fill underneath covers it
      for (let k = a; k < x; k++) {
        const t = (k - a + 1) / (x - a + 1);
        const o = (row + k) * 4;
        for (let ch = 0; ch < 3; ch++) {
          const lv = L >= 0 ? d[L + ch]! : d[R + ch]!;
          const rv = R >= 0 ? d[R + ch]! : d[L + ch]!;
          d[o + ch] = lv + (rv - lv) * t;
        }
        d[o + 3] = 255;
      }
    }
  }
}
