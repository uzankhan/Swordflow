export interface VisionPoint {
  x: number;
  y: number;
  z: number;
}

export interface VisionCategory {
  categoryName: string;
  score: number;
}

export interface VisionResult {
  landmarks: VisionPoint[][];
  worldLandmarks: VisionPoint[][];
  handedness: VisionCategory[][];
  gestures: VisionCategory[][];
}

export type VisionWorkerInput =
  | { type: 'init' }
  | { type: 'frame'; bitmap: ImageBitmap; timestamp: number };

export type VisionWorkerOutput =
  | { type: 'ready'; delegate: 'CPU' }
  | { type: 'result'; timestamp: number; result: VisionResult }
  | { type: 'frame-error'; message: string }
  | { type: 'fatal'; message: string };
