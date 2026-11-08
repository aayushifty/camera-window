import { CHARACTERS } from './characters';

export interface UiHandlers {
  onCharacter(i: number): void;
  onRetry(): void;
}

/** Quiet HUD at the edges; the window in the middle is the show. */
export class Ui {
  private status: HTMLElement;
  private hint: HTMLElement;
  private name: HTMLElement;
  private line: HTMLElement;
  private chips: HTMLButtonElement[] = [];
  private overlay: HTMLElement;
  private overlayMsg: HTMLElement;
  private overlayActions: HTMLElement;

  constructor(private root: HTMLElement, h: UiHandlers) {
    root.innerHTML = `
      <header class="top">
        <span class="mark">henshin</span>
        <span class="status" role="status" aria-live="polite"></span>
      </header>
      <p class="hint">Pinch thumb and index on both hands, then pull them apart. Your fingers frame the window.</p>
      <footer class="bottom">
        <div class="who">
          <h1 class="name"></h1>
          <p class="line"></p>
        </div>
        <nav class="cast" role="radiogroup" aria-label="Character"></nav>
      </footer>
      <div class="overlay" hidden>
        <div class="card">
          <p class="msg"></p>
          <div class="actions"></div>
        </div>
      </div>`;
    const q = <T extends HTMLElement>(s: string) => root.querySelector(s) as T;
    this.status = q('.status');
    this.hint = q('.hint');
    this.name = q('.name');
    this.line = q('.line');
    this.overlay = q('.overlay');
    this.overlayMsg = q('.msg');
    this.overlayActions = q('.actions');
    const cast = q('.cast');
    CHARACTERS.forEach((c, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.style.setProperty('--eye', c.eye);
      b.style.setProperty('--glow', c.glow);
      b.innerHTML = `<span class="eyes" aria-hidden="true"><i></i><i></i></span><span>${c.name}</span><kbd>${i + 1}</kbd>`;
      b.addEventListener('click', () => h.onCharacter(i));
      cast.appendChild(b);
      this.chips.push(b);
    });
    this.onRetry = h.onRetry;
  }

  private onRetry: () => void;

  setCharacter(i: number): void {
    const c = CHARACTERS[i]!;
    this.name.textContent = c.name;
    this.line.textContent = c.line;
    this.chips.forEach((b, j) => b.setAttribute('aria-checked', String(i === j)));
  }

  setStatus(text: string): void {
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  setWindowOpen(open: boolean): void {
    this.hint.classList.toggle('gone', open);
  }

  toggleHidden(): void {
    this.root.classList.toggle('hidden');
  }

  loading(msg: string | null): void {
    if (msg === null) {
      this.overlay.hidden = true;
      return;
    }
    this.overlay.hidden = false;
    this.overlay.classList.remove('error');
    this.overlayMsg.textContent = msg;
    this.overlayActions.replaceChildren();
  }

  error(msg: string): void {
    this.overlay.hidden = false;
    this.overlay.classList.add('error');
    this.overlayMsg.textContent = msg;
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.textContent = 'Try the camera again';
    retry.addEventListener('click', () => this.onRetry());
    const sample = document.createElement('a');
    sample.href = '?source=fixtures/2.png&sim=1';
    sample.textContent = 'Open a sample photo instead';
    this.overlayActions.replaceChildren(retry, sample);
  }
}
