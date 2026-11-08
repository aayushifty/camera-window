/**
 * 3D face helpers. Points are in image px: x right, y down, z = landmark.z · videoWidth
 * (negative = toward the camera).
 */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: P3, b: P3) => a.x * b.x + a.y * b.y + a.z * b.z;
const mul = (a: P3, s: number): P3 => ({ x: a.x * s, y: a.y * s, z: a.z * s });
const norm = (a: P3): P3 => mul(a, 1 / (Math.hypot(a.x, a.y, a.z) || 1));
const cross = (a: P3, b: P3): P3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Triangles of a mesh given only its edges: every 3-cycle of edges. */
export function trianglesFromEdges(edges: { start: number; end: number }[], n: number): number[] {
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const { start: a, end: b } of edges) {
    if (a < n && b < n && a !== b) {
      adj[a]!.add(b);
      adj[b]!.add(a);
    }
  }
  const out: number[] = [];
  for (let a = 0; a < n; a++)
    for (const b of adj[a]!) if (b > a) for (const c of adj[b]!) if (c > b && adj[a]!.has(c)) out.push(a, b, c);
  return out;
}

/** Head-local frame: origin between the outer eye corners, unit = their distance, +x toward lm 263, +y up the face, +z toward the camera. */
export interface Head {
  o: P3;
  ex: P3;
  ey: P3;
  ez: P3;
  s: number;
}

export function headFrame(P: P3[]): Head {
  const R = P[33]!, L = P[263]!;
  const o = mul({ x: R.x + L.x, y: R.y + L.y, z: R.z + L.z }, 0.5);
  const across = sub(L, R);
  const s = Math.hypot(across.x, across.y, across.z) || 1e-6;
  const ex = mul(across, 1 / s);
  const up = sub(P[10]!, P[152]!);
  const ey = norm(sub(up, mul(ex, dot(up, ex))));
  const ez = cross(ex, ey);
  return { o, ex, ey, ez, s };
}

export function toLocal(h: Head, p: P3): P3 {
  const d = sub(p, h.o);
  return { x: dot(d, h.ex) / h.s, y: dot(d, h.ey) / h.s, z: dot(d, h.ez) / h.s };
}

export function toWorld(h: Head, l: P3): P3 {
  return {
    x: h.o.x + (h.ex.x * l.x + h.ey.x * l.y + h.ez.x * l.z) * h.s,
    y: h.o.y + (h.ex.y * l.x + h.ey.y * l.y + h.ez.y * l.z) * h.s,
    z: h.o.z + (h.ex.z * l.x + h.ey.z * l.y + h.ez.z * l.z) * h.s,
  };
}

/** Smooth per-vertex normals (flat xyz array), each turned to face the camera (−z). */
export function vertexNormals(P: P3[], tris: number[], out = new Float32Array(P.length * 3)): Float32Array {
  out.fill(0);
  for (let i = 0; i < tris.length; i += 3) {
    const a = tris[i]!, b = tris[i + 1]!, c = tris[i + 2]!;
    let n = cross(sub(P[b]!, P[a]!), sub(P[c]!, P[a]!));
    if (n.z > 0) n = mul(n, -1);
    for (const k of [a, b, c]) {
      out[k * 3] = out[k * 3]! + n.x;
      out[k * 3 + 1] = out[k * 3 + 1]! + n.y;
      out[k * 3 + 2] = out[k * 3 + 2]! + n.z;
    }
  }
  for (let k = 0; k < P.length; k++) {
    const l = Math.hypot(out[k * 3]!, out[k * 3 + 1]!, out[k * 3 + 2]!) || 1;
    out[k * 3] = out[k * 3]! / l;
    out[k * 3 + 1] = out[k * 3 + 1]! / l;
    out[k * 3 + 2] = out[k * 3 + 2]! / l;
  }
  return out;
}
