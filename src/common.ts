import './style.css';

const PAGES: [string, string][] = [
  ['text.html', '1 · Text QR'],
  ['animated.html', '2 · Animated QR'],
  ['scan.html', 'Phone scanner'],
  ['p2p.html', '3 · Direct P2P'],
];

/** Shared header, and the service worker so the app installs and works offline. */
export function setupPage(): void {
  const here = location.pathname.split('/').pop() || 'index.html';
  const header = document.createElement('header');
  header.innerHTML =
    `<a class="home" href="./">Laptop → Phone</a>` +
    PAGES.map(([href, label]) => `<a href="./${href}"${href === here ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  document.body.prepend(header);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (!el) throw new Error(`missing ${sel}`);
  return el;
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** Ask the OS share sheet to send text or files (on a Mac this includes AirDrop). */
export async function shareViaSystem(data: { text?: string; files?: File[] }): Promise<string> {
  if (!navigator.share) return 'This browser has no share sheet. Try Safari, or a recent Chrome.';
  if (data.files?.length && navigator.canShare && !navigator.canShare({ files: data.files })) {
    return 'This browser cannot share these files.';
  }
  try {
    await navigator.share(data);
    return 'Shared.';
  } catch (e) {
    return (e as Error).name === 'AbortError' ? 'Cancelled.' : `Share failed: ${(e as Error).message}`;
  }
}

/** Show something that was received: text with Copy / Open, or a file with a preview and Save. */
export function renderReceived(list: HTMLElement, item: { name: string; type: string; data?: Uint8Array; text?: string }, note = ''): void {
  const div = document.createElement('div');
  div.className = 'item';
  const when = new Date().toLocaleTimeString();
  if (item.text !== undefined) {
    const isUrl = /^https?:\/\/\S+$/i.test(item.text.trim());
    div.innerHTML = `<span class="pill">text · ${when}${note ? ' · ' + escapeHtml(note) : ''}</span><pre></pre><div class="row"><button class="copy">Copy</button>${
      isUrl ? `<a class="button secondary" target="_blank" rel="noopener" href="${escapeHtml(item.text.trim())}">Open link</a>` : ''
    }</div>`;
    div.querySelector('pre')!.textContent = item.text;
    const btn = div.querySelector<HTMLButtonElement>('.copy')!;
    btn.onclick = async () => {
      await navigator.clipboard.writeText(item.text!);
      btn.textContent = 'Copied';
    };
  } else if (item.data) {
    const blob = new Blob([item.data as BlobPart], { type: item.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const name = item.name || 'file';
    div.innerHTML = `<span class="pill">file · ${when}${note ? ' · ' + escapeHtml(note) : ''}</span><div><strong></strong> <span class="muted">${(item.data.length / 1024).toFixed(1)} KB</span></div>${
      item.type.startsWith('image/') ? `<img src="${url}" alt="">` : ''
    }<div class="row"><a class="button" download="${escapeHtml(name)}" href="${url}">Save</a></div>`;
    div.querySelector('strong')!.textContent = name;
  }
  list.prepend(div);
}
