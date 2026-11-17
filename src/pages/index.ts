import { setupPage, $ } from '../common';
import { utf8 } from '../lib/bytes';
import { drawQr, makeQr } from '../lib/qr';

setupPage();
const url = new URL('./scan.html', location.href).href;
$('#openUrl').textContent = url;
requestAnimationFrame(() => drawQr($<HTMLCanvasElement>('#openQr'), makeQr(utf8(url), 'M')));
