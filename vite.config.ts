import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { execSync } from 'node:child_process';

// One id per build. The app compares its own id with the live version.json
// to tell when a newer version has been published.
const BUILD_ID = new Date().toISOString();
// Version rule (Paul): Version 3.0 is the "who wrote what" pull request (2026-11-17),
// and every pull request merged after it adds .1 (3.1, 3.2 …). Version 2: PR #44 was 2.0, and every pull request
// merged after it adds .1 (2.1, 2.2, … 2.10). Counted from the "Merge pull request #N"
// commits on main, so it stays automatic. Before #44: "1.<latest merged PR number>".
function appVersion(): string {
  const git = (args: string) => execSync(`git log ${args}`, { encoding: 'utf8' }).trim();
  try {
    // Version 4.0 is the merge that brought in invite emails sent by the app (supabase/functions/send-invite).
    const v4 = git('--merges --first-parent --grep="^Merge pull request #" --format=%H -- supabase/functions/send-invite').split('\n').filter(Boolean).pop();
    if (v4) {
      const after = git(`--merges --first-parent --grep="^Merge pull request #" --format=%h ${v4}..HEAD`);
      return `4.${after ? after.split('\n').length : 0}`;
    }
    // Version 3.0 is the merge that brought in "who wrote what" (the first one with src/cloud/people.ts).
    const v3 = git('--merges --first-parent --grep="^Merge pull request #" --format=%H -- src/cloud/people.ts').split('\n').filter(Boolean).pop();
    if (v3) {
      const after = git(`--merges --first-parent --grep="^Merge pull request #" --format=%h ${v3}..HEAD`);
      return `3.${after ? after.split('\n').length : 0}`;
    }
    const v2 = git('-1 --merges --first-parent --grep="^Merge pull request #44 " --format=%H');
    if (v2) {
      const after = git(`--merges --first-parent --grep="^Merge pull request #" --format=%h ${v2}..HEAD`);
      return `2.${after ? after.split('\n').length : 0}`;
    }
    const n = git('-1 --merges --grep="^Merge pull request #" --format=%s').match(/#(\d+)/)?.[1];
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

// Relative base so the app works at any address (custom domain or /<repo-name>/).
// BASE_PATH can still override it.
export default defineConfig({
  base: process.env.BASE_PATH ?? './',
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID), __APP_VERSION__: JSON.stringify(APP_VERSION) },
  // heic2any (HEIC → JPEG) is large but only loaded when importing photos.
  build: { chunkSizeWarningLimit: 1500 },
});
