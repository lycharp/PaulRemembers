import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { db, defaultJournalId, deleteEntry, emptyEntry, newId, type Entry, type Media, type MediaKind } from '../db';
import { fmtDay, fmtTime, go, MOODS, setLeaveGuard, moodFor, PROMPTS, toLocalInput, wordCount } from '../util';
import { AudioTranscript, EditTranscript, Gallery, KeptTranscript, Lightbox, MediaTile, PendingTile } from './Media';
import { JournalLine, JournalMark, splitJournals, toggleSharedBookmark, useJournalLabel, useCurrentJournal, useIsBookmarked, useJournals, useWritableJournals } from '../journals';
import { heicToJpeg, isHeic } from '../importer/appleJournal';
import { PlaceInput } from './PlaceInput';
import { Icon } from './Icon';
import { Linkified } from './Linkified';
import { makePoster } from '../poster';
import { needsShrink, shrinkVideo } from '../shrink';
import { Dialog, ShareEntryButton } from './Sharing';
import { Contributors } from './People';
import { EntryReactions } from './Reactions';
import { Loading } from './Loading';
import { askSure } from './Confirm';
import { cloudUser } from '../cloud/cloud';

async function fileToMedia(file: File, entryId: string, onShrink?: (fraction: number) => void): Promise<Media> {
  // Copy the bytes now. Safari (iPhone/iPad) stores a picked file as a link to
  // the original, which can no longer be read after the page reloads, so the
  // photo would show blank and never upload.
  let blob: Blob = new Blob([await file.arrayBuffer()], { type: file.type });
  let kind: MediaKind = file.type.startsWith('video') ? 'video' : file.type.startsWith('audio') ? 'audio' : 'photo';
  if (/\.mov$/i.test(file.name)) blob = new Blob([blob], { type: 'video/mp4' });
  if (kind === 'photo' && (await isHeic(file))) blob = await heicToJpeg(file);
  const poster = kind === 'video' ? await makePoster(blob) : undefined;
  if (kind === 'video' && needsShrink(blob)) {
    onShrink?.(0);
    blob = (await shrinkVideo(blob, onShrink)) ?? blob;
  }
  return { id: newId(), entryId, kind, blob, poster, takenAt: file.lastModified };
}

/** Image files on the clipboard, from a paste event. */
function clipboardImages(data: DataTransfer | null): File[] {
  // Text copied from Word or Excel can also carry a picture of itself; paste that as text.
  if (!data || data.getData('text/plain').trim()) return [];
  const files = [...data.files].filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
  if (files.length) return files;
  // Some browsers only list the image under items.
  return [...data.items]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
}

