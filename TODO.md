# Swordflow — Outcome ToDo

## 1. Hand tracking: responsive, stable and easier to read — Worker and smoothing updates implemented; real-camera verification pending
- Browser experience must still request permission before opening a camera, show a live local preview, and provide guided positioning so the user can place their hand in frame.
- Palm position, orientation, approximate depth and finger/pose states must be detected in real time; landmark control should remain stable, responsive and low-latency rather than jittering, freezing or confusing poses.
- Camera angle, user distance, lighting and natural hand movement should be handled as robustly as the browser camera/model allows; calibration/filtering and pose confirmation should reduce false transitions.
- The user must retain camera/privacy status, any/left/right hand selection, sensitivity adjustment, pause/stop and a no-camera mouse alternative; the worker detects up to two hands and uses the selected hand for the mirrored overlay and control signal.
- The hand should be recognized correctly and steer the scene smoothly, closer to the user-provided video reference; do not claim a perfect match to the reference implementation or accuracy that has not been measured.

## 2. A fluid cinematic blade swarm — Worker separation, recognition updates and Preview performance refinement implemented; hardware verification pending
- 3D swords should respond fluidly to the user's tracked hand and retain inertia, spatial separation, collision avoidance and layered swarm movement.
- An open palm should gather/steer the swarm; a fist should compact it; thumb-index pinch should focus/charge it; a fast swipe or forward thrust should launch a volley.
- Recognizable gestures should still switch orbit, halo, spiral, shield and spearhead formations with smooth transitions.
- Rendering and hand inference should avoid blocking one another as much as practical; prefer stable frame pacing and a responsive camera preview over excessive blade count or resolution.
- A centered dragon recenter must rebase the current live hand/mouse control point so a stationary off-center pointer does not immediately pull the creature away. Dragon mode should not continue computing its hidden sword flock.

## 3. Dragon flight mode inspired by the supplied Drogon reference — Interactive procedural prototype implemented; exact photorealistic resemblance not yet delivered; paid asset generation not authorized
- Add a flying dragon character as an optional/interactive mode within the sword experience, using the user's attached image as visual guidance for a large dark, rugged, horned dragon with broad wings.
- The creature should have a readable coherent body, face, limbs, tail and wings and should animate like a living flying predator: sustained travel, repeated wing beats, tail/body follow-through, banking/turning, depth and breathing or other subtle motion.
- The dragon should react to the same tracked-hand/mouse controls where practical so the added mode feels controlled rather than like a static image.
- Match the broad traits of the supplied reference, but do not claim a frame-perfect or exact recreation of HBO/Game of Thrones Drogon from a single still.
- Any paid 3D generation, rigging or animation operation needs the user's explicit cost approval before it is started.

## 4. Existing cinematic controls, impact feedback and pause behavior — Existing and mode-aware controls retained
- Launched swords should interact with visible responsive targets.
- Sword launch/impact should have motion trails, sparks and shockwaves; swords can be recalled back toward the hand.
- Metallic blades, depth, lighting, shadows, particles and hand/camera-reactive composition should stay polished and cinematic.
- Performance settings/adaptive quality, FPS/tracking status, gesture guide, pause, reset, hand choice, sensitivity and camera/privacy controls should continue to work.
- A real pause should prevent swipe/mouse gameplay actions and queued fire from silently triggering on resume. Live recognition can remain active while paused.

## Verification boundary
- Production TypeScript/Vite build passes. The two-hand MediaPipe worker initialized and returned an empty detection for a generated blank frame without requesting a physical camera.
- Synthetic checks pass for learned open-palm/fist/V-sign classification, geometric pinch, up-to-two-hand preferred-side selection, rejection when the preferred side is absent, three-frame pose confirmation, adaptive depth and forward thrust. A mocked delayed-camera-start test checked cleanup after cancellation.
- In live Preview with camera off, moving the mouse to an off-center position, pressing Dragon Recenter and leaving the pointer fixed kept the dragon centered. While paused, a mouse fire attempt was rejected and showed “SIMULATION PAUSED · RESUME TO COMMAND”. Hidden sword-swarm physics is now skipped during Dragon mode.
- The SwiftShader Preview rendered the optimized sword mode at roughly 40–44 FPS and the procedural dragon mode at roughly 37–51 FPS in recent idle/mouse checks. These are Preview-environment measurements only, not hardware benchmarks.
- A real webcam/iPhone is unavailable here; true camera accuracy, lighting/angle variation and user-device smoothness remain unverified. The code-built dragon is a detailed stylized procedural prototype, not an exact or photorealistic Drogon asset; obtain approval before any paid 3D generation, rigging or animation.
