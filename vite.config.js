import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

// Dev proxy target: the multiplayer server (github.com/kckc101/hh), default localhost:3001.
const API = process.env.SERVER_URL || `http://localhost:${process.env.SERVER_PORT || 3001}`;

export default defineConfig({
  base: './', // relative asset paths, so the build also works from a sub-path (e.g. GitHub Pages)
  plugins: [tailwindcss()],
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    port: 5173,
    // And from the internet through a tunnel (localhost.run: https://<random>.lhr.life, or a
    // Cloudflare quick tunnel: https://<random>.trycloudflare.com). Vite only answers hosts it's told about.
    allowedHosts: ['.lhr.life', '.localhost.run', '.trycloudflare.com'],
    // xfwd: tell the server who each request is really from (X-Forwarded-For), so its per-client
    // limits are per raver, not one bucket for everyone behind this proxy.
    proxy: {
      '/socket.io': { target: API, ws: true, xfwd: true },
      '/api': { target: API, xfwd: true },
      '/uploads': { target: API, xfwd: true },
    },
  },
  build: {
    target: 'es2022',
    // Two pages: the rave (its ticket entrance first) and the separate tickets page.
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tickets: fileURLToPath(new URL('./tickets/index.html', import.meta.url)),
      },
    },
    // Keep the AudioWorklet module a real file: audioWorklet.addModule() with a data: URL
    // isn't reliable across browsers.
    assetsInlineLimit: (file) => (file.endsWith('-worklet.js') ? false : undefined),
    chunkSizeWarningLimit: 1500,
  },
});
