# Hero Hand Window 🕸️⚡

An interactive webcam AR experience powered by **MediaPipe Tasks Vision** (Face Landmarker + Hand Landmarker running concurrently in real-time) and **WebGL2**.

Stretch an interactive superhero window between your hands. Inside it, your webcam video transforms into a stylized superhero or anime character that tracks your facial expressions, gaze, and gestures.

## Features & Modes

- **Spider-Man (Hero)**: Realistic 3D embossed web mask with movie-accurate radial and scalloped spiderweb architecture, specular lighting, micro-fabric weave texture, and aggressive animated Spider-Man eye lenses that realistically squint, narrow, and blink in sync with your real eyes.
- **Naruto (Sage Mode)**: Mount Myoboku Sage Mode with golden-amber toad eyes and horizontal slit pupils tracking your real iris, signature orange eyeshadow pigment, 6 dynamic cheek whiskers, and the metal Konoha (Hidden Leaf) forehead protector (*Hitai-ate*).
- **Uchiha (Sharingan)**: Crimson Sharingan eyes featuring tracking tomoe and iris rings, dynamic eye curvature mapping, and rogue headband.
- **Spider-Noir**: Monochromatic comic noir rendering with dark trenchcoat silhouette and comic halftoning.

## Gesture Controls

- **Pinch both hands** (thumb to index finger): Spawns the superhero window between your fingertips.
- **Spread hands apart**: Expands and widens the superhero portal until it takes over the screen.
- **Cover camera lens briefly**: Transitions to the next superhero look.
- **Pinch again / drop hands**: Shrinks and closes the window back to normal camera.

## Keyboard Hotkeys

- `1`: Spider-Man mode
- `2`: Naruto Sage mode
- `3`: Uchiha Sharingan mode
- `4`: Spider-Noir mode
- `Space`: Cycle through looks
- `T`: Toggle Full Frame takeover
- `R`: Start / Stop video recording (auto-downloads MP4/WebM)

## Running Locally

Serve the directory with any local static HTTP server (required for camera access and WebAssembly models):

```powershell
python -m http.server 5173 --bind 127.0.0.1
```

Open `http://localhost:5173/` in Chrome or Edge and allow webcam access.
To test immediately without a camera, open `http://localhost:5173/?demo=1`.
