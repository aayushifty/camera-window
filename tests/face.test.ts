import { describe, expect, it } from 'vitest';
import { headFrame, toLocal, toWorld, trianglesFromEdges, vertexNormals, type P3 } from '../src/face';

describe('trianglesFromEdges', () => {
  it('recovers the triangles of a triangulated square and of a tetrahedron', () => {
    const sq = [[0, 1], [1, 2], [2, 3], [3, 0], [0, 2]].map(([start, end]) => ({ start: start!, end: end! }));
    expect(trianglesFromEdges(sq, 4).length / 3).toBe(2);
    const k4 = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(([start, end]) => ({ start: start!, end: end! }));
    expect(trianglesFromEdges(k4, 4).length / 3).toBe(4);
  });
});

/** Face landmarks needed by headFrame, in px (image coords, y down, z toward camera negative). */
function face(yaw = 0): P3[] {
  const P: P3[] = Array.from({ length: 478 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, x: number, y: number, z: number) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    P[i] = { x: 500 + x * c + z * s, y: 300 + y, z: -x * s + z * c };
  };
  put(33, -50, 0, 0);
  put(263, 50, 0, 0);
  put(10, 0, -70, -10);
  put(152, 0, 110, -5);
  put(1, 0, 40, -40);
  return P;
}

describe('headFrame', () => {
  it('gives the same local coords for a point whether the head is frontal or turned', () => {
    const a = face(0), b = face(0.5);
    const ha = headFrame(a), hb = headFrame(b);
    const la = toLocal(ha, a[1]!), lb = toLocal(hb, b[1]!);
    expect(lb.x).toBeCloseTo(la.x, 5);
    expect(lb.y).toBeCloseTo(la.y, 5);
    expect(lb.z).toBeCloseTo(la.z, 5);
    expect(la.z).toBeGreaterThan(0); // nose tip sticks out toward the camera
    expect(toLocal(ha, a[10]!).y).toBeGreaterThan(0); // +y is up the face
    const w = toWorld(hb, lb);
    expect(w.x).toBeCloseTo(b[1]!.x, 5);
    expect(w.y).toBeCloseTo(b[1]!.y, 5);
  });
});

describe('vertexNormals', () => {
  it('points every normal toward the camera (negative z)', () => {
    const P: P3[] = [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }];
    expect(vertexNormals(P, [0, 1, 2])[2]).toBeCloseTo(-1);
    expect(vertexNormals(P, [0, 2, 1])[2]).toBeCloseTo(-1);
  });
});
