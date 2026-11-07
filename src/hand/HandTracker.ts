import { GestureInterpreter, type HandSignal } from './gesture';
import type { VisionResult, VisionWorkerInput, VisionWorkerOutput } from './vision-types';

const BONES: Array<[number, number]> = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],[12,13],[13,14],[14,15],[15,16],[16,17],[17,18],[18,19],[19,20],[0,17],[5,9],[9,13],[13,17]];

type Status = 'idle' | 'requesting' | 'loading' | 'ready' | 'lost' | 'error';
export interface TrackerOptions {
  video: HTMLVideoElement;
  overlay: HTMLCanvasElement;
  onSignal: (signal: HandSignal | null) => void;
  onStatus: (status: Status, message?: string) => void;
  onConfidence: (value: number) => void;
  getPreferredHand: () => 'any' | 'left' | 'right';
  getSensitivity: () => number;
}

interface ReadyWaiter {
  worker: Worker;
  resolve: (ready: boolean) => void;
  reject: (error: Error) => void;
  timeout: number;
}

export class HandTracker {
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private raf = 0;
  private generation = 0;
  private starting: Promise<boolean> | null = null;
  private readyWaiter: ReadyWaiter | null = null;
  private lastInference = 0;
  private lastSeen = 0;
  private active = false;
  private inferenceInFlight = false;
  private lostSent = false;
  private interpreter = new GestureInterpreter();

  constructor(private options: TrackerOptions) {}

  async start(): Promise<boolean> {
    if (this.active) return true;
    if (this.starting) return this.starting;

    const generation = ++this.generation;
    this.options.onStatus('requesting', 'Waiting for camera permission');
    const attempt = this.startSession(generation);
    this.starting = attempt;
    try {
      return await attempt;
    } finally {
      if (this.starting === attempt) this.starting = null;
    }
  }

  private async startSession(generation: number): Promise<boolean> {
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs a secure HTTPS page in a supported browser.');
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640, max: 1280 },
          height: { ideal: 480, max: 960 },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      if (generation !== this.generation) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      this.stream = stream;
      this.options.video.srcObject = stream;
      await this.options.video.play();
      if (generation !== this.generation) {
        this.releaseMedia();
        return false;
      }

      if (typeof createImageBitmap !== 'function') throw new Error('This browser cannot transfer camera frames to the hand-tracking worker. Try the latest Safari, Chrome or Edge.');
      this.options.onStatus('loading', 'Loading the gesture model off the display thread');
      const worker = new Worker(new URL('./inference.worker.ts', import.meta.url), { type: 'module', name: 'swordflow-hand-vision' });
      this.worker = worker;
      const initialized = await this.initializeWorker(worker);
      if (!initialized || generation !== this.generation) {
        this.releaseMedia();
        return false;
      }

