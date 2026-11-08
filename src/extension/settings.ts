/** What the extension popup saves (chrome.storage.sync) and the call page reads. */
export interface Settings {
  /** Transform the camera at all. */
  enabled: boolean;
  /** Character id from characters.ts: 'shadow', 'web' or 'void' (Anime). */
  character: string;
  /** Effect over the whole picture (true), or only inside the window between your pinched hands (false). */
  fullFrame: boolean;
  /** Web look: 0 raised silver webbing, 1 thin black webbing. */
  webStyle: number;
  /** Snap your fingers to vanish into dust. */
  snap: boolean;
  /** Set to Date.now() by the popup's "Capture my room" button; each new value starts one capture. */
  captureAt: number;
  /** The popup's record button: true while recording; switching it off saves the video file. */
  recording: boolean;
}

export const DEFAULTS: Settings = { enabled: true, character: 'void', fullFrame: true, webStyle: 0, snap: true, captureAt: 0, recording: false };
