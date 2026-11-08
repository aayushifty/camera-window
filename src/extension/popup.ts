/** The toolbar popup: reads and saves Settings in chrome.storage.sync; open calls pick changes up within a frame. */
import { CHARACTERS } from '../characters';
import { DEFAULTS, type Settings } from './settings';

declare const chrome: any;

const form = document.getElementById('settings') as HTMLFormElement;
const chars = document.getElementById('characters')!;
for (const c of CHARACTERS) {
  const label = document.createElement('label');
  label.innerHTML = `<input type="radio" name="character"> <span></span>`;
  const input = label.querySelector('input')!;
  input.value = c.id;
  label.querySelector('span')!.textContent = c.name;
  chars.append(label);
}

const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement & RadioNodeList;

chrome.storage.sync.get(DEFAULTS, (s: Settings) => {
  field('enabled').checked = s.enabled;
  field('character').value = s.character;
  field('mode').value = s.fullFrame ? 'full' : 'window';
  field('black').checked = s.webStyle === 1;
  field('snap').checked = s.snap;
});

const rec = document.getElementById('record') as HTMLButtonElement;
let recording = false;
const showRec = () => {
  rec.textContent = recording ? 'Stop and save video' : 'Start recording';
  rec.setAttribute('aria-pressed', String(recording));
};
chrome.storage.sync.get({ recording: false }, (s: { recording: boolean }) => {
  recording = s.recording;
  showRec();
});
rec.addEventListener('click', () => {
  recording = !recording;
  chrome.storage.sync.set({ recording });
  showRec();
});

document.getElementById('capture')!.addEventListener('click', () => {
  chrome.storage.sync.set({ captureAt: Date.now() });
  (document.getElementById('captureNote') as HTMLElement).hidden = false;
});

form.addEventListener('change', () => {
  const s: Omit<Settings, 'captureAt' | 'recording'> = {
    enabled: field('enabled').checked,
    character: field('character').value || DEFAULTS.character,
    fullFrame: field('mode').value !== 'window',
    webStyle: field('black').checked ? 1 : 0,
    snap: field('snap').checked,
  };
  chrome.storage.sync.set(s); // captureAt and recording are left as they are: only their buttons set them
});
