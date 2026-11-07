# Swordflow

A browser-based motion-control experience with two live modes: a sword swarm and an original procedural dark-winged dragon. Camera frames are processed locally by a MediaPipe Vision web worker on this device; the project does not upload or store the camera video. MediaPipe may send technical usage/performance metrics, but not the video frame.

## Run locally

- Install with `pnpm install` and start the project with `pnpm dev`.
- Open the HTTPS Preview (or `http://localhost:3000`). Choose **Enter the field** to request camera permission. Choose **Try mouse control** if a camera is unavailable.
- `pnpm run build` runs the TypeScript check and Vite production build.

## Modes and controls

Use **SWARM / DRAGON FLIGHT** in the bottom control dock (press `D` to toggle). The hand model processes up to two visible hands and honours any/left/right selection. In Sword Swarm, an open palm gathers and steers, a fist compacts, thumb-index pinch charges, a fast swipe or forward thrust launches a volley, and a V sign cycles formations. Sword volleys report a gate hit or miss once resolved and home toward the hand; **Recall** (or `R`) calls them back early.

In Dragon Flight, move an open hand or the mouse to steer the creature, close a fist to pitch into a dive, and swipe or click to breathe a short forge flame. **Recenter** (or `R`) rebases steering at the current hand/mouse position so the dragon stays centered while your control point remains still. While paused, tracking can continue but gameplay actions are ignored and fire is not queued for resume.

You can cancel while camera permission or the local vision model is loading. Camera video is not recorded or uploaded, and active media tracks stop when tracking is disconnected or a pending start is cancelled. The hand worker and two-hand selection have passed generated-frame and synthetic-pose checks, but an attached physical webcam/iPhone is still needed to verify real-world accuracy, lighting and device performance. The dragon is an original code-built procedural character guided by the supplied silhouette, not a photorealistic or exact Drogon model.

See [`docs/research-notes.md`](docs/research-notes.md) for what was observed from the reel, primary technical references and test limitations.