      this.active = true;
      this.inferenceInFlight = false;
      this.lastInference = 0;
      this.lastSeen = performance.now();
      this.lostSent = false;
      this.interpreter.reset();
      this.options.onStatus('ready', 'Hand model running in an isolated local worker');
      this.loop();
      return true;
    } catch (error) {
      if (generation !== this.generation) {
        this.releaseMedia();
        return false;
      }
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Camera permission was denied. Allow camera access in browser settings, or use mouse control.'
        : error instanceof DOMException && error.name === 'NotFoundError'
          ? 'No camera was found. You can still try mouse control.'
          : error instanceof Error ? error.message : 'Could not start hand tracking.';
      this.options.onStatus('error', message);
      this.stop(false);
      throw error;
    }
  }

  private initializeWorker(worker: Worker): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        if (this.readyWaiter?.worker !== worker) return;
        this.readyWaiter = null;
        reject(new Error('The on-device hand model took too long to load. Check your connection and try again.'));
      }, 45000);
      this.readyWaiter = { worker, resolve, reject, timeout };
      worker.addEventListener('message', this.handleWorkerMessage);
      worker.addEventListener('error', this.handleWorkerError);
      worker.postMessage({ type: 'init' } satisfies VisionWorkerInput);
    });
  }

  private handleWorkerMessage = (event: MessageEvent<VisionWorkerOutput>) => {
    const worker = event.currentTarget as Worker;
    if (worker !== this.worker) return;
    const message = event.data;
    if (message.type === 'ready') {
      if (this.readyWaiter?.worker === worker) {
        window.clearTimeout(this.readyWaiter.timeout);
        this.readyWaiter.resolve(true);
        this.readyWaiter = null;
      }
      return;
    }
    if (message.type === 'fatal') {
      const waiter = this.readyWaiter;
      if (waiter?.worker === worker) {
        window.clearTimeout(waiter.timeout);
        this.readyWaiter = null;
        waiter.reject(new Error(message.message));
      } else {
        this.options.onStatus('error', message.message);
        this.stop(false);
      }
      return;
    }
    if (message.type === 'frame-error') {
      this.inferenceInFlight = false;
      console.warn('Hand frame skipped in worker:', message.message);
      return;
    }
    this.inferenceInFlight = false;
    this.processResult(message.result, message.timestamp);
  };

  private handleWorkerError = (event: ErrorEvent) => {
    const worker = event.currentTarget as Worker;
    if (worker !== this.worker) return;
    event.preventDefault();
    const error = new Error(event.message || 'The hand-tracking worker stopped unexpectedly.');
    if (this.readyWaiter?.worker === worker) {
      const waiter = this.readyWaiter;
      window.clearTimeout(waiter.timeout);
      this.readyWaiter = null;
      waiter.reject(error);
    } else {
      this.options.onStatus('error', error.message);
      this.stop(false);
    }
  };

  private loop = () => {
    if (!this.active || !this.worker) return;
    const now = performance.now();
    const video = this.options.video;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !this.inferenceInFlight && now - this.lastInference >= 45) {
      this.lastInference = now;
      this.inferenceInFlight = true;
      const timestamp = now;
      void createImageBitmap(video).then(bitmap => {
        const worker = this.worker;
        if (!this.active || !worker) {
          bitmap.close();
          this.inferenceInFlight = false;
          return;
        }
        const message: VisionWorkerInput = { type: 'frame', bitmap, timestamp };
        worker.postMessage(message, [bitmap]);
      }).catch(error => {
        this.inferenceInFlight = false;
        if (this.active) console.warn('Could not copy a camera frame for hand tracking:', error);
      });
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  private processResult(result: VisionResult, timestamp: number) {
    if (!this.active) return;
    const signal = this.interpreter.interpret(result, timestamp, this.options.getPreferredHand());
    const now = performance.now();
    if (signal) {
      this.lastSeen = now;
      this.lostSent = false;
      this.options.onSignal(signal);
      this.options.onConfidence(signal.confidence);
      this.options.onStatus('ready');
      this.draw(result);
      return;
    }

    if (!this.lostSent && now - this.lastSeen > 170) {
      this.interpreter.resetAfterTrackingLoss();
      this.lostSent = true;
      this.options.onSignal(null);
      this.options.onConfidence(0);
      this.clearOverlay();
    }
    if (now - this.lastSeen > 520) this.options.onStatus('lost', 'Move your hand into the frame');
  }

  private draw(result: VisionResult) {
    const canvas = this.options.overlay;
    const box = canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 1.25);
    const w = Math.max(1, Math.round(box.width * ratio));
    const h = Math.max(1, Math.round(box.height * ratio));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d', { alpha: true });
    const landmarks = result.landmarks[this.interpreter.getSelectedIndex()];
    if (!ctx || !landmarks) return;
    ctx.clearRect(0, 0, w, h);
    ctx.lineWidth = Math.max(1.1, w / 260);
    ctx.strokeStyle = 'rgba(221,174,115,.8)';
    ctx.beginPath();
    for (const [a, b] of BONES) {
      ctx.moveTo(landmarks[a].x * w, landmarks[a].y * h);
      ctx.lineTo(landmarks[b].x * w, landmarks[b].y * h);
    }
    ctx.stroke();
    for (let i = 0; i < landmarks.length; i++) {
      const point = landmarks[i];
      ctx.beginPath();
      ctx.arc(point.x * w, point.y * h, i === 0 || i === 5 || i === 9 || i === 13 || i === 17 ? Math.max(2.4, w / 130) : Math.max(1.5, w / 200), 0, Math.PI * 2);
      ctx.fillStyle = i === 4 || i === 8 ? '#ffe1a4' : '#f7eee3';
      ctx.fill();
    }
  }

  private clearOverlay() {
    const context = this.options.overlay.getContext('2d');
    if (context) context.clearRect(0, 0, this.options.overlay.width, this.options.overlay.height);
  }

  private releaseMedia() {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.options.video.pause();
    this.options.video.srcObject = null;
    this.clearOverlay();
  }

  stop(announce = true) {
    this.generation++;
    this.starting = null;
    this.active = false;
    this.inferenceInFlight = false;
    cancelAnimationFrame(this.raf);
    const waiter = this.readyWaiter;
    this.readyWaiter = null;
    if (waiter) {
      window.clearTimeout(waiter.timeout);
      waiter.resolve(false);
    }
    const worker = this.worker;
    this.worker = null;
    if (worker) {
      worker.removeEventListener('message', this.handleWorkerMessage);
      worker.removeEventListener('error', this.handleWorkerError);
      worker.terminate();
    }
    this.releaseMedia();
    this.interpreter.reset();
    this.options.onSignal(null);
    this.options.onConfidence(0);
    if (announce) this.options.onStatus('idle', 'Camera off');
  }

  setSensitivity(value: number) {
    this.interpreter.setSensitivity(value);
  }
}
