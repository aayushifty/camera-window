import { FaceLandmarker } from '@mediapipe/tasks-vision';
import { headFrame, toLocal, toWorld, trianglesFromEdges, vertexNormals, type P3 } from './face';
import type { Cover, Pt } from './geom';
import type { MaskMesh } from './renderer';

const N = 468;
/** Lower face outline from ear to ear; the mask continues below it over the neck. */
const JAW = [454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234];
/** Jaw points around the chin: no edge fade there, so the mask flows into the neck strip. */
const CHIN = new Set([397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172]);
/** Upper face outline, ear to ear over the forehead; the mask grows a dome over the head from it. */
const TOP = [234, 127, 162, 21, 54, 103, 67, 109, 10, 338, 297, 332, 284, 251, 389, 356, 454];
const RINGS = 3;
const DOME = N + JAW.length;
const V = DOME + TOP.length * RINGS;

/** Eye openings and inner lip, as ordered landmark loops (MediaPipe face mesh). */
const HOLES = [
  [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246],
  [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466],
  [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191],
];

/** Builds per-frame GPU vertex data for the face mask from face landmarks. */
export class FaceRig {
  readonly tris: Uint16Array;
  /** face-mesh triangles only (no neck strip): used for normals */
  private faceTris: number[];
  private edge = new Float32Array(N);
  private oval: number[] = [];
  private normals = new Float32Array(N * 3);
  private maskVerts = new Float32Array(V * 10);

  constructor() {
    const tris = trianglesFromEdges(FaceLandmarker.FACE_LANDMARKS_TESSELATION, N);
    // the face mesh leaves the eyes and mouth open: close them so the mask covers them
    for (const loop of HOLES) for (let i = 1; i < loop.length - 1; i++) tris.push(loop[0]!, loop[i]!, loop[i + 1]!);
    this.faceTris = tris.slice();
    // neck strip: each jaw point gets a partner below it
    for (let i = 0; i < JAW.length - 1; i++) {
      const a = JAW[i]!, b = JAW[i + 1]!, ea = N + i, eb = N + i + 1;
      tris.push(a, b, ea, b, eb, ea);
    }
    // head dome: rings that grow outward from the crown; segmentation trims it to the real head
    for (let k = 0; k < RINGS; k++) {
      for (let i = 0; i < TOP.length - 1; i++) {
        const a = k === 0 ? TOP[i]! : DOME + (k - 1) * TOP.length + i;
        const b = k === 0 ? TOP[i + 1]! : DOME + (k - 1) * TOP.length + i + 1;
        const c = DOME + k * TOP.length + i, d = c + 1;
        tris.push(a, b, c, b, d, c);
      }
    }
    this.tris = Uint16Array.from(tris);
    for (const { start, end } of FaceLandmarker.FACE_LANDMARKS_FACE_OVAL) {
      this.edge[start] = 1;
      this.edge[end] = 1;
      this.oval.push(start);
    }
    for (const j of CHIN) this.edge[j] = 0;
    for (const j of TOP) this.edge[j] = 0; // the mask continues over the head
  }

  /** lm: normalized landmarks (x, y in 0..1, z in x units). */
  mask(lm: P3[], vw: number, vh: number, cover: Cover, blink: [number, number], light: [number, number, number], style: number): MaskMesh {
    const P = this.toPx(lm, vw, vh);
    const h = headFrame(P);
    vertexNormals(P, this.faceTris, this.normals);
    const v = this.maskVerts;
    for (let i = 0; i < N; i++) {
      const l = toLocal(h, P[i]!);
      const s = cover.toScreen(lm[i]!);
      const o = i * 10;
      v[o] = s.x;
      v[o + 1] = s.y;
      v[o + 2] = Math.max(-0.99, Math.min(0.99, 0.5 - l.z * 0.35));
      v[o + 3] = l.x;
      v[o + 4] = l.y;
      v[o + 5] = l.z;
      v[o + 6] = this.normals[i * 3]!;
      v[o + 7] = this.normals[i * 3 + 1]!;
      v[o + 8] = this.normals[i * 3 + 2]!;
      v[o + 9] = this.edge[i]!;
    }
    // neck strip below the jaw (clipped by segmentation in the shader)
    JAW.forEach((j, k) => {
      const l = toLocal(h, P[j]!);
      const nl = { x: l.x * 0.72, y: l.y - 1.0, z: l.z - 0.3 };
      const w = toWorld(h, nl);
      const s = cover.toScreen({ x: w.x / vw, y: w.y / vh });
      const o = (N + k) * 10;
      v[o] = s.x;
      v[o + 1] = s.y;
      v[o + 2] = Math.max(-0.99, Math.min(0.99, 0.5 - nl.z * 0.35));
      v[o + 3] = nl.x;
      v[o + 4] = nl.y;
      v[o + 5] = nl.z;
      v[o + 6] = this.normals[j * 3]!;
      v[o + 7] = this.normals[j * 3 + 1]! * 0.3;
      v[o + 8] = this.normals[j * 3 + 2]!;
      v[o + 9] = 1;
    });
    const top = toLocal(h, P[10]!).y;
    TOP.forEach((j, i) => {
      const l = toLocal(h, P[j]!);
      const cy = top - 0.75;
      for (let k = 1; k <= RINGS; k++) {
        const f = 1 + 0.3 * k;
        const nl = { x: l.x * (1 + 0.12 * k), y: cy + (l.y - cy) * f, z: l.z - 0.32 * k };
        const w = toWorld(h, nl);
        const s = cover.toScreen({ x: w.x / vw, y: w.y / vh });
        // outward-facing normal, tilting away from the camera as the dome curves back
        const lx = nl.x, ly = nl.y - cy, lz = 0.9 - 0.25 * k;
        const ln = Math.hypot(lx, ly, lz) || 1;
        const nx = (h.ex.x * lx + h.ey.x * ly + h.ez.x * lz) / ln;
        const ny = (h.ex.y * lx + h.ey.y * ly + h.ez.y * lz) / ln;
        const nz = (h.ex.z * lx + h.ey.z * ly + h.ez.z * lz) / ln;
        const o = (DOME + (k - 1) * TOP.length + i) * 10;
        v[o] = s.x;
        v[o + 1] = s.y;
        v[o + 2] = Math.max(-0.99, Math.min(0.99, 0.5 - nl.z * 0.35));
        v[o + 3] = nl.x;
        v[o + 4] = nl.y;
        v[o + 5] = nl.z;
        v[o + 6] = nx;
        v[o + 7] = ny;
        v[o + 8] = nz;
        v[o + 9] = 0;
      }
    });
    const loc = (i: number) => toLocal(h, P[i]!);
    const mid = (a: number, b: number): Pt => {
      const p = loc(a), q = loc(b);
      return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    };
    const hub = loc(168);
    return { verts: v, hub: { x: hub.x, y: hub.y }, eyeA: mid(33, 133), eyeB: mid(263, 362), open: blink, light, style };
  }

  private toPx(lm: P3[], vw: number, vh: number): P3[] {
    const P: P3[] = new Array(N);
    for (let i = 0; i < N; i++) P[i] = { x: lm[i]!.x * vw, y: lm[i]!.y * vh, z: lm[i]!.z * vw };
    return P;
  }
}
