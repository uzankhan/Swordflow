import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';
import type { GestureRecognizerResult } from '@mediapipe/tasks-vision';
import type { VisionCategory, VisionPoint, VisionResult, VisionWorkerInput, VisionWorkerOutput } from './vision-types';

const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

let recognizer: GestureRecognizer | null = null;
let lastTimestamp = -1;

function copyPoints(hands: Array<Array<{ x: number; y: number; z: number }>> | undefined): VisionPoint[][] {
  return (hands ?? []).map(hand => hand.map(({ x, y, z }) => ({ x, y, z })));
}

function copyCategories(hands: Array<Array<{ categoryName: string; score: number }>> | undefined): VisionCategory[][] {
  return (hands ?? []).map(hand => hand.map(({ categoryName, score }) => ({ categoryName, score })));
}

function serialize(result: GestureRecognizerResult): VisionResult {
  return {
    landmarks: copyPoints(result.landmarks),
    worldLandmarks: copyPoints(result.worldLandmarks),
    handedness: copyCategories(result.handedness),
    gestures: copyCategories(result.gestures),
  };
}

function send(message: VisionWorkerOutput) {
  self.postMessage(message);
}

async function initialize() {
  if (recognizer) {
    send({ type: 'ready', delegate: 'CPU' });
    return;
  }
  try {
    // Module WASM loading is required in an ES-module Worker; the legacy loader
    // path uses importScripts and fails here with "ModuleFactory not set".
    const files = await FilesetResolver.forVisionTasks(WASM_ROOT, true);
    recognizer = await GestureRecognizer.createFromOptions(files, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.58,
      minHandPresenceConfidence: 0.55,
      minTrackingConfidence: 0.55,
      cannedGesturesClassifierOptions: { scoreThreshold: 0.48, maxResults: 3 },
    });
    lastTimestamp = -1;
    send({ type: 'ready', delegate: 'CPU' });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not load the local gesture model.';
    send({ type: 'fatal', message });
  }
}

function detect(bitmap: ImageBitmap, timestamp: number) {
  try {
    if (!recognizer) throw new Error('Gesture model is not ready.');
    const monotonicTimestamp = Math.max(timestamp, lastTimestamp + 1);
    lastTimestamp = monotonicTimestamp;
    const detected = recognizer.recognizeForVideo(bitmap, monotonicTimestamp);
    send({ type: 'result', timestamp: monotonicTimestamp, result: serialize(detected) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'A camera frame could not be analyzed.';
    send({ type: 'frame-error', message });
  } finally {
    bitmap.close();
  }
}

self.addEventListener('message', event => {
  const message = (event as MessageEvent<VisionWorkerInput>).data;
  if (message.type === 'init') void initialize();
  else if (message.type === 'frame') detect(message.bitmap, message.timestamp);
});
