import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { download, exportBackup } from '../backup';
import { eraseJournalsLocal, signOut, syncSoon, useCloud } from '../cloud/cloud';
import { resetSync } from '../cloud/sync';
import { db, deleteJournalsAndEntries, isOwnJournal, setSetting, type Journal } from '../db';
import { useJournals } from '../journals';
import { Dialog } from './Sharing';

type Action = 'erase' | 'delete';

/**
 * Settings → Erase or delete.
 * - Erase takes journals off this computer only. When signed in, the copy in
 *   the account stays, so nothing is lost.
 * - Delete (signed in only) removes your journals for good: from this
 *   computer, from your account online, and for anyone you shared them with.
 * Both offer a backup first.
 */
export function EraseCard() {
  const cloud = useCloud();
  const journals = useJournals();
  const counts = useLiveQuery(async () => {
    const m = new Map<string, number>();
    await db.entries.each((e) => m.set(e.journalId, (m.get(e.journalId) ?? 0) + 1));
    return m;
  }, []);
  const [choice, setChoice] = useState<'all' | string>('all');
  const [action, setAction] = useState<Action | null>(null);
  if (!journals) return null;

  const signedIn = !!cloud.user;
  const all = choice === 'all';
  const picked = all ? journals : journals.filter((j) => j.id === choice);
  const one = all ? undefined : picked[0];
  const ownPicked = picked.filter(isOwnJournal);
  const sharedPicked = picked.filter((j) => !isOwnJournal(j));

  // Signed in, this computer always keeps a copy of your journals, so taking
  // one journal off it is not possible; erasing everything signs you out.
  const canErase = !signedIn || all;
  const canDelete = signedIn && ownPicked.length > 0;

  return (
    <section className="card pad">
      <h3>Erase or delete</h3>
      <p className="muted">
        {signedIn
          ? <><strong>Erase</strong> takes journals off this computer only; your account keeps its copy online. <strong>Delete</strong> removes journals for good: from this computer, from your account, and for anyone you shared them with.</>
          : <>You are not signed in, so your journals are only on this computer. <strong>Erase</strong> removes them from this computer. To keep a copy, download a backup first (you will be asked).</>}
      </p>
      <div className="row">
        <select className="text-input" value={choice} onChange={(e) => setChoice(e.target.value)} aria-label="Which journal">
          <option value="all">All journals</option>
          {journals.map((j) => <option key={j.id} value={j.id}>{j.name}{isOwnJournal(j) ? '' : ' (shared with you)'}</option>)}
        </select>
        {canErase && <button className="btn ghost danger" onClick={() => setAction('erase')}>{signedIn ? 'Erase from this computer' : 'Erase'}</button>}
        {canDelete && <button className="btn danger" onClick={() => setAction('delete')}>Delete for good</button>}
      </div>
      {signedIn && !all && (
        <p className="muted small">
          {one && !isOwnJournal(one)
            ? <>Only {one.ownerEmail ?? 'the owner'} can delete this journal, because it is theirs. </>
            : null}
          While you are signed in, this computer keeps a copy of all your journals. To take them off this computer, choose <strong>All journals</strong> and Erase (this also signs you out).
        </p>
      )}
      {action && (
        <ConfirmDialog
          action={action}
          signedIn={signedIn}
          all={all}
          journals={action === 'delete' ? ownPicked : picked}
          skipped={action === 'delete' ? sharedPicked : []}
          entries={(action === 'delete' ? ownPicked : picked).reduce((n, j) => n + (counts?.get(j.id) ?? 0), 0)}
          onClose={() => setAction(null)}
          onDone={() => (setAction(null), setChoice('all'))}
        />
      )}
    </section>
  );
}

function ConfirmDialog({ action, signedIn, all, journals, skipped, entries, onClose, onDone }: {
  action: Action;
  signedIn: boolean;
  all: boolean;
  journals: Journal[];
  skipped: Journal[];
  entries: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const what = all ? (action === 'delete' && skipped.length ? 'all your own journals' : 'all journals') : `"${journals[0]?.name}"`;
  const n = `${entries} ${entries === 1 ? 'entry' : 'entries'}`;

  const backup = async () => {
    setBusy(true);
    try {
      const blob = await exportBackup(all ? undefined : journals.map((j) => j.id));
      const name = all ? 'journal-backup' : `journal-backup-${journals[0].name.replace(/[^\w-]+/g, '-')}`;
      download(blob, `${name}-${new Date().toISOString().slice(0, 10)}.zip`);
      if (all) await setSetting('lastBackup', Date.now());
      setBackedUp(true);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const go = async () => {
    setBusy(true);
    try {
      if (action === 'delete') {
        await deleteJournalsAndEntries(journals.map((j) => j.id));
        syncSoon(0);
        onDone();
      } else if (all && signedIn) {
        await signOut(false);
        location.reload();
      } else if (all) {
        await resetSync();
        await db.delete();
        location.reload();
      } else {
        await eraseJournalsLocal(journals.map((j) => j.id));
        onDone();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const title = action === 'delete' ? `Delete ${what} for good?` : `Erase ${what} from this computer?`;
  return (
    <Dialog title={title} onClose={onClose}>
      <p>
        {action === 'delete'
          ? <>This deletes {n} with their photos and recordings from this computer, from your account online, from your other devices, and for anyone the journal is shared with. It cannot be undone.</>
          : signedIn
            ? <>This removes {n} from this computer and signs you out. Your account keeps everything online, and it all downloads again when you sign in here.</>
            : <>This removes {n} from this computer. You are not signed in, so this is the only copy: without a backup, they are gone for good.</>}
      </p>
      {skipped.length > 0 && <p className="muted small">Journals others shared with you ({skipped.map((j) => j.name).join(', ')}) are not deleted. Only their owner can do that.</p>}
      <p className="muted small"><strong>Step 1:</strong> download a backup, so you can bring {all ? 'them' : 'it'} back later with Restore from backup.</p>
      <div className="row">
        <button className={`btn ${backedUp ? '' : 'primary'}`} disabled={busy} onClick={backup}>{backedUp ? '✓ Backup downloaded' : 'Download backup'}</button>
      </div>
      <p className="muted small"><strong>Step 2:</strong> {action === 'delete' ? 'delete' : 'erase'} when you are ready.</p>
      <div className="row">
        <button className="btn danger" disabled={busy} onClick={go}>
          {busy ? 'Working…' : `${action === 'delete' ? 'Delete' : 'Erase'}${backedUp ? ' now' : ' without a backup'}`}
        </button>
        <button className="btn ghost" disabled={busy} onClick={onClose}>Cancel</button>
      </div>
      {msg && <p className="small">{msg}</p>}
    </Dialog>
  );
}
