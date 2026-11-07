import type { VisionPoint, VisionResult } from './vision-types';

export type Pose = 'open' | 'fist' | 'pinch' | 'peace' | 'flow' | 'lost';
export type Formation = 'orbit' | 'halo' | 'spiral' | 'shield' | 'spearhead';
export interface HandSignal {
  x: number;
  y: number;
  depth: number;
  roll: number;
  scale: number;
  pose: Pose;
  confidence: number;
  swipe: { x: number; y: number } | null;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const distance3 = (a: VisionPoint, b: VisionPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const palmWidth = (landmarks: VisionPoint[]) => Math.max(distance3(landmarks[5], landmarks[17]), 0.025);

function jointAngle(a: VisionPoint, joint: VisionPoint, c: VisionPoint) {
  const ax = a.x - joint.x, ay = a.y - joint.y, az = a.z - joint.z;
  const cx = c.x - joint.x, cy = c.y - joint.y, cz = c.z - joint.z;
  const aLength = Math.hypot(ax, ay, az), cLength = Math.hypot(cx, cy, cz);
  if (aLength < 1e-5 || cLength < 1e-5) return 0;
  return Math.acos(clamp((ax * cx + ay * cy + az * cz) / (aLength * cLength), -1, 1));
}

/** Adaptive low-pass filter: calm at rest, more responsive when the hand moves quickly. */
class OneEuro {
  private x = 0;
  private dx = 0;
  private last = 0;
  private ready = false;

  constructor(private minCutoff = 1.8, private beta = 0.09, private derivativeCutoff = 1) {}

  private alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value: number, now: number) {
    if (!this.ready) {
      this.x = value;
      this.last = now;
      this.ready = true;
      return value;
    }
    const dt = clamp((now - this.last) / 1000, 0.008, 0.12);
    this.last = now;
    const rawDx = (value - this.x) / dt;
    this.dx += this.alpha(this.derivativeCutoff, dt) * (rawDx - this.dx);
    this.x += this.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (value - this.x);
    return this.x;
  }

  reset() {
    this.ready = false;
    this.dx = 0;
  }
}

export class GestureInterpreter {
  private fx = new OneEuro(1.8, 0.09);
  private fy = new OneEuro(1.8, 0.09);
  private fz = new OneEuro(1.5, 0.08);
  private fr = new OneEuro(1.8, 0.05);
  private fs = new OneEuro(1.5, 0.06);
  private previous: { x: number; y: number; depth: number; t: number } | null = null;
  private previousPose: Pose = 'lost';
  private candidatePose: Pose = 'lost';
  private candidateFrames = 0;
  private lastSwipe = 0;
  private sensitivity = 0.68;
  private referencePalmScale = 0.17;
  private calibrationSamples = 0;
  private selectedIndex = -1;

  getSelectedIndex() {
    return this.selectedIndex;
  }

  setSensitivity(value: number) {
    this.sensitivity = clamp(value, 0.3, 1);
  }

  private resetPose() {
    this.selectedIndex = -1;
    this.previous = null;
    this.previousPose = 'lost';
    this.candidatePose = 'lost';
    this.candidateFrames = 0;
    this.lastSwipe = 0;
  }

  reset() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
    this.fr.reset();
    this.fs.reset();
    this.resetPose();
    this.referencePalmScale = 0.17;
    this.calibrationSamples = 0;
  }

  resetAfterTrackingLoss() {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
    this.fr.reset();
    this.fs.reset();
    this.resetPose();
  }

