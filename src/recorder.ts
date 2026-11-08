/** Records a stream (the transformed picture, plus any audio track given) and saves it as a .webm file. */
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private started = 0;

  get recording(): boolean {
    return this.rec !== null;
  }

  /** Seconds recorded so far, 0 when not recording. */
  get seconds(): number {
    return this.rec ? Math.floor((performance.now() - this.started) / 1000) : 0;
  }

  start(stream: MediaStream): void {
    if (this.rec) return;
    const type = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t));
    this.chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
    rec.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    rec.onstop = () => this.save(new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }));
    rec.start(1000); // a chunk every second, so a crash loses at most a second
    this.rec = rec;
    this.started = performance.now();
  }

  /** Stop and download the file. */
  stop(): void {
    if (!this.rec) return;
    if (this.rec.state !== 'inactive') this.rec.stop();
    this.rec = null;
  }

  private save(blob: Blob): void {
    if (!blob.size) return;
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `henshin-${stamp}.webm`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
  }
}
