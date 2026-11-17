import type { DecodeRequest, DecodeResponse } from './decoder.worker';

export interface ScannerOptions {
  video: HTMLVideoElement;
  /** Longest side of the frame sent to the decoder, in pixels. */
  maxSide: number;
  colour: boolean;
  onCodes: (codes: Uint8Array[]) => void;
}

export async function listCameras(): Promise<MediaDeviceInfo[]> {
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

export async function openCamera(deviceId?: string): Promise<MediaStream> {
  const video: MediaTrackConstraints = deviceId
    ? { deviceId: { exact: deviceId } }
    : { facingMode: { ideal: 'environment' } };
  video.width = { ideal: 1920 };
  video.height = { ideal: 1080 };
  video.frameRate = { ideal: 30 };
  const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  const track = stream.getVideoTracks()[0];
  // Continuous autofocus helps a lot with screens; ignore if unsupported.
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
  } catch {
    /* not supported */
  }
  return stream;
}

/** Grabs camera frames and decodes QR codes in a worker, always on the newest frame. */
export class Scanner {
  private worker = new Worker(new URL('./decoder.worker.ts', import.meta.url), { type: 'module' });
  private canvas = document.createElement('canvas');
  private ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  private busy = false;
  private running = false;
  private nextId = 0;
  private frames = 0;
  private hits = 0;
  private t0 = performance.now();
  lastDecodeMs = 0;

  constructor(private opts: ScannerOptions) {
    this.worker.onmessage = (e: MessageEvent<DecodeResponse>) => {
      this.busy = false;
      this.frames++;
      this.lastDecodeMs = e.data.ms;
      if (e.data.codes.length) {
        this.hits++;
        this.opts.onCodes(e.data.codes);
      }
    };
  }

  set colour(v: boolean) {
    this.opts.colour = v;
  }
  set maxSide(v: number) {
    this.opts.maxSide = v;
  }

  /** Decoded frames per second and the share of frames that held a code. */
  stats(): { fps: number; hitRate: number } {
    const s = (performance.now() - this.t0) / 1000;
    const r = { fps: this.frames / s, hitRate: this.frames ? this.hits / this.frames : 0 };
    this.frames = 0;
    this.hits = 0;
    this.t0 = performance.now();
    return r;
  }

  start(): void {
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.grab();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
  }

  private grab(): void {
    const v = this.opts.video;
    if (this.busy || v.readyState < 2 || !v.videoWidth) return;
    const scale = Math.min(1, this.opts.maxSide / Math.max(v.videoWidth, v.videoHeight));
    const w = Math.round(v.videoWidth * scale);
    const h = Math.round(v.videoHeight * scale);
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.ctx.drawImage(v, 0, 0, w, h);
    const img = this.ctx.getImageData(0, 0, w, h);
    this.busy = true;
    const req: DecodeRequest = { id: this.nextId++, width: w, height: h, pixels: img.data.buffer, colour: this.opts.colour };
    this.worker.postMessage(req, [img.data.buffer]);
  }
}