  interpret(result: VisionResult, now: number, wantedHand: 'any' | 'left' | 'right' = 'any'): HandSignal | null {
    const selected = result.landmarks.findIndex((candidate, index) => {
      if (!candidate || candidate.length < 21) return false;
      if (wantedHand === 'any') return true;
      return result.handedness[index]?.[0]?.categoryName.toLowerCase() === wantedHand;
    });
    if (selected < 0) {
      this.resetPose();
      return null;
    }

    this.selectedIndex = selected;
    const landmarks = result.landmarks[selected];
    const handConfidence = result.handedness[selected]?.[0]?.score ?? 0.8;
    const center = [0, 5, 9, 13, 17].reduce((sum, index) => ({
      x: sum.x + landmarks[index].x / 5,
      y: sum.y + landmarks[index].y / 5,
    }), { x: 0, y: 0 });
    // The preview is mirrored for the user; raw camera landmarks are not.
    const x = this.fx.filter(1 - center.x, now);
    const y = this.fy.filter(center.y, now);
    const scaleRaw = Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y);
    const scale = this.fs.filter(scaleRaw, now);
    const scaleShift = Math.abs(scaleRaw - this.referencePalmScale) / Math.max(this.referencePalmScale, 0.08);
    const calibrationRate = this.calibrationSamples < 24 ? 1 / (this.calibrationSamples + 1) : scaleShift > 0.32 ? 0.025 : 0.0015;
    this.referencePalmScale += (scaleRaw - this.referencePalmScale) * calibrationRate;
    this.calibrationSamples++;
    const normalizedPalmScale = scaleRaw / Math.max(this.referencePalmScale, 0.08);
    const depth = this.fz.filter(clamp((normalizedPalmScale - 0.68) * 1.9, 0, 1), now);
    const roll = this.fr.filter(Math.atan2(landmarks[17].y - landmarks[5].y, landmarks[17].x - landmarks[5].x), now);

    const worldLandmarks = result.worldLandmarks[selected];
    const spatial = worldLandmarks?.length >= 21 ? worldLandmarks : landmarks;
    const fingerBase = [5, 9, 13, 17];
    const fingerExtension = fingerBase.map(base => jointAngle(spatial[base], spatial[base + 1], spatial[base + 3]) > 2.48);
    const extensionCount = fingerExtension.filter(Boolean).length;
    const width = palmWidth(spatial);
    const pinchRatio = distance3(spatial[4], spatial[8]) / width;
    const indexStraight = jointAngle(spatial[5], spatial[6], spatial[8]) > 2.2;

    const topGesture = result.gestures[selected]?.[0];
    const learnedPose: Pose | null = topGesture && topGesture.score >= 0.62
      ? topGesture.categoryName === 'Open_Palm' ? 'open'
        : topGesture.categoryName === 'Closed_Fist' ? 'fist'
          : topGesture.categoryName === 'Victory' ? 'peace'
            : null
      : null;
    const learnedConfidence = learnedPose ? topGesture?.score ?? 0 : 0;

    let detectedPose: Pose;
    if (pinchRatio < 0.28 && indexStraight && learnedPose !== 'fist') detectedPose = 'pinch';
    else if (learnedPose) detectedPose = learnedPose;
    else if (fingerExtension[0] && fingerExtension[1] && !fingerExtension[2] && !fingerExtension[3]) detectedPose = 'peace';
    else if (extensionCount >= 4) detectedPose = 'open';
    else if (extensionCount <= 1) detectedPose = 'fist';
    else detectedPose = 'flow';

    let pose = detectedPose;
    if (detectedPose !== this.previousPose) {
      if (detectedPose === this.candidatePose) this.candidateFrames++;
      else {
        this.candidatePose = detectedPose;
        this.candidateFrames = 1;
      }
      if (this.candidateFrames >= 3) {
        this.previousPose = detectedPose;
        this.candidateFrames = 0;
      } else {
        pose = this.previousPose === 'lost' ? 'flow' : this.previousPose;
      }
    } else {
      this.candidatePose = detectedPose;
      this.candidateFrames = 0;
    }

    let swipe: HandSignal['swipe'] = null;
    if (this.previous) {
      const dt = Math.max(0.012, (now - this.previous.t) / 1000);
      const vx = (x - this.previous.x) / dt * this.sensitivity;
      const vy = (y - this.previous.y) / dt * this.sensitivity;
      const speed = Math.hypot(vx, vy);
      const forwardThrust = (depth - this.previous.depth) / dt * this.sensitivity;
      if ((speed > 1.35 || forwardThrust > 1.05) && now - this.lastSwipe > 720 && (pose === 'open' || pose === 'peace' || pose === 'fist')) {
        swipe = speed > 1.35 ? { x: clamp(vx / speed, -1, 1), y: clamp(-vy / speed, -1, 1) } : { x: 0, y: 0 };
        this.lastSwipe = now;
      }
    }

    this.previous = { x, y, depth, t: now };
    return { x, y, depth, roll, scale, pose, confidence: learnedConfidence || handConfidence, swipe };
  }
}
