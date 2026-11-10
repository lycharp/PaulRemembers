import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// One id per build. The app compares its own id with the live version.json
// to tell when a newer version has been published.
const BUILD_ID = new Date().toISOString();

// Version rule: "1.<number of the latest merged pull request>", read from the
// newest "Merge pull request #N" commit. Falls back to 1.0 if git can't tell.
function appVersion(): string {
  try {
    const msg = execSync('git log -1 --merges --grep="^Merge pull request #" --format=%s', { encoding: 'utf8' });
    const n = msg.match(/#(\d+)/)?.[1];
    if (n) return `1.${n}`;
  } catch { /* no git history available */ }
  return '1.0';
}
const APP_VERSION = appVersion();

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
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // heic2any (HEIC → JPEG) is large but only loaded when importing photos.
  build: { chunkSizeWarningLimit: 1500 },
});
