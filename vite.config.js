import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// Dev proxy target: the multiplayer server (github.com/kckc101/hh), default localhost:3001.
const API = process.env.SERVER_URL || `http://localhost:${process.env.SERVER_PORT || 3001}`;

export default defineConfig({
  base: './', // relative asset paths, so the build also works from a sub-path (e.g. GitHub Pages)
  plugins: [tailwindcss()],
  server: {
    host: true, // reachable from phones on the same Wi-Fi
    port: 5173,
    proxy: {
      '/socket.io': { target: API, ws: true },
      '/api': API,
      '/uploads': API,
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
