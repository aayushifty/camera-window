/**
 * Runs inside the call page's own JavaScript world, so it can wrap the page's camera request.
 * The page asks for the camera and gets henshin's canvas instead; the microphone passes through untouched.
 * Everything runs on this computer. If anything fails, the page gets the plain camera, so a call never breaks.
 */
import { CHARACTERS } from '../characters';
import { Engine } from '../engine';
import { Recorder } from '../recorder';
import { Vision } from '../vision';
import { DEFAULTS, type Settings } from './settings';

const root = document.documentElement;

/** Settings the extension's content script mirrors onto <html data-henshin>. */
function settings(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(root.dataset.henshin ?? '{}') };
  } catch {
    return DEFAULTS;
  }
}

/** Pages that enforce Trusted Types reject plain script URLs; let only this extension's own files through. */
function allowExtensionScripts(base: string): void {
  const tt = (window as unknown as { trustedTypes?: { defaultPolicy: unknown; createPolicy(n: string, p: object): unknown } }).trustedTypes;
  if (!tt || tt.defaultPolicy) return;
  try {
    tt.createPolicy('default', { createScriptURL: (u: string) => (u.startsWith(base) ? u : null) });
  } catch {
    // the page restricts policy names: the models may not load, and the camera then passes through unchanged
  }
}

let vision: Vision | null = null;
/** Models load once per page, on the first camera request. */
function getVision(base: string): Vision {
  if (!vision) {
    vision = new Vision();
    allowExtensionScripts(base);
    vision.init(() => {}, base).catch((e) => console.warn('[henshin] tracking models did not load; the camera passes through unchanged.', e));
  }
  return vision;
}

async function transform(stream: MediaStream): Promise<MediaStream> {
  const base = root.dataset.henshinBase;
  if (!base) throw new Error('extension URL missing');
  const cam = stream.getVideoTracks()[0]!;
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([cam]);
  await video.play();
  const w = video.videoWidth || 1280, h = video.videoHeight || 720;

  const v = getVision(base);
  const engine = new Engine(document.createElement('canvas'), v);
  engine.renderer.resize(w, h, 1);
  engine.setSource(video, w, h, false);

  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d')!;
  let running = true;
  let timer = 0;
  // a capture pressed before this camera started doesn't count; only new presses of the popup button do
  let seenCapture = settings().captureAt;
  // likewise only a change of the record button counts
  let seenRecording = settings().recording;
  const recorder = new Recorder();
  const loop = () => {
    if (!running) return;
    const started = performance.now();
    const s = settings();
    if (s.enabled && v.ready) {
      engine.character = Math.max(0, CHARACTERS.findIndex((c) => c.id === s.character));
      engine.fullFrame = s.fullFrame;
      engine.webStyle = s.webStyle;
      engine.snapEnabled = s.snap;
      engine.step(performance.now());
      ctx.setTransform(-1, 0, 0, 1, w, 0); // drawn mirrored like a selfie view; the call gets the true picture
      ctx.drawImage(engine.renderer.canvas, 0, 0, w, h);
      engine.drawVanish(ctx, 'image');
      if (s.captureAt !== seenCapture) {
        seenCapture = s.captureAt;
        engine.captureRoom();
      }
      const msg = engine.captureText();
      if (msg) drawNote(ctx, msg, w, h);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0); // off, or models still loading: the plain camera
      ctx.drawImage(video, 0, 0, w, h);
    }
    if (s.recording !== seenRecording) {
      seenRecording = s.recording;
      // what the call sees, plus the call's microphone if this stream carries it
      if (s.recording) recorder.start(new MediaStream([...out.captureStream(30).getVideoTracks(), ...stream.getAudioTracks()]));
      else recorder.stop();
    }
    // shortcut: timers slow down when the call tab is in the background, so keep the call tab visible
    timer = window.setTimeout(loop, Math.max(0, 1000 / 30 - (performance.now() - started)));
  };
  loop();

  const track = out.captureStream(30).getVideoTracks()[0]!;
  const stopOut = track.stop.bind(track);
  track.stop = () => {
    running = false;
    clearTimeout(timer);
    recorder.stop(); // the call ended mid-recording: save what there is
    cam.stop();
    stopOut();
  };
  cam.addEventListener('ended', () => track.stop());
  return new MediaStream([track, ...stream.getAudioTracks()]);
}

/** A short message on the video (room-capture countdown). Seen in the call too, for those few seconds. */
function drawNote(ctx: CanvasRenderingContext2D, text: string, w: number, h: number): void {
  const size = Math.round(h * 0.045);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const x = (w - tw) / 2, y = h - size * 2.2;
  ctx.fillStyle = 'rgba(16,16,20,0.72)';
  ctx.beginPath();
  ctx.roundRect(x - size * 0.7, y - size * 1.1, tw + size * 1.4, size * 1.6, size * 0.4);
  ctx.fill();
  ctx.fillStyle = '#ede6d6';
  ctx.fillText(text, x, y);
}

const md = navigator.mediaDevices;
if (md?.getUserMedia) {
  const real = md.getUserMedia.bind(md);
  md.getUserMedia = async (c?: MediaStreamConstraints) => {
    const stream = await real(c);
    if (!c?.video || !settings().enabled || !stream.getVideoTracks().length) return stream;
    try {
      return await transform(stream);
    } catch (e) {
      console.warn('[henshin] camera passed through unchanged:', e);
      return stream;
    }
  };
}
