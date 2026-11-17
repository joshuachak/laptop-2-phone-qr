import { $, renderReceived, setupPage } from '../common';
import { formatBytes, fromUtf8 } from '../lib/bytes';
import { listCameras, openCamera, Scanner } from '../lib/camera';
import { FountainDecoder } from '../lib/fountain';
import { classify, unpackBundle } from '../lib/packet';

setupPage();
const video = $<HTMLVideoElement>('#video');
const list = $('#list');
const statsEl = $('#stats');
const progress = $<HTMLProgressElement>('#progress');
const xfer = $('#xfer');
const cams = $<HTMLSelectElement>('#cams');
const res = $<HTMLSelectElement>('#res');
const colour = $<HTMLInputElement>('#colour');
const startBtn = $<HTMLButtonElement>('#start');
const stopBtn = $<HTMLButtonElement>('#stop');

let stream: MediaStream | null = null;
let statsTimer = 0;
const seenText = new Set<string>();
const finished = new Set<number>();
let current: { dec: FountainDecoder; id: number; t0: number } | null = null;

const scanner = new Scanner({
  video,
  maxSide: Number(res.value),
  colour: colour.checked,
  onCodes: (codes) => codes.forEach(handle),
});
res.onchange = () => (scanner.maxSide = Number(res.value));
colour.onchange = () => (scanner.colour = colour.checked);

function clearEmpty(): void {
  list.querySelector('p.muted')?.remove();
}

function handle(bytes: Uint8Array): void {
  let s;
  try {
    s = classify(bytes);
  } catch {
    return; // half-read or corrupt code
  }
  if (s.kind === 'text') {
    if (seenText.has(s.text)) return;
    seenText.add(s.text);
    clearEmpty();
    renderReceived(list, { name: '', type: 'text/plain', text: s.text }, s.compact ? 'compact QR' : 'plain QR');
    navigator.vibrate?.(60);
    return;
  }
  if (s.kind === 'signal') {
    statsEl.textContent = 'That is a P2P reply code. Scan it from the Direct P2P page on the Mac.';
    return;
  }
  const f = s.frame;
  if (finished.has(f.transferId)) return;
  if (!current || current.id !== f.transferId) {
    current = { dec: new FountainDecoder(f.length, f.blockSize, f.transferId), id: f.transferId, t0: performance.now() };
    $('#progressBox').hidden = false;
  }
  const { dec, t0 } = current;
  dec.add(f.seed, f.data);
  progress.value = dec.progress;
  const secs = (performance.now() - t0) / 1000;
  const got = Math.round(dec.progress * f.length);
  xfer.textContent = `${formatBytes(got)} of ${formatBytes(f.length)} · ${dec.received} codes read (${dec.k} blocks) · ${secs.toFixed(1)} s · ${formatBytes(got / Math.max(secs, 0.1))}/s`;
  if (dec.done) {
    finished.add(f.transferId);
    const b = unpackBundle(dec.result());
    const note = `${formatBytes(f.length)} in ${secs.toFixed(1)} s, ${formatBytes(f.length / Math.max(secs, 0.1))}/s, ${dec.received} codes for ${dec.k} blocks`;
    clearEmpty();
    if (b.type === 'text/plain' && !b.name) renderReceived(list, { name: '', type: b.type, text: fromUtf8(b.data) }, note);
    else renderReceived(list, b, note);
    xfer.textContent = `Done: ${note}`;
    current = null;
    navigator.vibrate?.([60, 60, 60]);
  }
}

async function start(): Promise<void> {
  try {
    stream = await openCamera(cams.value || undefined);
  } catch (e) {
    statsEl.innerHTML = `<span class="warn">Camera unavailable: ${(e as Error).message}</span>`;
    return;
  }
  video.srcObject = stream;
  await video.play();
  if (cams.options.length === 1) {
    for (const c of await listCameras()) cams.add(new Option(c.label || c.deviceId.slice(0, 8), c.deviceId));
  }
  scanner.start();
  startBtn.disabled = true;
  stopBtn.disabled = false;
  statsTimer = window.setInterval(() => {
    const st = scanner.stats();
    const t = stream?.getVideoTracks()[0].getSettings();
    statsEl.textContent = `Camera ${t?.width}×${t?.height} · decoding ${st.fps.toFixed(1)} frames/s · ${Math.round(st.hitRate * 100)}% had a code · ${scanner.lastDecodeMs.toFixed(0)} ms per frame`;
  }, 1000);
}

function stop(): void {
  scanner.stop();
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  clearInterval(statsTimer);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  statsEl.textContent = 'Camera off.';
}

startBtn.onclick = start;
stopBtn.onclick = stop;
cams.onchange = () => {
  if (stream) {
    stop();
    void start();
  }
};
