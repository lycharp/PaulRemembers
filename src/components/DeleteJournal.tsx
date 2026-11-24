import { useState } from 'react';
import { accountLabel, backupFileName, buildBackup, saveBackup } from '../backup';
import { addLog } from '../autoBackup';
import { syncSoon, useCloud } from '../cloud/cloud';
import { clearShares } from '../cloud/sharing';
import { usePeople } from '../cloud/people';
import { db, deleteJournal, deleteJournalsAndEntries, isSystemJournal, orphansJournal, ORPHANS_NAME, type Journal } from '../db';
import { Dialog } from './Sharing';
import { IosSaveTip } from './IosSaveTip';

type Choice = 'move' | 'orphans' | 'delete';

/**
 * Settings → Journals → Delete. Step 1 asks what happens to the journal's
 * entries: move them to a journal you pick, move them to "Orphaned Entries"
 * (made the first time it's needed), or delete them completely. Step 2 is the
 * "Are you sure? This cannot be undone." check (with a backup offer when the
 * entries are being deleted). An empty journal goes straight to step 2.
 */
export function DeleteJournalDialog({ journal, journals, entries, onClose }: {
  journal: Journal;
  /** Your own journals (the ones entries can move to). */
  journals: Journal[];
  entries: number;
  onClose: () => void;
}) {
  const cloud = useCloud();
  const { sharedByMe } = usePeople();
  const signedIn = !!cloud.user;
  const targets = journals.filter((j) => j.id !== journal.id && !isSystemJournal(j));
  const canOrphan = !isSystemJournal(journal);
  const [choice, setChoice] = useState<Choice>(targets.length ? 'move' : canOrphan ? 'orphans' : 'delete');
  const [moveTo, setMoveTo] = useState(targets[0]?.id ?? '');
  const [step, setStep] = useState<'choose' | 'sure'>(entries ? 'choose' : 'sure');
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const name = `“${journal.name}”`;
  const n = `${entries} ${entries === 1 ? 'entry' : 'entries'}`;
  const targetName = choice === 'orphans' ? ORPHANS_NAME : targets.find((j) => j.id === moveTo)?.name ?? '';
  const shared = sharedByMe(journal);
  const deleting = entries > 0 && choice === 'delete';

  const backup = async () => {
    setBusy(true);
    setMsg('');
    try {
      const { saved, backup: b } = await saveBackup(() => buildBackup([journal.id]), backupFileName(journal.name));
      if (!saved || !b) return; // cancelled
      await addLog({ at: Date.now(), kind: 'manual', ok: true, account: accountLabel(), entries: b.entries, bytes: b.blob.size, file: saved.file, where: saved.where });
      setBackedUp(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const go = async () => {
    setBusy(true);
    setMsg('');
    try {
      const entryIds = deleting ? await db.entries.where('journalId').equals(journal.id).primaryKeys() : [];
      // Stop sharing first, so a journal later restored from a backup starts out private.
      if (signedIn) {
        try {
          await clearShares([journal.id], entryIds);
        } catch {
          throw new Error('Could not reach your account to stop sharing this journal, so nothing was deleted. Check your internet connection and try again.');
        }
      }
      if (!entries || deleting) await deleteJournalsAndEntries([journal.id]);
      else await deleteJournal(journal.id, choice === 'orphans' ? (await orphansJournal()).id : moveTo);
      syncSoon(0);
      onClose();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  if (step === 'choose') {
    return (
      <Dialog title={`Delete the journal ${name}?`} onClose={onClose}>
        <p>{name} has {n}. What should happen to {entries === 1 ? 'it' : 'them'}?</p>
        <div className="delete-choices">
          {targets.length > 0 && (
            <label className="row nowrap">
              <input type="radio" name="del-choice" checked={choice === 'move'} onChange={() => setChoice('move')} />
              <span>Move {entries === 1 ? 'it' : 'them'} to</span>
              <select className="text-input small-select" value={moveTo} aria-label="Journal to move them to"
                onChange={(e) => { setMoveTo(e.target.value); setChoice('move'); }}>
                {targets.map((j) => <option key={j.id} value={j.id}>{j.name}</option>)}
              </select>
            </label>
          )}
          {canOrphan && (
            <label className="row nowrap">
              <input type="radio" name="del-choice" checked={choice === 'orphans'} onChange={() => setChoice('orphans')} />
              <span>Move {entries === 1 ? 'it' : 'them'} to “{ORPHANS_NAME}”</span>
            </label>
          )}
          <label className="row nowrap">
            <input type="radio" name="del-choice" checked={choice === 'delete'} onChange={() => setChoice('delete')} />
            <span>Delete {entries === 1 ? 'it' : 'them'} completely, with {entries === 1 ? 'its' : 'their'} photos and recordings</span>
          </label>
        </div>
        <div className="row">
          <button className="btn danger" onClick={() => setStep('sure')}>Delete journal…</button>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Are you sure?" onClose={onClose}>
      <div className="sure-text">
        {!entries ? (
          <p>The empty journal {name} will be deleted.</p>
        ) : deleting ? (
          <p>The journal {name} and {entries === 1 ? 'its entry' : `all ${n}`}, with photos and recordings, will be deleted{signedIn ? ' from this device, your account online, your other devices, and for anyone it is shared with' : ' from this device'}.</p>
        ) : (
          <p>The journal {name} will be deleted. Its {n} will move to “{targetName}”.{shared && ' People you shared it with will no longer see them.'}</p>
        )}
        <p><strong>This cannot be undone.</strong></p>
      </div>
      {deleting && (
        <>
          <p className="muted small"><strong>Step 1:</strong> download a backup, so you can bring it back later with Restore from backup.</p>
          <div className="row">
            <button className={`btn ${backedUp ? '' : 'primary'}`} disabled={busy} onClick={backup}>{backedUp ? '✓ Backup downloaded' : 'Download backup'}</button>
          </div>
          <IosSaveTip after={backedUp} />
          <p className="muted small"><strong>Step 2:</strong> delete when you are ready.</p>
        </>
      )}
      <div className="row">
        <button className="btn delete-btn" disabled={busy} onClick={go}>
          {busy ? 'Working…' : deleting ? `Yes, delete ${backedUp ? 'now' : 'without a backup'}` : `Yes, delete ${name}`}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </Dialog>
  );
}