export function EntryPage({ id }: { id?: string }) {
  // undefined while loading, null when the entry does not exist.
  const stored = useLiveQuery(async () => (id ? (await db.entries.get(id)) ?? null : null), [id]);
  const [draft, setDraft] = useState<Entry | null>(null);
  const [isNew] = useState(!id);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // Open every entry at the very top. Otherwise the page keeps where the list was
  // scrolled to, and on iPhone the Back/Edit row ends up behind the clock.
  useLayoutEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [id]);
  // Journals someone shared with you as a viewer are read-only.
  const readOnly = useLiveQuery(async () => {
    // Keyed on the journal id, not the entry, so an entry update (sync, video
    // snapshot…) doesn't reset this and make the buttons blink.
    const journalId = stored?.journalId;
    if (!journalId) return undefined;
    return (await db.journals.get(journalId))?.role === 'viewer';
  }, [stored?.journalId]);

  const [current, , currentLoaded] = useCurrentJournal();
  const journals = useJournals();
  const isBookmarked = useIsBookmarked();
  useEffect(() => {
    if (id || !currentLoaded) return;
    let live = true;
    (async () => {
      const cur = current !== 'all' ? await db.journals.get(current) : undefined;
      const journalId = cur && cur.role !== 'viewer' ? cur.id : await defaultJournalId();
      if (live) setDraft((d) => d ?? emptyEntry(journalId));
    })();
    return () => { live = false; };
  }, [id, currentLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  if (id && stored === null) return <p className="muted center">Entry not found.</p>;
  if (draft) return <Editor draft={draft} setDraft={setDraft} isNew={isNew} />;
  if (!stored) return <Loading />;

  const e = stored;
  const bookmarked = isBookmarked(e);
  const mood = moodFor(e.mood);
  const journal = journals?.find((j) => j.id === e.journalId);
  return (
    <div className="entry-view">
      <div className="entry-actions">
        <button className="btn ghost icon-tile" onClick={() => go('/')} title="Back to journal" aria-label="Back to journal"><Icon name="back" /></button>
        {/* Which journal, and who it's shared with: in the bar on a computer, on its own line under the buttons on a phone. */}
        <JournalLine journal={journal} />
        <div className="row nowrap">
          {readOnly !== undefined && <button className={`btn ghost icon-tile ${bookmarked ? 'on' : ''}`} title={bookmarked ? 'Remove bookmark' : 'Bookmark'} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark'} aria-pressed={bookmarked}
            onClick={() => (readOnly ? toggleSharedBookmark(e.id) : db.entries.update(e.id, { bookmarked: !e.bookmarked, updatedAt: Date.now() }))}>
            <Icon name={bookmarked ? 'bookmarked' : 'bookmark'} />
          </button>}
          <ShareEntryButton entry={e} />
          {readOnly === false && <button className="btn primary icon-tile" onClick={() => setDraft({ ...e })} title="Edit" aria-label="Edit"><Icon name="pen" /></button>}
        </div>
      </div>
      <div className="entry-date-row">
        <div className="entry-date">{fmtDay(e.date)}</div>
        <Contributors entry={e} journal={journal} tappable />
      </div>
      {e.prompt && <div className="prompt-card">{e.prompt}</div>}
      {e.mediaIds.length > 0 && (
        <Gallery ids={e.mediaIds} className="media-gallery">
          {(m, i, tile) => <MediaTile key={m} id={m} onOpen={() => setLightbox(i)} {...tile} />}
        </Gallery>
      )}
      {e.mediaIds.map((m) => <AudioTranscript key={m} id={m} />)}
      {e.transcripts?.map((t, i) => <KeptTranscript key={i} text={t} />)}
      {e.title && <h1 className="entry-title"><Linkified text={e.title} /></h1>}
      <div className="entry-body">
        {e.body.split(/\n{2,}/).map((p, i) => <p key={i}><Linkified text={p} /></p>)}
      </div>
      <EntryReactions entry={e} journal={journal} />
      <div className="entry-footer">
        {e.place && (
          <span>
            <Icon name="pin" className="inline-icon" />{' '}
            {e.place.lat != null ? (
              <a href={`https://www.openstreetmap.org/?mlat=${e.place.lat}&mlon=${e.place.lng}#map=15/${e.place.lat}/${e.place.lng}`} target="_blank" rel="noreferrer">{e.place.name}</a>
            ) : e.place.name}
          </span>
        )}
        {mood && <span>{mood.emoji} {mood.label}</span>}
        <span>{wordCount(e.body)} words</span>
        {e.sourceKey && <span>Imported from Apple Journal</span>}
      </div>
      {lightbox != null && <Lightbox ids={e.mediaIds} start={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

function Editor({ draft, setDraft, isNew }: { draft: Entry; setDraft: (e: Entry | null) => void; isNew: boolean }) {
  const [current, setCurrent] = useCurrentJournal();
  const [pendingMedia, setPendingMedia] = useState<Media[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [recorder, setRecorder] = useState<MediaRecorder | null>(null);
  // Transcripts changed in this edit (saved with the entry on Save), and how many are being made now.
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [transcribing, setTranscribing] = useState(0);
  const [promptIdx, setPromptIdx] = useState(() => Math.floor(Math.random() * PROMPTS.length));
  const fileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<Entry>) => setDraft({ ...draft, ...patch });
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // Title and text grow with what you type, so long titles wrap instead of running off the screen.
  useEffect(() => {
    const fit = () => {
      for (const t of [titleRef.current, bodyRef.current]) {
        if (!t) continue;
        t.style.height = 'auto';
        t.style.height = `${t.scrollHeight}px`;
      }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [draft.body, draft.title]);

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files?.length) return;
    setBusy('Adding media…');
    try {
      const added: Media[] = [];
      for (const f of files)
        added.push(await fileToMedia(f, draftRef.current.id, (p) => setBusy(`Making a big video smaller so it can sync… ${Math.round(p * 100)}%`)));
      setPendingMedia((p) => [...p, ...added]);
      setDraft({ ...draftRef.current, mediaIds: [...draftRef.current.mediaIds, ...added.map((m) => m.id)] });
    } finally {
      setBusy('');
    }
  };

  // Paste a copied photo (Ctrl+V on a computer, or tap and hold → Paste on a phone)
  // anywhere in the editor and it is added like a picked photo. Plain text pastes as usual.
  const addFilesRef = useRef(addFiles);
  addFilesRef.current = addFiles;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = clipboardImages(e.clipboardData);
      if (!files.length) return;
      e.preventDefault();
      addFilesRef.current(files);
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  // The 📋 button reads the clipboard directly. If the browser can't (or there is
  // no photo), open a box you can tap and hold in to Paste: on iPhone the writing
  // box only offers Paste for text, but this box accepts pictures.
  const [pasteBox, setPasteBox] = useState(false);
  const pastePhoto = async () => {
    try {
      const files: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        const blob = await item.getType(type);
        files.push(new File([blob], `pasted.${type.split('/')[1] || 'png'}`, { type, lastModified: Date.now() }));
      }
      if (files.length) return await addFiles(files);
    } catch { /* not allowed or not supported: use the paste box */ }
    setPasteBox(true);
  };
  const busyRef = useRef(busy);
  useEffect(() => {
    // Close the paste box once a pasted photo has been added.
    if (busyRef.current && !busy) setPasteBox(false);
    busyRef.current = busy;
  }, [busy]);


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

  // Ask before leaving with unsaved writing (a new entry with something in it, or edits).
  const initial = useRef(JSON.stringify(draft));
  const empty = !draft.title.trim() && !draft.body.trim() && draft.mediaIds.length === 0;
  // Save only shows once the entry has a title.
  const hasTitle = !!draft.title.trim();
  const dirty = isNew ? !empty : JSON.stringify(draft) !== initial.current || removed.length > 0 || Object.keys(transcripts).length > 0;
  const [leavingTo, setLeavingTo] = useState<string | null>(null);
  useEffect(() => {
    if (!dirty) return;
    setLeaveGuard(setLeavingTo);
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => {
      setLeaveGuard(null);
      window.removeEventListener('beforeunload', warn);
    };
  }, [dirty]);
  /** Close the editor and go somewhere, without asking again. */
  const leave = (to?: string) => {
    setLeaveGuard(null);
    setDraft(null);
    if (to) go(to);
  };

  const save = async (to?: string) => {
    if (isNew && empty) return leave(to ?? '/');
    if (!hasTitle) return setNeedTitle(true); // Save needs a title: say so.
    // Your icon joins the entry's row right away; the online database confirms it on the next sync.
    const me = cloudUser()?.id;
    const contributors = me && !(draft.contributors ?? []).includes(me) ? [...(draft.contributors ?? []), me] : draft.contributors;
    const entry = { ...draft, contributors, updatedAt: Date.now() };
    await db.transaction('rw', db.entries, db.media, async () => {
      const kept = (id: string) => entry.mediaIds.includes(id);
      await db.media.bulkPut(pendingMedia.filter((m) => kept(m.id)).map((m) => (m.id in transcripts ? { ...m, transcript: transcripts[m.id] } : m)));
      for (const [id, transcript] of Object.entries(transcripts)) {
        // Saved as empty text (not removed) so other devices also clear a deleted one when they sync.
        if (kept(id) && !pendingMedia.some((m) => m.id === id)) await db.media.update(id, { transcript });
      }
      await db.media.bulkDelete(removed);
      await db.entries.put(entry);
    });
    // Highlight the journal the entry went into (unless "All journals" is showing, which includes it).
    if (current !== 'all' && current !== entry.journalId) setCurrent(entry.journalId);
    leave(to ?? (isNew ? `/entry/${entry.id}` : undefined));
  };

  // Ask first if there's something to lose; otherwise just close.
  const cancel = () => (dirty ? setConfirmCancel(true) : leave(isNew ? '/' : undefined));
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [needTitle, setNeedTitle] = useState(false);
  // The Title box stays outlined from "needs a title" until there is one.
  const [showTitleBox, setShowTitleBox] = useState(false);
  const goToTitle = () => {
    setNeedTitle(false);
    setShowTitleBox(true);
    titleRef.current?.focus();
    titleRef.current?.scrollIntoView({ block: 'center' });
  };

  // Photos and videos at the top; voice recordings further down (see below).
  const storedKinds = useLiveQuery(
    async () => Object.fromEntries((await db.media.bulkGet(draft.mediaIds)).filter((m) => !!m).map((m) => [m!.id, m!.kind])),
    [draft.mediaIds.join()]) as Record<string, MediaKind> | undefined;
  const isAudio = (m: string) => (pendingMedia.find((p) => p.id === m)?.kind ?? storedKinds?.[m]) === 'audio';
  // Wait for the stored ones' kinds so nothing jumps from one place to the other.
  const known = draft.mediaIds.filter((m) => storedKinds || pendingMedia.some((p) => p.id === m));
  const audioIds = known.filter(isAudio);
  const pictureIds = known.filter((m) => !isAudio(m));
  const mediaTile = (m: string, tile: { style: CSSProperties; onRatio: (r: number) => void }) => {
    const pending = pendingMedia.find((p) => p.id === m);
    const onRemove = async () => {
      const stored = pending ? undefined : await db.media.get(m);
      const kind = (pending ?? stored)?.kind;
      // The words outlive the recording: a transcript stays with the entry when its recording is deleted.
      const said = (transcripts[m] ?? (pending ?? stored)?.transcript ?? '').trim();
      const keep = kind === 'audio' && said && said !== '(No speech found in this recording.)' ? said : '';
      const what = !kind ? 'this item' : kind === 'audio' ? 'this voice recording' : kind === 'video' ? 'this video' : 'this photo';
      if (!(await askSure({
        message: `Delete ${what} from the entry?${keep ? ' Its transcript stays in the entry.' : ''}`,
        yes: `Yes, delete ${kind === 'audio' ? 'recording' : kind ?? 'item'}`,
      }))) return;
      const cur = draftRef.current;
      setDraft({ ...cur, mediaIds: cur.mediaIds.filter((x) => x !== m), ...(keep ? { transcripts: [...(cur.transcripts ?? []), keep] } : {}) });
      if (!pending) setRemoved((r) => [...r, m]);
    };
    return pending ? <PendingTile key={m} media={pending} onRemove={onRemove} {...tile} /> : <MediaTile key={m} id={m} onRemove={onRemove} {...tile} />;
  };
  // A new recording: bring it into view if it landed off screen.
  const audioRef = useRef<HTMLDivElement>(null);
  const audioCount = useRef(audioIds.length);
  useEffect(() => {
    if (audioIds.length > audioCount.current) audioRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    audioCount.current = audioIds.length;
  }, [audioIds.length]);

  const remove = async () => {
    if (!(await askSure({ message: 'Delete this entry, with its photos, videos and recordings?', yes: 'Yes, delete entry' }))) return;
    await deleteEntry(draft.id);
    leave('/');
  };

  return (
    <div className="entry-edit">
      <div className="entry-actions edit-actions">
        {/* Plain words, not a button: tells you you're writing (the area is tinted too, see .entry-edit). */}
        {/* On a phone, Cancel and Save live up here and stay put (a bar floating over the keyboard jumped around on iPhone). */}
        <button className="btn phone-only" onClick={cancel}>Cancel</button>
        <span className="edit-label">{isNew ? 'New entry' : 'Editing'}</span>
        <div className="row nowrap">
          {/* On a computer, Cancel and Save are in the bar at the bottom of the window; on a phone Delete is at the end of the entry. */}
          {!isNew && <button className="btn delete-btn computer-only" onClick={remove}>Delete</button>}
          <button className="btn primary phone-only" onClick={() => save()} disabled={!!busy || !!recorder || transcribing > 0}>Save</button>
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
          <Icon name="bulb" className="prompt-bulb" />
          <span className="grow">{PROMPTS[promptIdx]}</span>
          <button className="round-btn" title="Use this idea" aria-label="Use this idea" onClick={() => set({ prompt: PROMPTS[promptIdx] })}>✓</button>
          <button className="round-btn" title="Show another idea" aria-label="Show another idea" onClick={() => setPromptIdx((promptIdx + 1) % PROMPTS.length)}>↻</button>
        </div>
      )}

      {pictureIds.length > 0 && (
        <Gallery ids={pictureIds} className="media-gallery" rowHeight={180} maxHeight={360}>
          {(m, _i, tile) => mediaTile(m, tile)}
        </Gallery>
      )}

      <textarea ref={titleRef} className={`title-input ${showTitleBox && !hasTitle ? 'needs-title' : ''}`} placeholder="Title" rows={1} value={draft.title}
        autoFocus={isNew}
        onChange={(e) => set({ title: e.target.value.replace(/\s*\n\s*/g, ' ') })}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); bodyRef.current?.focus(); } }} />
      <textarea ref={bodyRef} className="body-input" placeholder="Start writing…" value={draft.body}
        onChange={(e) => set({ body: e.target.value })} />

      {/* Voice recordings sit under the writing, next to the Record button, so a new one shows where you tapped. */}
      {(audioIds.length > 0 || !!draft.transcripts?.length) && (
        <div className="edit-audio" ref={audioRef}>
          {draft.transcripts?.map((t, i) => (
            <KeptTranscript key={i} text={t}
              onDelete={() => { const cur = draftRef.current; setDraft({ ...cur, transcripts: cur.transcripts?.filter((_x, k) => k !== i) }); }}
              onAddToEntry={(text) => { const body = draftRef.current.body.trimEnd(); setDraft({ ...draftRef.current, body: body ? `${body}\n\n${text}` : text }); }} />
          ))}
          {audioIds.map((m) => (
            <div key={m}>
              <Gallery ids={[m]} className="media-gallery">{(id, _i, tile) => mediaTile(id, tile)}</Gallery>
              <EditTranscript id={m} pending={pendingMedia.find((p) => p.id === m)} value={transcripts[m]}
                onChange={(t) => setTranscripts((all) => ({ ...all, [m]: t }))}
                onBusy={(b) => setTranscribing((n) => n + (b ? 1 : -1))}
                onAddToEntry={(t) => {
                  const body = draftRef.current.body.trimEnd();
                  setDraft({ ...draftRef.current, body: body ? `${body}\n\n${t}` : t });
                }} />
            </div>
          ))}
        </div>
      )}

      <div className="edit-tools">
        <input ref={fileRef} type="file" accept="image/*,video/*,audio/*,.heic,.heif" multiple hidden onChange={(e) => addFiles(e.target.files)} />
        {/* Icons only, to save room. Hover (on a computer) shows what each one does. */}
        <div className="tool-row">
          <button className="icon-btn" onClick={() => fileRef.current?.click()} title="Add photos & videos" aria-label="Add photos & videos"><Icon name="photo" /></button>
          <button className="icon-btn" onClick={pastePhoto} title="Paste a copied photo (or press Ctrl+V)" aria-label="Paste a copied photo"><Icon name="paste" /></button>
          <button className={`icon-btn ${recorder ? 'recording' : ''}`} onClick={toggleRecording}
            title={recorder ? 'Stop recording' : 'Record your voice'} aria-label={recorder ? 'Stop recording' : 'Record your voice'}>
            <Icon name={recorder ? 'stop' : 'mic'} />
          </button>
          <PlaceInput value={draft.place} onChange={(place) => set({ place })} />
          <button className="icon-btn" onClick={useLocation} title="Use my location" aria-label="Use my location"><Icon name="locate" /></button>
        </div>
      </div>
      <div className="moods">
        <span className="muted moods-label">How are you feeling?</span>
        {MOODS.map((m) => (
          <button key={m.id} className={`mood ${draft.mood === m.id ? 'on' : ''}`} title={m.label}
            onClick={() => set({ mood: draft.mood === m.id ? undefined : m.id })}>{m.emoji}</button>
        ))}
      </div>
      {busy && <p className="muted">{busy}</p>}
      <p className="muted small">{fmtDay(draft.date)} at {fmtTime(draft.date)} · {wordCount(draft.body)} words</p>
      {!isNew && <button className="btn delete-btn phone-only end-delete" onClick={remove}>Delete</button>}
      {/* Computer: Cancel and Save stick to the bottom of the window. */}
      <div className="edit-bar">
        <button className="btn" onClick={cancel}>Cancel</button>
        <button className="btn primary" onClick={() => save()} disabled={!!busy || !!recorder || transcribing > 0}>Save</button>
      </div>
      {needTitle && (
        <Dialog title="This entry needs a title" onClose={goToTitle}>
          <p className="muted">This entry needs a title before it can be saved. Type one in the Title box, then select Save.</p>
          <div className="row"><button className="btn primary" onClick={goToTitle}>OK</button></div>
        </Dialog>
      )}
      {confirmCancel && (
        <Dialog title="Throw away your changes?" onClose={() => setConfirmCancel(false)}>
          <p className="muted">{isNew ? "This new entry hasn't been saved. If you cancel, it will be lost." : "Your changes to this entry haven't been saved. If you cancel, they will be lost."}</p>
          <div className="row">
            <button className="btn danger" onClick={() => leave(isNew ? '/' : undefined)}>Throw away</button>
            <button className="btn ghost" onClick={() => setConfirmCancel(false)}>Keep editing</button>
          </div>
        </Dialog>
      )}
      {pasteBox && (
        <Dialog title="Paste a photo" onClose={() => setPasteBox(false)}>
          <p className="muted">First copy a photo. In the Photos app, open it, tap <strong>Share</strong>, then <strong>Copy Photo</strong>. Then come back here.</p>
          <div className="paste-box" contentEditable autoFocus role="textbox" aria-label="Paste a photo here"
            data-placeholder="Tap and hold here, then tap Paste. On a computer, click here and press Ctrl+V."
            onInput={(e) => { e.currentTarget.textContent = ''; }} />
          {busy && <p className="muted">{busy}</p>}
        </Dialog>
      )}
      {leavingTo != null && (
        <Dialog title={isNew ? 'Save this entry?' : 'Save your changes?'} onClose={() => setLeavingTo(null)}>
          <p className="muted">{isNew ? 'You have not saved this new entry yet.' : 'You have changes to this entry that are not saved yet.'}
            {!hasTitle && ' To save it, give it a title first.'}</p>
          <div className="row">
            {hasTitle && <button className="btn primary" onClick={() => save(leavingTo)} disabled={!!busy || !!recorder || transcribing > 0}>Save</button>}
            <button className="btn danger" onClick={() => leave(leavingTo)}>Discard</button>
            <button className="btn ghost" onClick={() => setLeavingTo(null)}>Keep writing</button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function JournalPicker({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const journals = useWritableJournals();
  const label = useJournalLabel();
  if (!journals || journals.length < 2) return null;
  const j = journals.find((x) => x.id === value);
  return (
    <label className="journal-picker">
      <JournalMark journal={j} />
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Journal">
        {(() => {
          const { mine, shared, system } = splitJournals(journals);
          const opts = (list: typeof journals) => list.map((x) => <option key={x.id} value={x.id}>{label(x)}</option>);
          return shared.length || system.length
            ? <><optgroup label="My journals">{opts(mine)}</optgroup>
              {shared.length > 0 && <optgroup label="Shared with me">{opts(shared)}</optgroup>}
              {system.length > 0 && <optgroup label="System journals">{opts(system)}</optgroup>}</>
            : opts(mine);
        })()}
      </select>
    </label>
  );
}
