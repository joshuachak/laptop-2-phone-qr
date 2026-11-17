import { $, setupPage, shareViaSystem } from '../common';
import { utf8 } from '../lib/bytes';
import { encodeCompactText } from '../lib/packet';
import { drawQr, makeQr, type Ecc } from '../lib/qr';

setupPage();
const text = $<HTMLTextAreaElement>('#text');
const mode = $<HTMLSelectElement>('#mode');
const ecc = $<HTMLSelectElement>('#ecc');
const canvas = $<HTMLCanvasElement>('#qr');
const info = $('#info');

// Above this many bytes a code gets dense enough that phones struggle to read it off a screen.
const COMFORT = 1000;

function render(): void {
  const value = text.value || 'Hello from my laptop 👋';
  const plain = utf8(value);
  const compact = encodeCompactText(value);
  let useCompact = mode.value === 'compact';
  if (mode.value === 'auto') useCompact = plain.length > 300 && compact.length < plain.length * 0.85;
  const bytes = useCompact ? compact : plain;
  try {
    const m = makeQr(bytes, ecc.value as Ecc);
    drawQr(canvas, m);
    const version = (m.size - 17) / 4;
    info.innerHTML =
      `${useCompact ? 'Compact' : 'Plain'} · ${bytes.length} bytes (text is ${plain.length}, compressed ${compact.length}) · QR version ${version}, ${m.size}×${m.size}` +
      (bytes.length > COMFORT ? ` · <span class="warn">dense: if it won’t scan, use the animated page</span>` : '');
  } catch {
    info.innerHTML = `<span class="warn">Too long for one QR code (${bytes.length} bytes). Use the animated page.</span>`;
    canvas.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  }
}

text.addEventListener('input', render);
mode.addEventListener('change', render);
ecc.addEventListener('change', render);
window.addEventListener('resize', render);
$('#paste').onclick = async () => {
  text.value = await navigator.clipboard.readText();
  render();
};
$('#share').onclick = async () => {
  $('#shareMsg').textContent = await shareViaSystem({ text: text.value });
};
requestAnimationFrame(render);
