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
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
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

    const hr = this.hand.detectForVideo(src, ts);
    const hands = hr.landmarks.map((l) => l.map((p) => ({ x: p.x, y: p.y })));
    const fr = this.face.detectForVideo(src, ts);
    const fl = fr.faceLandmarks[0];
    const face = fl ? fl.map((p) => ({ x: p.x, y: p.y, z: p.z })) : null;
    const shapes: Record<string, number> = {};
    for (const c of fr.faceBlendshapes[0]?.categories ?? []) shapes[c.categoryName] = c.score;

    this.segment(src, w, h, ts, still);
    const out = { hands, face, shapes, mask: this.mask };
    if (still) this.stillCache = out;
    return out;
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
