# Research notes — Swordflow

## Reference observation
- User-supplied reference: https://www.instagram.com/reels/DfI4GnnCdfn/
- The public reel caption frames the concept as controlling ten thousand flying swords with bare hands. The visible clip shows a real foreground hand gesturing toward a display where a rotating, clustered sword-like swarm reacts; the screen-in-screen demo and dramatic swarm silhouette are the key visual cues.
- Instagram exposed video metadata of 720×1280, 28.17 seconds. It was possible to observe playback, but not to verify the creator's private source code, exact model, or original implementation details. Swordflow is therefore a faithful functional interpretation, not a claim to reproduce hidden source code.

## Technical findings and decisions
- MediaPipe Hand Landmarker returns handedness plus 21 normalized hand landmarks and world landmarks. In video mode, `detectForVideo()` accepts decoded frames and timestamps. Tracking uses landmark continuity and falls back to palm detection when confidence drops. Its synchronous call blocks the main thread, so inference frequency and rendering must be decoupled/throttled or isolated for smooth motion.
- Use 21-point hand landmarks to derive palm center, orientation, finger extension/pinch/fist state; apply confidence-aware smoothing and gesture hysteresis to prevent noisy transitions. The rendering loop should continue at display refresh while inference runs at a lower controlled cadence.
- Use Three.js instancing for many visually similar blades to reduce draw calls, with a bounded blade count and quality tiers rather than literal 10,000 full 3D meshes.
- Camera capture requires browser user permission and a secure context; request access only after the user presses Start, provide explicit stop controls, and keep frames local to the browser.

## Sources
- Google AI Edge, Hand Landmarker for Web: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- Zhang et al., *MediaPipe Hands: On-device Real-time Hand Tracking*: https://arxiv.org/abs/2006.10214
- Three.js, InstancedMesh: https://threejs.org/docs/pages/InstancedMesh.html
- MDN, `MediaDevices.getUserMedia()`: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia


## Source confirmations
- The official Three.js `InstancedMesh` reference explicitly describes the object as a way to reduce draw calls when rendering many objects that share geometry and material. Swordflow will use this for blade populations and cap visual counts by quality tier: https://threejs.org/docs/pages/InstancedMesh.html
- MDN documents `getUserMedia()` as secure-context-only and permission-gated; denial and missing hardware produce distinct errors. Camera stream tracks can be stopped explicitly when the user stops tracking: https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia
- Current MediaPipe Tasks handedness is subject-relative on unmirrored input; mirroring an input frame swaps the label. This rule changed in v0.10.5 and is clarified by the Google AI Edge maintainer issue #6376. Swordflow passes the raw camera frame to inference and mirrors only the visible preview, so it compares the preferred hand directly: https://github.com/google-ai-edge/mediapipe/issues/6376
- Google's Web Hand Landmarker guide explicitly warns that `detectForVideo()` is synchronous and blocks the interface thread; its documented remedy is running detection in a Web Worker. Swordflow now transfers at most one `ImageBitmap` at a time to a worker and leaves Three.js rendering on the main thread: https://developers.google.com/edge/mediapipe/solutions/vision/hand_landmarker/web_js
- Google's Gesture Recognizer bundles hand landmark tracking with a learned pose classifier. Its canned categories include `Open_Palm`, `Closed_Fist` and `Victory`, with a score threshold and result callbacks. Pinch remains a separate geometry test because it is not one of the supplied canned categories: https://developers.google.com/edge/mediapipe/solutions/vision/gesture_recognizer
- MDN documents `OffscreenCanvas` and browser worker APIs for moving expensive graphics work away from the main thread. This project transfers camera frames as ImageBitmap instead of moving the entire Three.js canvas: https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas

## Follow-up: current gesture worker implementation
- Google closed the ES-module-worker `ModuleFactory not set` issue on Apr. 27, 2026 and pointed to its current sample. The current sample calls `FilesetResolver.forVisionTasks(wasmPath, true)` in an ES-module worker, which explicitly selects module-mode WASM. Swordflow uses this exact supported mode; a browser smoke test confirmed the worker initializes with CPU delegate and completes a generated blank-frame call. Real-camera recognition remains untested here: https://github.com/google-ai-edge/mediapipe/issues/5257
- A related maintainer issue points to the same working current sample for worker setup: https://github.com/google-ai-edge/mediapipe/issues/5527
- Google's current sample worker and base-worker setup: https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/gesture-recognizer.worker.ts ; https://github.com/google-ai-edge/mediapipe-samples-web/blob/main/src/workers/base-worker.ts . The Webdev implementation uses a smaller local worker contract rather than copying the sample wholesale.
- Official MediaPipe Tasks Vision package declares `forVisionTasks(basePath, useModule?)`; its current package includes module WASM assets. The bundled blank-frame browser test confirms the chosen local/CDN combination initializes.
- The official Vision package README says input data (e.g. video frames) is processed on-device and not sent to Google, while API performance/utilization metrics may still be sent. UI copy therefore promises only that camera video is not stored/uploaded, not that the library emits no telemetry: https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md
- The cloud Preview's renderer fingerprint was SwiftShader, not a physical GPU. Detecting that renderer and reducing pixel ratio/blade count improved the same Preview from about 7–8 FPS to about 42–44 FPS in sword mode; the live procedural dragon mode measured about 48–59 FPS during idle/mouse tests. These are environment-specific rendering observations, not real-device benchmarks.
