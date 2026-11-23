import { InstallSteps } from './Install';
import { useState } from 'react';
import { AboutBox } from './About';
import { goAndStartTour } from './Tour';

const TOPICS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'How do I write a new entry?',
    a: <>Click <strong>＋ New entry</strong> (or press Ctrl+N). Give it a title, write, and click <strong>Save</strong> (it stays at the bottom of the screen, and shows once there's a title). You can add photos and videos (or paste a photo you copied: press Ctrl+V, or use the paste button), record your voice, set a place (the arrow button fills in where you are) and pick a mood. Hold the pointer over a button to see what it does. If you leave without saving, the app asks first.</>,
  },
  {
    q: 'How do I change or delete an entry?',
    a: <>Click the entry to open it, then click <strong>Edit</strong>. <strong>Delete</strong> is at the top; Cancel and Save are at the bottom.</>,
  },
  {
    q: 'How do journals work?',
    a: <>You can keep several journals, like Travel or Family. Click <strong>＋ New journal</strong> in the left bar to add one, and click a journal to open it. The app remembers the last journal you were in and opens it the next time you start. Rename, recolor or delete journals in <strong>Settings</strong>. When you delete a journal, you choose what happens to its entries: move them to another journal, move them to <strong>Orphaned Entries</strong>, or delete them completely. Orphaned Entries appears at the bottom of the journal list, under System journals, only once something has been moved there.</>,
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
    q: 'Why do I have to sign in?',
    a: <>Signed in, your journal is saved online. It shows up on your other computers and your phone, and you can share entries or whole journals. Paul Remembers is invite-only: you need to be signed in to use it, and you can create an account only with an email address Paul has invited, using the link in your invite email. To request an invite, email PoquitoWare@gmail.com.</>,
  },
  {
    q: 'What does "Keep me signed in" do?',
    a: <>When it is selected, the app stays signed in until you choose <strong>Sign out</strong>. When it is not selected, you are signed out when you close the app, which is handy on a shared computer.</>,
  },
  {
    q: 'How do I share?',
    a: <>To share one entry, open it and click the <strong>Share</strong> button (the box with an arrow) to get a private link. To share a whole journal, go to <strong>Settings → Share a journal</strong> and type the other person's email, choose <strong>Can read</strong> or <strong>Can edit</strong>, and click <strong>Share</strong>. The app emails them an invite straight away, from invites@poquitoware.com. You get a copy in your own email, and if they reply, it comes to you. To send it again later, click <strong>Send invite</strong> next to their name. If an invite can't be sent, a box offers to open it in Gmail, Outlook.com, Yahoo Mail or your email app for you to send, or to copy it. To change what someone can do, change <strong>Can read / Can edit</strong> next to their name; there's no need to remove them first. They sign in with that same email address and the journal shows up. You can share only with people who already use Paul Remembers. For someone new, press <strong>Ask Paul to invite them</strong>: their name shows <strong>Waiting for Paul</strong>, and once he approves, the journal is shared with them (or it shows <strong>Declined</strong>). You need to be signed in for both.</>,
  },
  {
    q: 'What are the little icons on entries?',
    a: <>In a shared journal, each entry shows the icon of everyone who wrote or changed it, in the order they joined in: whoever wrote it first, then each new person who edited it. Hover over an icon (or tap it on a phone) to see the name. Pick your own name and icon in <strong>Settings → Your name and icon</strong>. Your private journals don't show icons.</>,
  },
  {
    q: 'How do I keep a backup?',
    a: <>Go to <strong>Settings → Backup</strong> and click <strong>Download backup</strong>. In Edge or Chrome a <strong>Save as</strong> window lets you pick the folder (it opens in the one you used last). Keep the file somewhere safe, like OneDrive. The file name shows which account it's from. Journals other people shared with you aren't included: they stay safe in their owner's account. On iPhone or iPad, the phone then shows the file instead of saving it: ignore any "Open in…" app it suggests, tap <strong>More…</strong>, then <strong>Save to Files</strong>, and pick a folder such as iCloud Drive. <strong>Restore from backup</strong> brings it back: you select which journals to restore, and (if you're signed in) who to share them with again. Entries that are already in the app are left as they are. We suggest a backup at least once a week: if a device goes 7 days without one, a bar reminds you (<strong>Later</strong> hides it for a day).</>,
  },
  {
    q: 'Can it back up by itself every day?',
    a: <>Yes. In <strong>Settings → Backup</strong>, select <strong>Back up every day</strong> and pick a time. In Edge or Chrome on a computer, choose a folder once (a OneDrive folder is best) and each day's backup saves there by itself; the newest 7 are kept. On iPhone, iPad and other browsers, a bar asks you to tap <strong>Save</strong>. iPhone and iPad can’t delete old backups by themselves, so each day’s file is named by the day of the week (like “…daily backup - Monday.zip”). Save it in the same folder each time and tap <strong>Replace</strong> when asked: that keeps the last 7 days. You can also delete old backups yourself in the Files app. The app has to be open: if it's closed at backup time, it backs up the next time you open it. The <strong>Backup log</strong> shows the last 7 backups.</>,
  },
  {
    q: 'I can’t find my backup file on my iPhone.',
    a: <>Your backups are in Apple’s <strong>Files</strong> app, not in Paul Remembers. Backup file names are long, so Files cuts them short in the icon view. Open the Files app, go to the folder you saved to (such as iCloud Drive), tap <strong>⋯</strong> at the top right of the Files app, and select <strong>List</strong>. Now you can see each file’s whole name and the date it was saved, with the newest easy to spot. To restore one, go to <strong>Settings → Backup</strong>, tap <strong>Restore from backup</strong>, and pick it the same way.</>,
  },
  {
    q: 'Can I lock the journal?',
    a: <>Yes. In <strong>Settings → Lock</strong>, set a passcode. Paul Remembers then asks for it each time it opens on that device. It covers all your journals, and it’s set separately on each device. People you share a journal with never need it.</>,
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
