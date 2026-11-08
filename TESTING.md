# Testing

```bash
npm run typecheck
```

```bash
npm test
```

```bash
npm run build
```

## Update: line-art hair, smaller eyes (2026-11-08)

- `toonHair` now draws the user's real hair like the reference the user sent:
  - a flat navy-black fill
  - an ink outline on the real silhouette, pushed out into pointed tufts (`hairShape`/`tuft`)
  - thin tapered black strand lines from the crown
  - small pale highlight ticks
- The hair is clipped to a tufted head outline and ends in jagged tips by the ears, so a person mask that spills into a dark wall no longer smears blue beside the face.
- Anime eyes are about 15% smaller.
- Verified on `fixtures/face.jpg`. Frame: `after-anime-v12-lineart-hair.png`. Typecheck clean, `vitest` 14/14, build OK.
- Not verified: live camera.

## Update: anime keeps your own hair (2026-11-08)

- The painted hair (`animeHair`, `lockSD`, `paintLock`, `fringeSD`) is gone. `toonHair` in `src/shader.ts` redraws the user's real hair where it is:
  - it is found as dark person pixels around the head, plus the real fringe above the brows
  - black tones come from the hair's real light
  - a soft white sheen band crosses the crown, broken up by the real strands
  - white highlights on bright strands, black ink in the dark gaps, and an ink outline
- Verified on `fixtures/face.jpg`: the hair keeps its own shape and fringe, in black with white shading. Frame: `after-anime-v11-own-hair-black.png`. Typecheck clean, `vitest` 14/14, build OK.
- Limit: hair is told from skin by darkness, so light blond hair would read as skin.
- Not verified: live camera, moving hair.

## Update: pinch gate, full Web hood, painted anime hair (2026-11-08, recording 1303)

### Verified
- **Pinch gate:** `WindowGate` in `src/geom.ts` has 5 unit tests:
  - two hands with no pinch never open the window
  - a held pinch, then release, opens it
  - a one-frame pinch blip is ignored
  - a short dropout stays open, a real loss closes it, and reopening needs a new pinch
  - `hold=1` is pre-armed
- **Web,** on `fixtures/face.jpg` with `&tall=1` (the window over the whole head): every part of the head is red fabric, and no face, hair or ear shows. The hood is centred on a head box built from the face outline, not on the eyes. Frame: `after-web-v11-headbox.png`.
- **Anime,** same photo:
  - short, messy brown hair sized to the head box: a rounded mass with an inked jagged outline, uneven tufts, clump lines from the crown, a broken shine band and a teal rim
  - locks over the temples
  - a fringe of 9 loose bangs falling forward to the brows, casting a shadow on the forehead, with the brows showing through
  - no spikes or horns
  - Frame: `after-anime-v10-messy-fringe.png`.
- **Checks:** typecheck is clean and `vitest` passes 14/14.

### Not verified
- Head turns: the hood follows the nose shift by design, but a still photo can't turn.
- Holding the last face for 0.6 s when tracking drops.
- The no-face fallback, where the person in the window is covered with fabric.
- Teeth and the open mouth (the photo has a closed mouth).
- Live camera.

## Update: hair cards removed (2026-11-08)

- The strand-card hair (`rig.hair`, `buildStrands`, `HAIR_VS`/`HAIR_FS`, the renderer hair pass) has been deleted. Anime hair is now painted in the compositor over the segmented hair, and the fringe follows the user's real cut line on the forehead.
- Anything below about hair cards, locks or sway is history.
- Checks: typecheck is clean, `vitest` passes 9/9, and the build succeeds.

## Update: rebuilt from three reference images (2026-11-08)

### Verified

- **Checks:** typecheck is clean and `vitest` passes 9/9.
- **Web (silver look),** on `fixtures/face.jpg` with the window held open:
  - angular lenses with the inner tip down to the nose and the outer tip swept up
  - thick black frames and white-silver glass
  - raised silver webbing on deep-red fabric
  - The first try made the lenses far too wide: they met over the nose like one shape. Fixed by narrowing them.
  - Frame saved as `after-web-v3-silver.jpg`.
- **Web (black look,** `&web=black`): thin black webbing on red, and smoky glass that runs warm orange to blue-grey, with a gold rim. The two frames nearly touch over the nose bridge. Frame saved as `after-web-v3-black.jpg`. The V key itself was not pressed in the test.
- **Anime,** on `fixtures/face.jpg`: amber-brown eyes with a crease, pale warm skin, blush, a nose highlight, and dark-brown hair with a teal rim. Frame saved as `after-anime-v3-amber.jpg`.

