import { InstallSteps } from './Install';
import { useState } from 'react';
import { AboutBox } from './About';
import { goAndStartTour } from './Tour';

const TOPICS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How do I write a new entry?',
    a: <>Click <strong>＋ New entry</strong> (or press Ctrl+N). Give it a title if you like, write, and click <strong>Done</strong>. You can add photos and videos (or paste a photo you copied: press Ctrl+V, or tap <strong>📋 Paste photo</strong>), record your voice, set a place and pick a mood. If you leave without saving, the app asks first.</>,
  },
  {
    q: 'How do I change or delete an entry?',
    a: <>Click the entry to open it, then click <strong>Edit</strong>. <strong>Delete</strong> is at the top, next to Done.</>,
  },
  {
    q: 'How do journals work?',
    a: <>You can keep several journals, like Travel or Family. Click <strong>＋ New journal</strong> in the left bar to add one, and click a journal to open it. The app remembers the last journal you were in and opens it the next time you start. Rename, recolor or delete journals in <strong>Settings</strong>.</>,
  },
  {
    q: 'How do I find an old entry?',
    a: <>On the <strong>Journal</strong> page, type in the search box at the top, or use the filters (photos, bookmarks and so on). The <strong>Calendar</strong> shows which days you wrote on, and <strong>Insights</strong> shows "On this day" memories from past years.</>,
  },
  {
    q: 'How do I bring in my entries from Apple Journal?',
    a: <>On your iPhone, open Journal, tap ⋯ → Settings → Export Journal, and save it to iCloud Drive so you can get it on this computer. Then open <strong>Import</strong> here and drop the .zip file in. The Import page has step-by-step instructions too. Entries you already have are skipped, so importing twice is safe.</>,
  },
  {
    q: 'My iPhone videos will not play.',
    a: <>iPhone videos use a format called HEVC. On Windows, install the free <strong>HEVC Video Extensions</strong> from the Microsoft Store, then reopen the app.</>,
  },
  {
    q: 'Why should I sign in?',
    a: <>Signed in, your journal is saved online too. It shows up on your other computers and your phone, and you can share entries or whole journals. Without an account, everything still works, but it only lives on this computer.</>,
  },
  {
    q: 'What does "Keep me signed in" do?',
    a: <>When it is ticked, the app stays signed in until you choose <strong>Sign out</strong>. When it is not ticked, you are signed out when you close the app, which is handy on a shared computer.</>,
  },
  {
    q: 'How do I share?',
    a: <>To share one entry, open it and click <strong>🔗 Share</strong> to get a private link. To share a whole journal, go to <strong>Settings → Share a journal</strong> and type the other person's email. The app doesn't email them, so click <strong>Send with Gmail</strong> next to their name to send them a note (or <strong>Copy invite</strong> to paste it into a text or another email). They sign in with that same email address and the journal shows up. You need to be signed in for both.</>,
  },
  {
    q: 'How do I keep a backup?',
    a: <>Go to <strong>Settings → Backup</strong> and click <strong>Download backup</strong>. Keep the file somewhere safe, like OneDrive. On iPhone or iPad, the phone then shows the file instead of saving it: ignore any "Open in…" app it suggests, tap <strong>More…</strong>, then <strong>Save to Files</strong>, and pick a folder such as iCloud Drive. <strong>Restore from backup</strong> brings it back.</>,
  },
  {
    q: 'Can I lock the journal?',
    a: <>Yes. In <strong>Settings → Lock</strong>, set a passcode. The journal asks for it each time it opens.</>,
  },
  {
    q: 'How do I install it like a normal app (Windows, Mac, iPhone or Android)?',
    a: <InstallSteps />,
  },
];

/** #/help */
export function Help() {
  const [about, setAbout] = useState(false);
  return (
    <div className="settings help">
      <h1>Help</h1>
      <section className="card pad help-tour">
        <div className="grow">
          <h3>New here?</h3>
          <p className="muted">Take a one-minute guided tour of the app.</p>
        </div>
        <button className="btn primary" onClick={goAndStartTour}>Start the tour</button>
      </section>
      <section className="card pad">
        <h3>Questions and answers</h3>
        {TOPICS.map((t) => (
          <details key={t.q} className="faq">
            <summary>{t.q}</summary>
            <p>{t.a}</p>
          </details>
        ))}
      </section>
      <p className="center">
        <button className="link" onClick={() => setAbout(true)}>About Paul Remembers</button>
      </p>
      {about && <AboutBox onClose={() => setAbout(false)} />}
    </div>
  );
}
