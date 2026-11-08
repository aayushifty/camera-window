/**
 * Runs in the extension's isolated world on every page. The page-world script (inject.ts) cannot call
 * chrome.* APIs, so this mirrors the extension URL and the popup's settings onto <html data-*>.
 */
import { DEFAULTS } from './settings';

declare const chrome: any; // shortcut: no @types/chrome dependency for three calls

const root = document.documentElement;
root.dataset.henshinBase = chrome.runtime.getURL('');

const mirror = () =>
  chrome.storage.sync.get(DEFAULTS, (s: object) => {
    root.dataset.henshin = JSON.stringify(s);
  });
mirror();
chrome.storage.onChanged.addListener(mirror);