### Not verified

- **Head dome:** not checked on its own. The held window crops the top of the head.
- **Not seen yet:** lips, orange background and side locks. They fall outside the held window, or the background is too dark in the fixture.
- **Hair (reworked):** about twice as many locks, each thinner. Each lock widens just past the root and then tapers to a point. Locks follow a gentle S-curve, with strand streaks and darker roots. On the fixture they read as wavy locks, not blades, but the front bangs are still a little spiky. Frame saved as `after-anime-v4-hair.jpg`. Sway is untested.
- **Live camera:** still untested.

## Update: anime face and Web upgrade (2026-11-08)

### Verified

- **Checks:** typecheck is clean, `vitest` passes 9/9, and the build succeeds (203 kB JS).
- **Anime,** on `fixtures/face.jpg` with the window held open: the whole face inside the window is repainted. You get cel-shaded peach skin, big painted eyes (lashes, gradient irises, two catchlights), painted brows, blush, and white cel-shaded hair clumps with highlights.
  - The first version left blocky tone patches. Fixed by taking the light level from a soft disc blur.
- **Web,** on `fixtures/face.jpg`: finer web lines, lens frames with a bevel, and shading driven by the measured face light.
- **Bug fixed:** the new neck strip crashed the normals pass on every frame and froze the canvas. Fixed and re-verified.
- **Before and after frames** are in the notes folder:
  - `before-anime-live*.png` (from the user's recording)
  - `before-web.png`
  - `after-anime.jpg`
  - `after-web*.jpg/png`

### Not verified

- **Below the window:** the mouth line, jaw line art, Web neck strip and suit fall outside the held window in the test setup, so they have not been seen yet.
- **Live camera:** nothing has been checked live. That includes blink and smile on camera.

## Verified (2026-11-08)

- **Typecheck:** `tsc --noEmit` is clean.
- **Tests:** `vitest run` passes 9/9.
  - `tests/geom.test.ts` covers:
    - cover-fit mirror
    - window corner order
    - pinch
    - face axes
    - eye openness
    - One Euro smoothing
  - `tests/face.test.ts` covers:
    - triangles rebuilt from mesh edges
    - the head frame gives the same local coordinates when the head turns 0.5 rad, which is what keeps the Web mask fixed to the face
    - vertex normals face the camera
- **Build:** `vite build` succeeds. The JS bundle is 193 kB (61 kB gzip).
- **Browser checks:** simulated hands with the window held open (`&hold=1`), real MediaPipe face tracking. Screenshots are in the session notes folder.
  - **Web**, on `fixtures/2.png` and on `fixtures/face.jpg` (a real face in a dark room):
    - the red fabric mask sits on the face mesh
    - web spokes start at the nose bridge
    - the lenses are filled white with black frames
    - the mask is tinted to the room light
    - the mask is clipped to the window and to the person
  - **Void**, on `fixtures/face.jpg`: the irises are recoloured blue and the pupils and whites stay real. White upswept hair shows above the forehead inside the window.
  - **Shadow:** unchanged since the last check.
  - **Console:** no errors besides TFLite's info lines.

## Not verified / simulated only

- **Live camera:** never used. The built-in browser blocks camera access, so all hands were simulated and every face was a still photo.
- **Motion-dependent behaviour:** never seen moving:
  - the mask following yaw and pitch on a live, moving head (only a unit test covers it)
  - lens blinking via blendshapes
  - hair sway
  - temporal stability
- **Ability effects:** the old twin/spiral/beam/lightning/domain effects no longer exist. They were removed when the user asked for a full rebuild matching their video.

## What still looks off

- **Hair:** reads as cut-paper spikes. The cards have straight edges and there is no real volume or per-strand lighting. The window usually crops most of it.
- **Web lenses:** the top frame is thick and merges into a heavy black brow line.
- **Mask edges:** the mask ends at the MediaPipe face outline, so it does not wrap the sides or back of the head, and the real hair stays visible above it.
- **Sample fixtures:** `fixtures/1–3` are concept art with effects already painted over the eyes, so they make poor test images. Use `fixtures/face.jpg`.
- **Speed:** loading is slow while the browser pane is hidden, because rendering is throttled.
