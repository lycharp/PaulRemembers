import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// One id per build. The app compares its own id with the live version.json
// to tell when a newer version has been published.
const BUILD_ID = new Date().toISOString();

function versionFile(): Plugin {
  return {
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

// BASE_PATH lets the GitHub Pages workflow serve the app from /<repo-name>/.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  // heic2any (HEIC → JPEG) is large but only loaded when importing photos.
  build: { chunkSizeWarningLimit: 1500 },
});
