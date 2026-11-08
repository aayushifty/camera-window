import type { Pt } from './geom';
import { MASK_FS, MASK_VS } from './overlay';
import { FRAG, VERT } from './shader';
import type { Mask, Src } from './vision';

export interface FaceUniforms {
  eyeL: Pt;
  eyeR: Pt;
  open: [number, number];
  c: Pt;
  ux: Pt;
  uy: Pt;
  s: number;
  /** x, y, radius in device px */
  irisA: [number, number, number];
  irisB: [number, number, number];
  /** upper lid xy, lower lid xy */
  lidA: [number, number, number, number];
  lidB: [number, number, number, number];
  /** hairline y and face half width in compositor face units */
  hairTop: [number, number];
  /** anime face: outline (36 xy), brows (10 xy) and feature points, screen px */
  oval: number[];
  brow: number[];
  cornA: [number, number, number, number];
  cornB: [number, number, number, number];
  blink: [number, number];
  mouth: [number, number, number, number];
  lips: [number, number, number, number];
  mouthS: [number, number];
  cheeks: [number, number, number, number];
  nose: [number, number, number, number];
  /** chin y in compositor face units */
  chin: number;
  /** head centre xy and half size xy in compositor face units */
  head: [number, number, number, number];
  /** nose bridge (lm 168) in compositor face units */
  hub: [number, number];
}

export interface MaskMesh {
  /** 10 floats per vertex: screen x, y, depth, local xyz, normal xyz, edge */
  verts: Float32Array;
  hub: Pt;
  eyeA: Pt;
  eyeB: Pt;
  open: [number, number];
  /** light direction in image space (toward the light, z toward camera negative) */
  light: [number, number, number];
  /** 0 raised silver webbing, 1 thin black webbing */
  style: number;
}

export interface DrawParams {
  map: [number, number, number, number];
  time: number;
  quad: [Pt, Pt, Pt, Pt];
  win: number;
  flash: number;
  cam: [number, number, number];
  face: FaceUniforms | null;
  character: number;
  mask: MaskMesh | null;
}

interface Prog {
  p: WebGLProgram;
  u: Map<string, WebGLUniformLocation | null>;
}

