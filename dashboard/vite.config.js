import { defineConfig } from 'vite';

// A new id per build. The page compares it with /version.json to notice a deploy and reload.
const BUILD_ID = String(Date.now());
const versionFile = {
  name: 'version-file',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
  },
};

// The wall tablet runs Android WebView 106 — keep JS output within Chromium 106.
// CSS targets chrome61 on purpose: the tablet's WebView rejects 4/8-digit hex colours (#0000,
// #ffffffbf) even though Chrome 106 should support them, and a newer target lets the minifier
// rewrite transparent/rgba() into that form. Verified on-device with CSS.supports().
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [versionFile],
  build: {
    target: 'chrome106',
    cssTarget: 'chrome61',
  },
  // Local dev: forward the live-data API to the frame server (cd server && PORT=8080 node index.js).
  server: { host: true, proxy: { '/api': 'http://localhost:8080' } },
});
