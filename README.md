# henshin

Hold up both hands, pinch thumb and index together on both, then pull them apart. A window opens between them:
- Index fingertips make the top edge.
- Thumb tips make the bottom edge.

Only that pinch opens the window. Two hands in view without a pinch do nothing. The window closes when a hand is gone for a moment, and opening it again needs a new pinch.

Through that window you become someone else. Outside it you stay you.

Everything runs locally in the browser: MediaPipe hand, face and selfie segmentation, plus one WebGL2 shader. Nothing is uploaded.

## Characters

| Key | Character | Inside the window |
|---|---|---|
| 1 | Shadow | Your silhouette turns black and two warm eyes glow where yours are. A dashed line runs down the face. |
| 2 | Web | A full red hood: your whole head (face, hair, ears and neck) becomes fabric, and none of your face shows through. The hood follows the whole head, not just the eyes, so it still covers you when you turn. If the face is lost for a moment, the last mask is held. Once a pinch opens it, the mask sits on the whole head and is not cut by the window; the room and your body stay as they are. On the face, a deep-red mask with a fine honeycomb weave, UV-mapped onto the 3D face mesh, so it turns with you. Shading and a rim light follow the light measured from the camera. Two web looks (V switches): raised silver cords with dark grooves (16 spokes), or thin black lines (12 spokes). Big shield lenses: a pointed inner tip low by the nose, a straight top edge rising to a tall rounded outer end, thick black frames and pale icy-blue glass. Lenses narrow when you blink or squint. |
| 3 | Anime | A soft painted anime face over yours. Pale warm skin in soft cel bands, blush on the cheeks and nose tip, a nose highlight, and the fringe's shadow on the forehead. Amber eyes with sparkles and a lash line, which blink with you. A mouth that follows yours: it smiles, and opens with your jaw or a big smile, showing teeth and a tongue. Your own hair, kept where it is (its shape and your real fringe), drawn as anime line art: a flat navy-black fill that is darker at the crown, a black ink outline pushed out into small pointed tufts, thin tapered black strand lines flowing down from the crown, small pale highlight ticks, and jagged ends by the ears. The room turns painterly. |

Overlay colours follow the camera's white balance and exposure, and get light film grain, so they sit in the same light as you.

## Run

```bash
npm install
```

```bash
npm run dev
```

`npm install` also downloads the models and copies the wasm runtime into `public/`.

Then open http://localhost:5173 and allow the camera. You can also use the **Henshin** shortcut on the Desktop: it starts the server and opens an app window.

To try it without a camera:
- `?source=fixtures/2.png&sim=1` uses a sample photo with scripted hands.
- `?source=fixtures/face.jpg&sim=1&hold=1` uses a clean real face (the first frame of the reference video), with the window held open.
- `?source=clip.mp4` plays any video in `public/` in a loop.
- `&char=web` or `&char=void` sets the starting character.
- `&web=black` starts Web with the thin black webbing.

## Use it in video calls (Chrome extension)

```bash
npm run build:extension
```

1. Open `chrome://extensions`, turn on Developer mode, click **Load unpacked** and pick `dist-extension`.
2. Join a call in Chrome (Meet, Zoom web, Teams web, Discord web). The call gets the transformed camera; your microphone is untouched.
3. Click the extension's toolbar icon to pick the character, and choose "All the time" or "Only between my pinched hands".

Everything runs on your computer. If tracking fails to load on a site, that site gets your plain camera. Keep the call tab in front: Chrome slows background tabs. Desktop apps (Zoom, Teams apps) are not covered; use their browser versions.

Dev check without a camera: `npm run dev`, then open `/tests/extension-harness.html?char=web`.

## Keys

| Key | Action |
|---|---|
| 1–3 or ←/→ | Change character |
| V | Web: switch silver / black webbing |
| H | Hide the interface |
| S | Save a PNG snapshot |
| X | Vanish / come back (same as snapping) |

## Snap to vanish

Snap your fingers and you blow away as dust, leaving your room behind. Snap again, or hold an open palm for 2 seconds, to come back. The room is learned from whatever the camera sees around you, so move about a little first for a cleaner result.

A snap only counts when the thumb presses the middle fingertip, then both come apart while the middle finger slams into the palm, within about half a second. Resting, relaxed or slowly opening hands don't trigger it. If real snaps are missed, the thresholds are the `SNAP` values in `src/snap.ts`; `window.__henshin.state().snapHands` shows the live `pinch` and `slam` numbers.

## Files

- `src/geom.ts` is pure geometry:
  - cover-fit mirroring
  - the window quad from two hands
  - pinch detection
  - the face frame
  - eye openness
  - One Euro smoothing
- `src/vision.ts` runs the MediaPipe models. The mask runs at 256 px wide with temporal smoothing. Still images are processed once.
- `src/shader.ts` composites one full-screen pass: glass, silhouette, characters, eyes, outline.
- `src/renderer.ts` is the WebGL2 setup and uniforms.
- `src/sim.ts` is the scripted two-hand gesture for testing.
- `src/ui.ts` and `src/styles.css` are the HUD. `src/main.ts` is the main loop.
- `launcher/` contains:
  - the Desktop shortcut installer
  - the start and stop scripts
  - the icon

See [TESTING.md](TESTING.md) for what has been verified.
