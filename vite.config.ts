import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// BASE_PATH lets the GitHub Pages workflow serve the app from /<repo-name>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react()],
  // heic2any (HEIC → JPEG) is large but only loaded when importing photos.
  build: { chunkSizeWarningLimit: 1500 },
});