/** WebGL2: full-screen compositor, then the face mask geometry on top. All px are device px, y down. */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private comp: Prog;
  private maskP: Prog;
  private compVao: WebGLVertexArrayObject;
  private maskVao: WebGLVertexArrayObject;
  private maskBuf: WebGLBuffer;
  private maskIdx: WebGLBuffer;
  private maskCount = 0;
  private video: WebGLTexture;
  private maskTex: WebGLTexture;
  private maskVersion = -1;
  private hasMask = false;
  dpr = 1;

  constructor(readonly canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL2 is not available in this browser.');
    this.gl = gl;
    this.comp = this.link(VERT, FRAG);
    this.maskP = this.link(MASK_VS, MASK_FS);

    this.compVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.compVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.attrib(this.comp, 'aPos', 2, 2, 0);

    this.maskVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.maskVao);
    this.maskBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuf);
    this.attrib(this.maskP, 'aPos', 3, 10, 0);
    this.attrib(this.maskP, 'aLocal', 3, 10, 3);
    this.attrib(this.maskP, 'aNormal', 3, 10, 6);
    this.attrib(this.maskP, 'aEdge', 1, 10, 9);
    this.maskIdx = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.maskIdx);

    gl.bindVertexArray(null);

    this.video = this.tex();
    this.maskTex = this.tex();
    for (const pr of [this.comp, this.maskP]) {
      gl.useProgram(pr.p);
      gl.uniform1i(this.loc(pr, 'uVideo'), 0);
      gl.uniform1i(this.loc(pr, 'uMask'), 1);
    }
  }

  private attrib(pr: Prog, name: string, size: number, stride: number, offset: number): void {
    const gl = this.gl;
    const loc = gl.getAttribLocation(pr.p, name);
    if (loc < 0) return;
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, offset * 4);
  }

  private tex(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private link(vs: string, fs: string): Prog {
    const gl = this.gl;
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program: ${gl.getProgramInfoLog(p)}`);
    return { p, u: new Map() };
  }

  private loc(pr: Prog, name: string): WebGLUniformLocation | null {
    if (!pr.u.has(name)) pr.u.set(name, this.gl.getUniformLocation(pr.p, name));
    return pr.u.get(name)!;
  }

  get canvasWidth(): number {
    return this.canvas.width;
  }
  get canvasHeight(): number {
    return this.canvas.height;
  }

  /** dpr: pixels per CSS px; pass 1 to get a canvas of exactly cssW × cssH (the extension's video size). */
  resize(cssW: number, cssH: number, dpr = Math.min(window.devicePixelRatio || 1, 2)): void {
    this.dpr = dpr;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  setSource(src: Src): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.video);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  setMask(m: Mask | null): void {
    this.hasMask = !!m;
    if (!m || m.version === this.maskVersion) return;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, m.w, m.h, 0, gl.RED, gl.UNSIGNED_BYTE, m.data);
    this.maskVersion = m.version;
  }

  /** Face mesh triangle indices (fixed for the session). */
  setMaskIndices(idx: Uint16Array): void {
    this.maskCount = this.upload(this.maskVao, this.maskIdx, idx);
  }

  private upload(vao: WebGLVertexArrayObject, buf: WebGLBuffer, idx: Uint16Array): number {
    const gl = this.gl;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return idx.length;
  }

  private common(pr: Prog, p: DrawParams): (n: string) => WebGLUniformLocation | null {
    const gl = this.gl;
    gl.useProgram(pr.p);
    const L = (n: string) => this.loc(pr, n);
    gl.uniform2f(L('uRes'), this.canvas.width, this.canvas.height);
    gl.uniform4f(L('uMap'), ...p.map);
    gl.uniform1f(L('uHasMask'), this.hasMask ? 1 : 0);
    gl.uniform1f(L('uTime'), p.time);
    gl.uniform1f(L('uDpr'), this.dpr);
    gl.uniform2fv(L('uQ'), p.quad.flatMap((q) => [q.x, q.y]));
    gl.uniform1f(L('uWin'), p.win);
    gl.uniform3f(L('uCam'), ...p.cam);
    return L;
  }

  draw(p: DrawParams): void {
    const gl = this.gl;
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);

    // 1. compositor
    const L = this.common(this.comp, p);
    gl.uniform1f(L('uFlash'), p.flash);
    gl.uniform1i(L('uChar'), p.character);
    const f = p.face;
    gl.uniform1f(L('uFace'), f ? 1 : 0);
    if (f) {
      gl.uniform2f(L('uEyeL'), f.eyeL.x, f.eyeL.y);
      gl.uniform2f(L('uEyeR'), f.eyeR.x, f.eyeR.y);
      gl.uniform2f(L('uOpen'), f.open[0], f.open[1]);
      gl.uniform2f(L('uC'), f.c.x, f.c.y);
      gl.uniform2f(L('uUx'), f.ux.x, f.ux.y);
      gl.uniform2f(L('uUy'), f.uy.x, f.uy.y);
      gl.uniform1f(L('uS'), f.s);
      gl.uniform3f(L('uIrisA'), ...f.irisA);
      gl.uniform3f(L('uIrisB'), ...f.irisB);
      gl.uniform4f(L('uLidA'), ...f.lidA);
      gl.uniform4f(L('uLidB'), ...f.lidB);
      gl.uniform2f(L('uHairTop'), ...f.hairTop);
      gl.uniform2fv(L('uOval'), f.oval);
      gl.uniform2fv(L('uBrow'), f.brow);
      gl.uniform4f(L('uCornA'), ...f.cornA);
      gl.uniform4f(L('uCornB'), ...f.cornB);
      gl.uniform2f(L('uBlink'), ...f.blink);
      gl.uniform4f(L('uMouth'), ...f.mouth);
      gl.uniform4f(L('uLips'), ...f.lips);
      gl.uniform2f(L('uMouthS'), ...f.mouthS);
      gl.uniform4f(L('uCheeks'), ...f.cheeks);
      gl.uniform4f(L('uNose'), ...f.nose);
      gl.uniform1f(L('uChin'), f.chin);
      gl.uniform4f(L('uHead'), ...f.head);
      gl.uniform2f(L('uWebHub'), ...f.hub);
      gl.uniform1f(L('uWebStyle'), p.mask ? p.mask.style : 0);
    }
    gl.bindVertexArray(this.compVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (p.win > 0.001) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);

      // 2. face mask, depth-tested so the far side of a turned head stays hidden
      if (p.mask && this.maskCount) {
        const m = p.mask;
        const M = this.common(this.maskP, p);
        gl.uniform2f(M('uHub'), m.hub.x, m.hub.y);
        gl.uniform2f(M('uEyeA'), m.eyeA.x, m.eyeA.y);
        gl.uniform2f(M('uEyeB'), m.eyeB.x, m.eyeB.y);
        gl.uniform2f(M('uOpen'), m.open[0], m.open[1]);
        gl.uniform3f(M('uLight'), ...m.light);
        gl.uniform1f(M('uWebStyle'), m.style);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LESS);
        gl.clear(gl.DEPTH_BUFFER_BIT);
        gl.bindVertexArray(this.maskVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuf);
        gl.bufferData(gl.ARRAY_BUFFER, m.verts, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, this.maskCount, gl.UNSIGNED_SHORT, 0);
        gl.disable(gl.DEPTH_TEST);
      }

      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}
