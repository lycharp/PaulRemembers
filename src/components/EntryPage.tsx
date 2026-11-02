import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { db, defaultJournalId, deleteEntry, emptyEntry, newId, type Entry, type Media, type MediaKind } from '../db';
import { fmtDay, fmtTime, go, MOODS, moodFor, PROMPTS, toLocalInput, wordCount } from '../util';
import { Gallery, Lightbox, MediaTile, PendingTile } from './Media';
import { JournalDot, useCurrentJournal, useJournals } from '../journals';
import { heicToJpeg, isHeic } from '../importer/appleJournal';
import { ShareEntryButton } from './Sharing';
import type { LocalJournal } from '../cloud/sync';

async function fileToMedia(file: File, entryId: string): Promise<Media> {
  let blob: Blob = file;
  let kind: MediaKind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'photo';
  if (/\.mov$/i.test(file.name)) blob = new Blob([file], { type: 'video/mp4' });
  if (kind === 'photo' && (await isHeic(file))) blob = await heicToJpeg(file);
  return { id: newId(), entryId, kind, blob, takenAt: file.lastModified };
}

export function EntryPage({ id }: { id?: string }) {
  // undefined while loading, null when the entry does not exist.
  const stored = useLiveQuery(async () => (id ? (await db.entries.get(id)) ?? null : null), [id]);
  const [draft, setDraft] = useState<Entry | null>(null);
  const [isNew] = useState(!id);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // Journals someone shared with you as a viewer are read-only.
  const readOnly = useLiveQuery(async () => {
    const j = stored ? ((await db.journals.get(stored.journalId)) as LocalJournal | undefined) : undefined;
    return j?.role === 'viewer';
  }, [stored]);

  const [current, , currentLoaded] = useCurrentJournal();
  const journals = useJournals();
  useEffect(() => {
    if (id || !currentLoaded) return;
    let live = true;
    (async () => {
      const journalId = current !== 'all' ? current : await defaultJournalId();
      if (live) setDraft((d) => d ?? emptyEntry(journalId));
    })();
    return () => { live = false; };
  }, [id, currentLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (id && stored === null) return <p className="muted center">Entry not found.</p>;
  if (draft) return <Editor draft={draft} setDraft={setDraft} isNew={isNew} />;
  if (!stored) return null;

  const e = stored;
  const mood = moodFor(e.mood);
  const journal = journals?.find((j) => j.id === e.journalId);
  return (
    <div className="entry-view">
      <div className="entry-actions">
        <button className="btn ghost" onClick={() => go('/')}>‹ Journal</button>
        <div className="row">
          {!readOnly && <button className="btn ghost" title={e.bookmarked ? 'Remove bookmark' : 'Bookmark'}
            onClick={() => db.entries.update(e.id, { bookmarked: !e.bookmarked, updatedAt: Date.now() })}>
            {e.bookmarked ? '🔖 Bookmarked' : '🔖 Bookmark'}
          </button>}
          <ShareEntryButton entry={e} />
          {!readOnly && <button className="btn primary" onClick={() => setDraft({ ...e })}>Edit</button>}
        </div>
      </div>
      <div className="entry-date">{fmtDay(e.date)}</div>
      {e.prompt && <div className="prompt-card">{e.prompt}</div>}
      {e.mediaIds.length > 0 && (
        <Gallery ids={e.mediaIds} className="media-gallery">
          {(m, i, tile) => <MediaTile key={m} id={m} onOpen={() => setLightbox(i)} {...tile} />}
        </Gallery>
      )}
      {e.title && <h1 className="entry-title">{e.title}</h1>}
      <div className="entry-body">
        {e.body.split(/\n{2,}/).map((p, i) => <p key={i}>{p}</p>)}
      </div>
      <div className="entry-footer">
        {e.place && (
          <span>
            📍{' '}
            {e.place.lat != null ? (
              <a href={`https://www.openstreetmap.org/?mlat=${e.place.lat}&mlon=${e.place.lng}#map=15/${e.place.lat}/${e.place.lng}`} target="_blank" rel="noreferrer">{e.place.name}</a>
            ) : e.place.name}
          </span>
        )}
        {mood && <span>{mood.emoji} {mood.label}</span>}
        {journal && journals && journals.length > 1 && <span><JournalDot color={journal.color} /> {journal.name}</span>}
        <span>{wordCount(e.body)} words</span>
        {e.sourceKey && <span>Imported from Apple Journal</span>}
      </div>
      {lightbox != null && <Lightbox ids={e.mediaIds} start={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function Editor({ draft, setDraft, isNew }: { draft: Entry; setDraft: (e: Entry | null) => void; isNew: boolean }) {
  const [pendingMedia, setPendingMedia] = useState<Media[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  const [promptIdx, setPromptIdx] = useState(() => Math.floor(Math.random() * PROMPTS.length));
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<Entry>) => setDraft({ ...draft, ...patch });

  useEffect(() => {
    const t = bodyRef.current;
    if (t) {
      t.style.height = 'auto';
      t.style.height = `${t.scrollHeight}px`;
    }
  }, [draft.body]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy('Adding media…');
    try {
      const added: Media[] = [];
      for (const f of files) added.push(await fileToMedia(f, draft.id));
      setPendingMedia((p) => [...p, ...added]);
      set({ mediaIds: [...draft.mediaIds, ...added.map((m) => m.id)] });
    } finally {
      setBusy('');
    }
  };

  const toggleRecording = async () => {
    if (recorder) {
      recorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => chunks.push(ev.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const m: Media = { id: newId(), entryId: draft.id, kind: 'audio', blob: new Blob(chunks, { type: rec.mimeType }), takenAt: Date.now() };
        setPendingMedia((p) => [...p, m]);
        setDraft({ ...draftRef.current, mediaIds: [...draftRef.current.mediaIds, m.id] });
        setRecorder(null);
      };
      rec.start();
      setRecorder(rec);
    } catch {
      alert('Could not use the microphone. Check that the browser has permission.');
    }
  };
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const useLocation = () => {
    if (!navigator.geolocation) return;
    setBusy('Finding your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        let name = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
        try {
          const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`);
          const j = await r.json();
          const a = j.address ?? {};
          name = [a.suburb ?? a.neighbourhood, a.city ?? a.town ?? a.village, a.state].filter(Boolean).join(', ') || name;
        } catch { /* offline: keep coordinates */ }
        setDraft({ ...draftRef.current, place: { name, lat, lng } });
        setBusy('');
      },
      () => setBusy(''),
      { timeout: 10000 }
    );
  };

  const save = async () => {
    const empty = !draft.title.trim() && !draft.body.trim() && draft.mediaIds.length === 0;
    if (isNew && empty) {
      go('/');
      return;
    }
    const entry = { ...draft, updatedAt: Date.now() };
    await db.transaction('rw', db.entries, db.media, async () => {
      await db.media.bulkPut(pendingMedia.filter((m) => entry.mediaIds.includes(m.id)));
      await db.media.bulkDelete(removed);
      await db.entries.put(entry);
    });
    setDraft(null);
    if (isNew) go(`/entry/${entry.id}`);
  };

  const cancel = () => {
    setDraft(null);
    if (isNew) go('/');
  };

  const remove = async () => {
    if (!confirm('Delete this entry? This cannot be undone.')) return;
    await deleteEntry(draft.id);
    go('/');
  };

  return (
    <div className="entry-edit">
      <div className="entry-actions">
        <button className="btn ghost" onClick={cancel}>Cancel</button>
        <div className="row">
          {!isNew && <button className="btn ghost danger" onClick={remove}>Delete</button>}
          <button className="btn primary" onClick={save} disabled={!!busy || !!recorder}>Done</button>
        </div>
      </div>

      <JournalPicker value={draft.journalId} onChange={(journalId) => set({ journalId })} />
      <input className="date-input" type="datetime-local" value={toLocalInput(draft.date)}
        onChange={(e) => e.target.value && set({ date: new Date(e.target.value).getTime() })} />

      {draft.prompt ? (
        <div className="prompt-card">
          {draft.prompt}
          <button className="link" onClick={() => set({ prompt: undefined })}>Remove</button>
        </div>
      ) : isNew && !draft.body && (
        <div className="prompt-suggest">
          <span className="muted">Need an idea?</span> <strong>{PROMPTS[promptIdx]}</strong>
          <div className="row">
            <button className="btn small" onClick={() => set({ prompt: PROMPTS[promptIdx] })}>Use this prompt</button>
            <button className="btn small ghost" onClick={() => setPromptIdx((promptIdx + 1) % PROMPTS.length)}>Another</button>
          </div>
        </div>
      )}

      {draft.mediaIds.length > 0 && (
        <Gallery ids={draft.mediaIds} className="media-gallery" rowHeight={180} maxHeight={360}>
          {(m, _i, tile) => {
            const pending = pendingMedia.find((p) => p.id === m);
            const onRemove = () => {
              set({ mediaIds: draft.mediaIds.filter((x) => x !== m) });
              if (!pending) setRemoved((r) => [...r, m]);
            };
            return pending ? <PendingTile key={m} media={pending} onRemove={onRemove} {...tile} /> : <MediaTile key={m} id={m} onRemove={onRemove} {...tile} />;
          }}
        </Gallery>
      )}

      <input className="title-input" placeholder="Title" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
      <textarea ref={bodyRef} className="body-input" placeholder="Start writing…" value={draft.body}
        autoFocus={isNew} onChange={(e) => set({ body: e.target.value })} />

      <div className="edit-tools">
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*,.heic,.heif" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        <button className="btn" onClick={() => fileRef.current?.click()}>🖼️ Photos & videos</button>
        <button className={`btn ${recorder ? 'recording' : ''}`} onClick={toggleRecording}>{recorder ? '⏹ Stop recording' : '🎙️ Record audio'}</button>
        <button className="btn" onClick={useLocation}>📍 Use my location</button>
        <input className="place-input" placeholder="Place" value={draft.place?.name ?? ''}
          onChange={(e) => set({ place: e.target.value ? { ...draft.place, name: e.target.value } : undefined })} />
      </div>
      <div className="moods">
        <span className="muted">How are you feeling?</span>
        {MOODS.map((m) => (
          <button key={m.id} className={`mood ${draft.mood === m.id ? 'on' : ''}`} title={m.label}
            onClick={() => set({ mood: draft.mood === m.id ? undefined : m.id })}>{m.emoji}</button>
        ))}
      </div>
      {busy && <p className="muted">{busy}</p>}
      <p className="muted small">{fmtDay(draft.date)} at {fmtTime(draft.date)} · {wordCount(draft.body)} words</p>
    </div>
  );
}

function JournalPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const journals = useJournals();
  if (!journals || journals.length < 2) return null;
  const j = journals.find((x) => x.id === value);
  return (
    <label className="journal-picker">
      <JournalDot color={j?.color} />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Journal">
        {journals.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
      </select>
    </label>
  );
}
