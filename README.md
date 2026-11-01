# PaulRemembers

A private journal that runs in the browser on Windows, modelled on Apple's Journal app, with an importer for the export Apple Journal produces.

Everything is stored in the browser on your computer (IndexedDB). Nothing is uploaded to a server.

## Features

- **Timeline** of entries grouped by month, with photo previews, search, and filters for bookmarked entries, entries with photos or videos, and entries with places.
- **Entries** with title, text, date and time, photos, videos, recorded audio, a place (typed or from your current location), a mood, and an optional writing prompt.
- **Calendar** showing which days you journaled, with a photo from each day.
- **Insights**: current and longest streak, entries this year, words written, top places, and "On this day".
- **Import from Apple Journal**: drop the export .zip (or choose the unzipped folder). Titles, text, dates, photos, live photos, videos, map pins and places come across. HEIC photos are converted to JPEG so Windows browsers can show them. Importing the same export again only adds new entries.
- **Backup and restore** to a single .zip file, a **passcode lock**, dark mode, and it installs as an app from Edge or Chrome and works offline.

## Getting your Apple Journal export onto your PC

1. On iPhone: Journal → ⋯ → Settings → Export Journal, and save it to iCloud Drive.
2. In the Files app, long-press the `AppleJournalEntries` folder and tap **Compress**.
3. On the PC, download the .zip from icloud.com (or iCloud Drive in File Explorer).
4. In the app, open **Import** and drop the .zip.

### Videos

iPhone videos are HEVC (H.265). Edge and Chrome on Windows play them once Microsoft's **HEVC Video Extensions** is installed from the Microsoft Store. Without it, the app shows a download link for the video instead.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

### Publishing on GitHub Pages

`.github/workflows/deploy.yml` builds and deploys on every push to `main`. Turn it on once in the repository's **Settings → Pages → Build and deployment → Source: GitHub Actions**. The site will be at `https://<owner>.github.io/PaulRemembers/`. Your journal data still never leaves your browser; only the app's code is published.

## How the importer reads the export

The export is a folder with `index.html`, `Entries/<date>_<title>.html` (one page per entry), and `Resources/` (photos, videos, map snapshots, plus `<id>.json` metadata with capture dates and places). See `src/importer/appleJournal.ts`.

Never commit your export or backups to this repository. `.gitignore` excludes `.zip` files and `AppleJournalEntries/`.
