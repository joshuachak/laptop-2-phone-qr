import { $, renderReceived, setupPage } from '../common';
import { formatBytes, fromBase64Url, toBase64Url, utf8 } from '../lib/bytes';
import { openCamera, Scanner } from '../lib/camera';
import { decodeAnswer, decodeOffer, encodeAnswer, encodeOffer, Peer, type PeerEvents } from '../lib/p2p';
import { drawQr, makeQr } from '../lib/qr';

setupPage();
const status = $('#status');
const list = $('#list');
let peer: Peer | null = null;
let camera: MediaStream | null = null;
let scanner: Scanner | null = null;

const events: PeerEvents = {
  async onOpen() {
    stopCamera();
    $('#host').hidden = true;
    $('#join').hidden = true;
    $('#session').hidden = false;
    $('#receivedCard').hidden = false;
    status.textContent = '';
    $('#route').textContent = `Connected ${await peer!.route()}.`;
  },
  onClose() {
    status.innerHTML = '<span class="warn">Disconnected. Reload the page to connect again.</span>';
  },
  onReceive(m) {
    if (m.kind === 'text') renderReceived(list, { name: '', type: 'text/plain', text: m.text });
    else renderReceived(list, m, `${formatBytes(m.data.length)} in ${(m.ms / 1000).toFixed(1)} s, ${formatBytes(m.data.length / Math.max(m.ms / 1000, 0.001))}/s`);
    navigator.vibrate?.(60);
  },
  onProgress(p) {
    $('#xferBox').hidden = false;
    $<HTMLProgressElement>('#progress').value = p.total ? p.done / p.total : 1;
    const rate = p.done / Math.max(p.ms / 1000, 0.001);
    $('#xfer').textContent = `${p.dir === 'in' ? 'Receiving' : 'Sending'} ${p.name}: ${formatBytes(p.done)} of ${formatBytes(p.total)} · ${formatBytes(rate)}/s`;
  },
};

// ---- Mac side ---------------------------------------------------------------
$('#offerBtn').onclick = async () => {
  const stun = $<HTMLInputElement>('#stun').checked;
  peer?.pc.close();
  peer = new Peer(stun, events);
  status.textContent = 'Preparing connection code…';
  const sdp = await peer.createOffer();
  const url = `${location.origin}${location.pathname}#o=${toBase64Url(encodeOffer({ sdp, stun }))}`;
  const qr = makeQr(utf8(url), 'L');
  $('#offerBox').hidden = false;
  drawQr($<HTMLCanvasElement>('#offerQr'), qr);
  $('#offerInfo').textContent = `Code holds ${url.length} characters (QR ${qr.size}×${qr.size}). Scan it with the phone’s camera app.`;
  status.textContent = 'Waiting for the phone’s reply…';
};

async function useAnswer(bytes: Uint8Array): Promise<void> {
  if (!peer) return;
  try {
    await peer.acceptAnswer(decodeAnswer(bytes));
    status.textContent = 'Reply received. Connecting…';
    stopCamera();
  } catch (e) {
    status.innerHTML = `<span class="warn">That reply didn’t work: ${(e as Error).message}</span>`;
  }
}

$('#scanReply').onclick = async () => {
  const video = $<HTMLVideoElement>('#video');
  video.hidden = false;
  camera = await openCamera();
  video.srcObject = camera;
  await video.play();
  let used = false;
  scanner = new Scanner({
    video,
    maxSide: 1280,
    colour: false,
    onCodes: (codes) => {
      if (used) return;
      const reply = codes.find((c) => c[0] === 0x03);
      if (reply) {
        used = true;
        void useAnswer(reply);
      }
    },
  });
  scanner.start();
  status.textContent = 'Hold the phone’s reply code up to the webcam…';
};

$('#useReply').onclick = () => {
  const code = $<HTMLInputElement>('#replyCode').value.trim();
  if (code) void useAnswer(fromBase64Url(code));
};

function stopCamera(): void {
  scanner?.stop();
  camera?.getTracks().forEach((t) => t.stop());
  camera = null;
  $('#video').hidden = true;
}

// ---- Phone side -------------------------------------------------------------
async function join(encoded: string): Promise<void> {
  history.replaceState(null, '', location.pathname); // don't reuse a stale offer on reload
  $('#host').hidden = true;
  $('#join').hidden = false;
  status.textContent = 'Preparing reply…';
  try {
    const offer = decodeOffer(fromBase64Url(encoded));
    peer = new Peer(offer.stun, events);
    const answer = encodeAnswer(await peer.acceptOffer(offer.sdp));
    drawQr($<HTMLCanvasElement>('#replyQr'), makeQr(answer, 'L'));
    status.textContent = 'Waiting for the Mac to scan the reply…';
    $('#copyReply').onclick = async () => {
      await navigator.clipboard.writeText(toBase64Url(answer));
      $('#copyReply').textContent = 'Copied. Send it to the Mac some other way.';
    };
  } catch (e) {
    status.innerHTML = `<span class="warn">That connection code didn’t work: ${(e as Error).message}</span>`;
  }
}

const m = location.hash.match(/^#o=(.+)$/);
if (m) void join(m[1]);

// ---- Both sides once connected ---------------------------------------------
$('#sendText').onclick = () => {
  const box = $<HTMLTextAreaElement>('#msg');
  if (!box.value || !peer) return;
  peer.sendText(box.value);
  status.textContent = 'Text sent.';
  box.value = '';
};
$<HTMLInputElement>('#files').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  for (const f of input.files ?? []) await peer?.sendFile(f);
  input.value = '';
};
