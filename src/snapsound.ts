/**
 * Hears finger snaps: a snap is a sharp, loud click, high-pitched and starting within a few milliseconds.
 * The camera alone sees a snap as one or two blurred frames; the click is the reliable part.
 * It only says "a click happened at time t" — snap.ts decides whether your hand was in a snap pose.
 */

/** Click onset from the loudness of short high-passed blocks (~10 ms each). */
export class Onset {
  private bg = 0.004;
  private quiet = 0;
  /** rms: loudness of this block (0..1); returns true when this block is a click. */
  push(rms: number): boolean {
    const click = this.quiet <= 0 && rms > 0.02 && rms > 6 * this.bg;
    // a click spans 1-2 blocks: count it once, then ignore ~150 ms of its tail
    this.quiet = click ? 15 : this.quiet - 1;
    // the background follows quiet sound quickly and loud sound slowly, so one click barely moves it
    this.bg += (rms - this.bg) * (rms > this.bg ? 0.02 : 0.2);
    return click;
  }
}

export class ClickListener {
  /** performance.now() of the last click heard */
  lastClick = -1e9;
  private readonly ctx: AudioContext;
  private readonly nodes: AudioNode[];

  constructor(track: MediaStreamTrack) {
    const ctx = (this.ctx = new AudioContext());
    const src = ctx.createMediaStreamSource(new MediaStream([track]));
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2500; // a snap is mostly above this; voices mostly below
    // shortcut: ScriptProcessorNode is deprecated but runs on every page without loading a worklet file (call pages often block those)
    // big chunks (~85 ms) so a main thread busy with tracking can't make audio drop out; scanned in ~10 ms slices
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const onset = new Onset();
    const SLICE = 512;
    proc.onaudioprocess = (e) => {
      const d = e.inputBuffer.getChannelData(0);
      for (let o = 0; o + SLICE <= d.length; o += SLICE) {
        let s = 0;
        for (let i = o; i < o + SLICE; i++) s += d[i]! * d[i]!;
        if (onset.push(Math.sqrt(s / SLICE))) this.lastClick = performance.now() - ((d.length - o) / ctx.sampleRate) * 1000;
      }
    };
    const mute = ctx.createGain();
    mute.gain.value = 0; // the processor must reach the output to run; nothing is played
    src.connect(hp).connect(proc).connect(mute).connect(ctx.destination);
    this.nodes = [src, hp, proc, mute];
    // pages may only start audio after a click or key press
    const resume = () => void ctx.resume();
    addEventListener('pointerdown', resume, { once: true, capture: true });
    addEventListener('keydown', resume, { once: true, capture: true });
    track.addEventListener('ended', () => this.stop());
  }

  stop(): void {
    this.nodes.forEach((n) => n.disconnect());
    void this.ctx.close().catch(() => {});
  }
}
