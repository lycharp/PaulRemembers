import { useState } from 'react';
import { createJournal } from '../db';
import { useCurrentJournal, useWritableJournals } from '../journals';
import { importAppleJournal, sourceFromFiles, sourceFromZip, type ImportProgress, type ImportResult } from '../importer/appleJournal';
import { go } from '../util';

export function ImportPage() {
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<(ImportResult & { journalId?: string }) | null>(null);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState(false);
  const journals = useWritableJournals();
  const [current, setCurrent] = useCurrentJournal();
  const [picked, setPicked] = useState<string>();
  const target = picked ?? (current !== 'all' && journals?.some((j) => j.id === current) ? current : journals?.find((j) => !j.role || j.role === 'owner')?.id);
  const pickJournal = async (v: string) => {
    if (v !== '__new') return setPicked(v);
    const name = prompt('Name for the new journal');
    if (name?.trim()) setPicked((await createJournal(name)).id);
  };

  const doneName = journals?.find((j) => j.id === result?.journalId)?.name;

  const run = async (files: File[]) => {
    if (!files.length) return;
    setError('');
    setResult(null);
    setProgress({ done: 0, total: 1, message: 'Opening export…' });
    try {
      const zip = files.length === 1 && /\.zip$/i.test(files[0].name);
      const src = zip ? await sourceFromZip(files[0]) : sourceFromFiles(files);
      setResult({ ...(await importAppleJournal(src, setProgress, target)), journalId: target });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="import-page">
      <h1>Import from Apple Journal</h1>
      <ol className="steps">
        <li>On your iPhone, open <strong>Journal</strong>, tap the <strong>⋯</strong> menu, then <strong>Settings → Export Journal</strong>, and save it to iCloud Drive.</li>
        <li>In the <strong>Files</strong> app, long-press the <code>AppleJournalEntries</code> folder and tap <strong>Compress</strong>.</li>
        <li>On your PC, download the .zip from <a href="https://www.icloud.com/iclouddrive" target="_blank" rel="noreferrer">icloud.com</a> (or open iCloud Drive in File Explorer), then drop it below.</li>
      </ol>

      {journals && (
        <p className="import-target">
          <label>
            Add the entries to{' '}
            <select value={target} onChange={(e) => pickJournal(e.target.value)} disabled={!!progress}>
              {journals.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              <option value="__new">＋ New journal…</option>
            </select>
          </label>
        </p>
      )}

      <label className={`dropzone ${drag ? 'drag' : ''} ${progress ? 'busy' : ''}`}
        onDragOver={(e) => (e.preventDefault(), setDrag(true))}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          run([...e.dataTransfer.files]);
        }}>
        <input type="file" accept=".zip,application/zip" hidden disabled={!!progress}
          onChange={(e) => run([...(e.target.files ?? [])])} />
        {progress ? (
          <>
            <div className="progress"><div style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} /></div>
            <div>{progress.message}</div>
            <div className="muted small">{progress.done} of {progress.total} entries · photos are converted from HEIC, so this can take a minute</div>
          </>
        ) : (
          <>
            <div className="dz-icon">📦</div>
            <strong>Drop your export .zip here</strong>
            <span className="muted">or click to choose it</span>
          </>
        )}
      </label>
      <p className="muted small center">
        Already unzipped?{' '}
        <label className="link">
          Choose the AppleJournalEntries folder instead
          <input type="file" hidden
            // @ts-expect-error webkitdirectory is supported by Chromium browsers
            webkitdirectory=""
            onChange={(e) => run([...(e.target.files ?? [])])} />
        </label>
      </p>

      {error && <div className="notice error">{error}</div>}
      {result && (
        <div className="notice ok">
          <strong>Imported {result.imported} {result.imported === 1 ? 'entry' : 'entries'}</strong>
          {doneName && <> into <strong>{doneName}</strong></>} with {result.media} photos, videos and maps.
          {result.skipped > 0 && <> Skipped {result.skipped} {result.skipped === 1 ? 'entry that was' : 'entries that were'} already in {doneName ?? 'this journal'} (same date and title).</>}
          {result.warnings.length > 0 && (
            <details>
              <summary>{result.warnings.length} notes</summary>
              <ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          <div className="row"><button className="btn primary" onClick={() => { if (result.journalId) setCurrent(result.journalId); go('/'); }}>Open {doneName ?? 'journal'}</button></div>
        </div>
      )}
      <p className="muted small">Everything stays on this computer. Nothing is uploaded anywhere. Importing the same export again only adds entries that are new: anything with the same date and title as an entry already in the chosen journal is skipped.</p>
    </div>
  );
}
