import { $, setupPage, shareViaSystem } from '../common';
import { formatBytes, utf8 } from '../lib/bytes';
import { FountainEncoder } from '../lib/fountain';
import { encodeFountainFrame, FOUNTAIN_HEADER, packBundle, type Bundle } from '../lib/packet';
import { drawLayers, makeQr, type Ecc } from '../lib/qr';

setupPage();
const canvas = $<HTMLCanvasElement>('#qr');
const info = $('#info');
const fileInput = $<HTMLInputElement>('#file');
const textInput = $<HTMLTextAreaElement>('#text');
const drop = $('#drop');
const startBtn = $<HTMLButtonElement>('#start');
const stopBtn = $<HTMLButtonElement>('#stop');

let file: File | null = null;
let timer = 0;

function setFile(f: File | null): void {
  file = f;
  drop.firstChild!.textContent = f ? `${f.name} (${formatBytes(f.size)}) ` : 'Drop a file here, or ';
  info.textContent = f ? 'Ready. Press Start.' : 'Nothing selected.';
}

fileInput.onchange = () => setFile(fileInput.files?.[0] ?? null);
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add('over');
};
drop.ondragleave = () => drop.classList.remove('over');
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  setFile(e.dataTransfer?.files[0] ?? null);
};

async function bundle(): Promise<Bundle | null> {
  if (file) return { name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) };
  if (textInput.value) return { name: '', type: 'text/plain', data: utf8(textInput.value) };
  return null;
}

function stop(): void {
  clearInterval(timer);
  timer = 0;
  startBtn.disabled = false;
  stopBtn.disabled = true;
}

startBtn.onclick = async () => {
  const b = await bundle();
  if (!b) {
    info.textContent = 'Pick a file or type some text first.';
    return;
  }
  stop();
  const payload = packBundle(b);
  const blockSize = Number($<HTMLSelectElement>('#block').value) - FOUNTAIN_HEADER;
  const fps = Number($<HTMLSelectElement>('#fps').value);
  const ecc = $<HTMLSelectElement>('#ecc').value as Ecc;
  const colour = $<HTMLInputElement>('#colour').checked;
  const transferId = (Math.random() * 2 ** 32) >>> 0;
  const enc = new FountainEncoder(payload, blockSize, transferId);
  const perFrame = colour ? 3 : 1;
  let seed = 0;
  let frames = 0;
  const t0 = performance.now();
  const rate = blockSize * fps * perFrame;
  startBtn.disabled = true;
  stopBtn.disabled = false;

  const frame = () => {
    const layers = [];
    for (let i = 0; i < perFrame; i++) {
      const data = enc.packet(seed);
      layers.push(makeQr(encodeFountainFrame({ transferId, length: payload.length, blockSize, seed, data }), ecc));
      seed++;
    }
    drawLayers(canvas, layers);
    frames++;
    const secs = (performance.now() - t0) / 1000;
    info.textContent =
      `${formatBytes(payload.length)} to send (${payload.length < b.data.length ? 'compressed' : 'not compressible'}) · ${enc.k} blocks · ` +
      `QR ${layers[0].size}×${layers[0].size} · frame ${frames} · ${secs.toFixed(0)} s · ` +
      `best case ${formatBytes(rate)}/s, about ${Math.ceil((enc.k * 1.1) / perFrame / fps)} s`;
  };
  frame();
  timer = window.setInterval(frame, 1000 / fps);
};
stopBtn.onclick = stop;

$('#share').onclick = async () => {
  $('#shareMsg').textContent = await shareViaSystem(file ? { files: [file] } : { text: textInput.value });
};
