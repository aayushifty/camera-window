import '@fontsource-variable/bricolage-grotesque';
import './styles.css';
import { CHARACTERS, characterIndex } from './characters';
import { Engine } from './engine';
import { Recorder } from './recorder';
import { isPinched } from './geom';
import { Ui } from './ui';
import { Vision } from './vision';

const params = new URLSearchParams(location.search);
/** Only same-origin relative paths are accepted as a source. */
const safeSource = (s: string | null) => (s && !/^[a-z]+:|^\/\//i.test(s) ? s : null);
const sourcePath = safeSource(params.get('source'));
const simulate = params.get('sim') === '1';
/** ?hold=1 freezes the simulated gesture with the window fully open (for screenshots). */
const simHold = params.get('hold') === '1';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const marks = document.getElementById('marks') as HTMLCanvasElement;
const mctx = marks.getContext('2d')!;
const vision = new Vision();
const engine = new Engine(canvas, vision, simulate ? { sim: { hold: simHold, tall: params.get('tall') === '1' } } : {});
const renderer = engine.renderer;
/** Web look: 0 raised silver webbing, 1 thin black webbing (V or ?web=black). */
engine.webStyle = params.get('web') === 'black' ? 1 : 0;

const ui = new Ui(document.getElementById('ui')!, {
  onCharacter: (i) => setCharacter(i),
  onRetry: () => location.reload(),
});
function setCharacter(i: number) {
  engine.character = (i + CHARACTERS.length) % CHARACTERS.length;
  ui.setCharacter(engine.character);
}
setCharacter(characterIndex(params.get('char')));

/** R records the picture (effects and overlay, no interface) to a .webm file. */
const recorder = new Recorder();
const recCanvas = document.createElement('canvas');
const rctx = recCanvas.getContext('2d')!;
function toggleRecording() {
  if (recorder.recording) return recorder.stop();
  const k = Math.min(1, 1920 / canvas.width); // at most 1080p-wide, however large the screen
  recCanvas.width = Math.round(canvas.width * k);
  recCanvas.height = Math.round(canvas.height * k);
  recorder.start(recCanvas.captureStream(30));
}

let ready = false;
let still = false;

async function openSource(): Promise<void> {
  if (sourcePath && /\.(png|jpe?g|webp)$/i.test(sourcePath)) {
    const img = new Image();
    img.src = sourcePath;
    await img.decode();
    still = true;
    engine.setSource(img, img.naturalWidth, img.naturalHeight, true);
    return;
  }
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  if (sourcePath) {
    video.src = sourcePath;
    video.loop = true;
  } else {
    video.srcObject = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
  }
  await video.play();
  engine.setSource(video, video.videoWidth, video.videoHeight, false);
}

function resize() {
  renderer.resize(innerWidth, innerHeight);
  marks.width = canvas.width;
  marks.height = canvas.height;
}
addEventListener('resize', resize);
resize();

function frame(now: number) {
  requestAnimationFrame(frame);
  if (!ready) return;
  engine.step(now);
  const { hands, win, open } = engine;

  // fingertip markers while the window is not formed
  mctx.clearRect(0, 0, marks.width, marks.height);
  engine.drawVanish(mctx, 'screen');
  if (win < 0.6) {
    const a = 1 - win / 0.6;
    const r = 5 * renderer.dpr;
    for (const h of hands) {
      const pinched = isPinched(h);
      for (const k of [4, 8]) {
        const p = h[k]!;
        mctx.beginPath();
        mctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        if (pinched) {
          mctx.fillStyle = `rgba(224,40,74,${a})`;
          mctx.fill();
          mctx.strokeStyle = `rgba(237,230,214,${a * 0.9})`;
          mctx.lineWidth = renderer.dpr;
          mctx.stroke();
        } else {
          mctx.strokeStyle = `rgba(237,230,214,${a})`;
          mctx.lineWidth = 1.5 * renderer.dpr;
          mctx.stroke();
        }
      }
    }
  }

  if (recorder.recording) {
    rctx.drawImage(canvas, 0, 0, recCanvas.width, recCanvas.height); // same frame it was drawn, so WebGL can be read
    rctx.drawImage(marks, 0, 0, recCanvas.width, recCanvas.height);
  }

  ui.setWindowOpen(win > 0.5);
  const n = hands.length;
  const handsText = n === 0 ? 'No hands in view' : n === 1 ? 'One hand in view' : open ? 'Window open' : 'Pinch both hands to open';
  const v = engine.vanish.state;
  const palm = engine.snap.palmProgress;
  const vanishText = v === 'gone' ? (palm > 0 ? `Coming back ${Math.round(palm * 100)}%` : 'Vanished. Snap or hold an open palm to come back') : '';
  const recText = recorder.recording ? `Recording ${Math.floor(recorder.seconds / 60)}:${String(recorder.seconds % 60).padStart(2, '0')} (R to stop). ` : '';
  ui.setStatus(recText + (engine.captureText() || vanishText || `${simulate ? 'Simulated hands. ' : ''}${handsText}${engine.faceSeen ? '' : ', no face found'}`));
}

addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key >= '1' && e.key <= String(CHARACTERS.length)) setCharacter(Number(e.key) - 1);
  else if (e.key === 'ArrowRight') setCharacter(engine.character + 1);
  else if (e.key === 'ArrowLeft') setCharacter(engine.character - 1);
  else if (e.key === 'v' || e.key === 'V') engine.webStyle = 1 - engine.webStyle;
  else if (e.key === 'h' || e.key === 'H') ui.toggleHidden();
  else if (e.key === 's' || e.key === 'S') snapshot();
  else if (e.key === 'x' || e.key === 'X') engine.toggleVanish();
  else if (e.key === 'c' || e.key === 'C') engine.captureRoom();
  else if (e.key === 'r' || e.key === 'R') toggleRecording();
});

function snapshot() {
  const out = document.createElement('canvas');
  out.width = canvas.width;
  out.height = canvas.height;
  const c = out.getContext('2d')!;
  c.drawImage(canvas, 0, 0);
  c.drawImage(marks, 0, 0);
  const a = document.createElement('a');
  a.download = `henshin-${Date.now()}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
}

declare global {
  interface Window {
    __henshin: { state(): object; setCharacter(i: number): void };
  }
}
window.__henshin = {
  state: () => ({
    fps: Math.round(engine.fps),
    hands: engine.hands.length,
    win: +engine.win.toFixed(3),
    face: engine.faceSeen,
    character: CHARACTERS[engine.character]!.id,
    quad: engine.quad,
    vanish: engine.vanish.state,
    snapHands: engine.snap.debug.map((f) => ({ pinch: +f.pinch.toFixed(2), slam: +f.slam.toFixed(2), open: f.open })),
    still,
  }),
  setCharacter,
};

async function boot() {
  try {
    ui.loading('Opening the camera');
    await openSource();
  } catch (e) {
    const name = (e as Error).name;
    ui.error(
      name === 'NotAllowedError'
        ? 'Camera access is off. Allow it from the camera icon in the address bar, then try again.'
        : name === 'NotFoundError'
          ? 'No camera was found. Plug one in, then try again.'
          : `The camera could not start (${(e as Error).message}).`,
    );
    return;
  }
  try {
    await vision.init((m) => ui.loading(m));
  } catch (e) {
    ui.error(`Tracking models did not load (${(e as Error).message}). Run "npm run setup", then try again.`);
    return;
  }
  ui.loading(null);
  ready = true;
  requestAnimationFrame(frame);
}
boot();
