import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const page = (name: string) => resolve(import.meta.dirname, name);

export default defineConfig({
  // Relative base so the build works on GitHub Pages under /<repo>/ and anywhere else.
  base: './',
  build: {
    rollupOptions: {
      input: {
        index: page('index.html'),
        text: page('text.html'),
        animated: page('animated.html'),
        scan: page('scan.html'),
        p2p: page('p2p.html'),
      },
    },
  },
});
