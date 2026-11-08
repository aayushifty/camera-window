import { FaceLandmarker, FilesetResolver, HandLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { Pt } from './geom';
import type { P3 } from './face';

export type Src = HTMLVideoElement | HTMLImageElement;

export interface Mask {
  data: Uint8Array;
  w: number;
  h: number;
  version: number;
}

export interface VisionFrame {
  /** normalized, unmirrored image coords; up to 2 hands × 21 points */
  hands: Pt[][];
  /** the same hands in metres around the hand's centre (MediaPipe world landmarks), for 3D gestures */
  world: P3[][];
  /** 478 face landmarks (x, y normalized; z in x units) or null */
  face: P3[] | null;
  /** blendshape name → 0..1 */
  shapes: Record<string, number>;
  mask: Mask | null;
}

const SEG_W = 256;

/** Hand + face landmarks and a person mask, all running locally (wasm + models served from /public). */
export class Vision {
  private hand!: HandLandmarker;
  private face!: FaceLandmarker;
  private seg!: ImageSegmenter;
  private segCanvas = document.createElement('canvas');
  private segCtx = this.segCanvas.getContext('2d', { willReadFrequently: false })!;
  private mask: Mask | null = null;
  private lastTs = 0;
  private stillCache: VisionFrame | null = null;
  /** True once every model has loaded. */
  ready = false;
  private frameNo = 0;
  /** frame a hand was last tracked: a hand lost mid-snap (motion blur) is searched for every frame for a while */
  private handFrame = -1e9;
  private lastHands: { hands: Pt[][]; world: P3[][] } = { hands: [], world: [] };
  private maxHands = 2;
  private faceLast: { t: number; pts: P3[] } | null = null;
  private facePrev: { t: number; pts: P3[] } | null = null;
  private shapes: Record<string, number> = {};

  /** base: where `wasm/` and `models/` are served (the site root, or the extension's own URL). */
  async init(onStep: (msg: string) => void, base = '/'): Promise<void> {
    onStep('Loading the vision runtime');
    const fs = await FilesetResolver.forVisionTasks(`${base}wasm`);
    const make = async <T>(label: string, fn: (d: 'GPU' | 'CPU') => Promise<T>): Promise<T> => {
      onStep(`Loading ${label}`);
      try {
        return await fn('GPU');
      } catch {
        return await fn('CPU');
      }
    };
    this.hand = await make('hand tracking', (delegate) =>
      HandLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: `${base}models/hand_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        // kept low so a hand blurred by a fast snap stays tracked instead of being dropped mid-gesture
        minHandPresenceConfidence: 0.3,
        minTrackingConfidence: 0.3,
      }),
    );
    this.face = await make('face tracking', (delegate) =>
      FaceLandmarker.createFromOptions(fs, {
        baseOptions: { modelAssetPath: `${base}models/face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      }),
    );
    this.seg = await make('the silhouette model', (delegate) =>
      ImageSegmenter.createFromOptions(fs, {
        baseOptions: { modelAssetPath: `${base}models/selfie_segmenter.tflite`, delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      }),
    );
    this.ready = true;
  }

  /** Run all models on a frame. Still images are processed once and cached. */
  process(src: Src, w: number, h: number, still: boolean): VisionFrame {
    if (still && this.stillCache) return this.stillCache;
    const ts = Math.max(this.lastTs + 1, performance.now());
    this.lastTs = ts;

    // The models share the main thread with the call (~20-30 ms each on integrated graphics), so at most
    // one heavy model runs per frame and the picture stays near 30 fps:
    //   even frames: the face (and the person mask every 4th even frame)
    //   odd frames:  the hands while one is tracked or was just lost (motion blur), else the costly search
    //                for a new hand every 3rd odd frame, else the person mask
    // On frames without a fresh face, it is predicted from its last two positions so the mask keeps up.
    const n = this.frameNo++;
    const handsLive = n - this.handFrame <= 15;
    let segNow = still || !this.mask;
    if (still || n % 2 === 1) {
      if (still || handsLive || n % 6 === 1) {
        const hr = this.hand.detectForVideo(src, ts);
        this.lastHands = {
          hands: hr.landmarks.map((l) => l.map((p) => ({ x: p.x, y: p.y }))),
          world: hr.worldLandmarks.map((l) => l.map((p) => ({ x: p.x, y: p.y, z: p.z }))),
        };
        if (hr.landmarks.length) this.handFrame = n;
      } else segNow = true;
    }
    if (still || n % 2 === 0) {
      const fr = this.face.detectForVideo(src, ts);
      const fl = fr.faceLandmarks[0];
      this.facePrev = this.faceLast;
      this.faceLast = fl ? { t: ts, pts: fl.map((p) => ({ x: p.x, y: p.y, z: p.z })) } : null;
      this.shapes = {};
      for (const c of fr.faceBlendshapes[0]?.categories ?? []) this.shapes[c.categoryName] = c.score;
      if (n % 8 === 0) segNow = true;
    }
    const { hands, world } = this.lastHands;
    const face = this.predictFace(ts);
    const shapes = this.shapes;

    if (segNow) this.segment(src, w, h, ts, still);
    const out = { hands, world, face, shapes, mask: this.mask };
    if (still) this.stillCache = out;
    return out;
  }

  /** The last face found, moved on by its recent velocity (at most one detection interval ahead). */
  private predictFace(now: number): P3[] | null {
    const b = this.faceLast, a = this.facePrev;
    if (!b) return null;
    if (!a || b.t <= a.t || now <= b.t) return b.pts;
    const k = Math.min(1, (now - b.t) / (b.t - a.t));
    return b.pts.map((p, i) => {
      const q = a.pts[i]!;
      return { x: p.x + (p.x - q.x) * k, y: p.y + (p.y - q.y) * k, z: p.z };
    });
  }

  /**
   * Hands to track: 1 when only snapping (calls), 2 for the hand window. With fewer hands to find,
   * the hand model stops searching for another one every frame.
   */
  setMaxHands(n: 1 | 2): void {
    if (!this.ready || n === this.maxHands) return;
    this.maxHands = n;
    void this.hand.setOptions({ numHands: n });
  }

  private segment(src: Src, w: number, h: number, ts: number, still: boolean): void {
    const sw = SEG_W, sh = Math.max(1, Math.round((SEG_W * h) / w));
    if (this.segCanvas.width !== sw || this.segCanvas.height !== sh) {
      this.segCanvas.width = sw;
      this.segCanvas.height = sh;
      this.mask = null;
    }
    this.segCtx.drawImage(src, 0, 0, sw, sh);
    const r = this.seg.segmentForVideo(this.segCanvas, ts);
    const m = r.confidenceMasks?.[0];
    if (m) {
      const f = m.getAsFloat32Array();
      const prev = this.mask;
      const data = prev && prev.data.length === f.length ? prev.data : new Uint8Array(f.length);
      // temporal smoothing kills edge flicker on live video
      const k = still || !prev ? 1 : 0.6;
      for (let i = 0; i < f.length; i++) data[i] = data[i]! + k * (f[i]! * 255 - data[i]!);
      this.mask = { data, w: m.width, h: m.height, version: (prev?.version ?? 0) + 1 };
    }
    r.close();
  }
}
