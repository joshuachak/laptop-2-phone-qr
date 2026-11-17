# Laptop → Phone

Experiments for getting text and files from a laptop (Mac) to a phone (Android) quickly and privately, with nothing to sign in to. Everything runs in the browser and there is no app server: the pages are static files.

| Page | Approach | Server? | Good for |
| --- | --- | --- | --- |
| `text.html` | **1. One QR code.** Text becomes a QR code. "Plain" opens in any camera app; "Compact" is compressed and needs our scanner. | None | Text, links |
| `animated.html` | **2. Animated QR** with an LT fountain code: any ~110% of frames rebuild the file, in any order. Optional **colour mode (approach 4)** packs 3 codes into the R, G and B channels of each frame. | None | Photos, small files |
| `p2p.html` | **3. Direct WebRTC with no signalling server.** The phone scans the Mac's offer (a URL, so the stock camera opens it), the Mac's webcam scans the phone's reply, then data flows peer-to-peer, encrypted. | None. Optional public STUN lookup to connect across networks | Big files, both directions |
| Share buttons | **5. System share sheet** (Web Share API). On a Mac this offers AirDrop, which reaches Pixel 10 phones via Quick Share. | None | Anything, if you have a Pixel 10 |
| `scan.html` | The phone receiver for 1, 2 and 4. Installable as a PWA. | | |

## Try it

The camera only works on HTTPS, so the easiest way is GitHub Pages:

1. In the repo, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Merge to `main`. The workflow in `.github/workflows/pages.yml` tests, builds and deploys.
3. Open the site on the Mac, and scan the QR code on the home page with the phone to open the scanner.

Local development:

```sh
npm install
npm run dev     # http://localhost:5173 (camera works on localhost only)
npm test        # fountain code, packet and QR round-trip tests
npm run build
```

## How the pieces fit

- `src/lib/qr.ts`: QR generation (qrcode-generator, byte mode) and fast canvas drawing, including colour layering.
- `src/lib/fountain.ts`: LT fountain encoder and peeling decoder. Seeds below K are the source blocks themselves, so a clean capture needs exactly K frames.
- `src/lib/packet.ts`: what a QR code carries. The first byte tags the kind: compact text, fountain frame or P2P reply. Anything else is plain text.
- `src/lib/camera.ts` and `decoder.worker.ts`: camera capture with jsQR decoding in a Web Worker. Colour mode decodes each channel separately.
- `src/lib/p2p.ts`: serverless WebRTC. Waits for ICE gathering so each description is complete, compresses it, and sends files in 64 KB chunks with back-pressure.

## Things to measure on real devices

- Animated QR: KB/s at different bytes per code and frames per second, distance and brightness. Decimen reports about 20 to 25 KB/s laptop to phone when tuned.
- Colour mode: does the 3× capacity survive real screens and cameras?
- P2P: does it connect on the same Wi-Fi with the STUN box unticked? Across networks (phone on mobile data) with it ticked?
