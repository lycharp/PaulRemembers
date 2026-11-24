# Decisions

This file records Paul's decisions for Paul Remembers: how we work, what the app does and why, and the ideas we said no to.

**Keep it up to date.** Every pull request that makes or changes a decision adds a row here, with the date and the PR link. If a decision is reversed, keep the old row and add a new one that says so.

PR links go to https://github.com/lycharp/PaulRemembers/pull/NUMBER.

## Standing rules (how we work)

| Rule | Since | Where it came from |
|---|---|---|
| Agree a short, plain plan with Paul before any code is written. Investigation is fine without asking. | 2026-11-09 | [#25](https://github.com/lycharp/PaulRemembers/pull/25) |
| Say "select", never "tick", in the app, Help, PR descriptions and messages. | 2026-11-10 | [#29](https://github.com/lycharp/PaulRemembers/pull/29) |
| Never say the app backs up your data for you. People make their own backups. | 2026-11 | Project chat |
| Combine related changes into fewer pull requests. | 2026-11-16 | Project chat |
| Merge with GitHub's normal "Merge pull request" button (not squash or rebase), because the version number counts merge commits. | 2026-11-10 | [#31](https://github.com/lycharp/PaulRemembers/pull/31) |
| Version numbers: each merged PR adds .1. A big change starts a new number: 2.0 = #44, 3.0 = #56, 4.0 = #67. About shows the version and its date. Before 2.0 the version was "1." plus the latest PR number. | 2026-11-16 | [#45](https://github.com/lycharp/PaulRemembers/pull/45) |
| Before each new major version, save main as a branch (`v2`, `v3`) and keep it. | 2026-11-17 | [#56](https://github.com/lycharp/PaulRemembers/pull/56), [#67](https://github.com/lycharp/PaulRemembers/pull/67) |
| Paul's own journal export and entries are private and are never committed to the repo. | 2026-11-01 | [#1](https://github.com/lycharp/PaulRemembers/pull/1) |
| Paul runs `supabase/setup.sql` himself in the Supabase SQL Editor after any PR that changes it. | 2026-11-02 | [#3](https://github.com/lycharp/PaulRemembers/pull/3) |
| Every PR that makes or changes a decision adds a row to this file. | 2026-11-24 | This file |

## Product decisions

Newest first.

| Date | Decision | PR |
|---|---|---|
| 2026-11-24 | Every delete or remove asks "Are you sure? This cannot be undone." in the app's own pop-up. Remove admin and Block skip the "cannot be undone" line, because they can be undone. | [#72](https://github.com/lycharp/PaulRemembers/pull/72) |
| 2026-11-24 | Deleting a journal: first choose to move its entries to another journal, move them to "Orphaned Entries", or delete them completely. "Orphaned Entries" is made only when needed and is listed last under "System journals". | [#72](https://github.com/lycharp/PaulRemembers/pull/72) |
| 2026-11-24 | The × on a photo, video or recording while editing also asks first. Deleting a recording keeps its transcript. | [#72](https://github.com/lycharp/PaulRemembers/pull/72) |
| 2026-11-24 | Emoji reactions ❤️ 😂 😮 😢 👍 👎, in shared journals only, for anyone who can read or edit. Select again to take yours off. Hover or press and hold to see who reacted. Counts show on journal cards. | [#71](https://github.com/lycharp/PaulRemembers/pull/71) |
| 2026-11-24 | Upgrade Supabase to Pro ($25 a month) before inviting about 10 people. Keep the Spend Cap on. Pro never pauses, so the "keep awake" job from #17 is no longer needed (it does no harm). | Project chat |
| 2026-11-22 | The welcome page shows the Paul Remembers video (widescreen on computers, tall on phones). | [#69](https://github.com/lycharp/PaulRemembers/pull/69) |
| 2026-11-20 | Never show a blank screen while opening. Refresh after an update returns to the same page. | [#68](https://github.com/lycharp/PaulRemembers/pull/68) |
| 2026-11-20 | Version 4.0: the app sends invite emails itself, from "Paul Remembers &lt;invites@poquitoware.com&gt;" (via Resend). The sender gets a copy and replies go to them. Limit of 20 invites a day per person. If sending fails, the old Gmail / Outlook / Yahoo / Copy choices show. | [#67](https://github.com/lycharp/PaulRemembers/pull/67) |
| 2026-11-20 | The passcode lock covers the whole app on that device. It keeps casual eyes out and does not encrypt. People you share with never need it. | [#66](https://github.com/lycharp/PaulRemembers/pull/66) |
| 2026-11-20 | Shared entry links show the Paul Remembers name, who shared it, and how to ask to join (email poquitoware@gmail.com with your name and location). | [#65](https://github.com/lycharp/PaulRemembers/pull/65), [#66](https://github.com/lycharp/PaulRemembers/pull/66) |
| 2026-11-19 | An entry needs a title before it can be saved. Cancel asks "Throw away your changes?" only when something changed. | [#63](https://github.com/lycharp/PaulRemembers/pull/63), [#64](https://github.com/lycharp/PaulRemembers/pull/64) |
| 2026-11-19 | "Done" is called "Save" in the editor. | [#63](https://github.com/lycharp/PaulRemembers/pull/63) |
| 2026-11-19 | No + or New entry on journals you can only read. Can read / Can edit can be changed for each person after sharing. | [#63](https://github.com/lycharp/PaulRemembers/pull/63) |
| 2026-11-19 | Journals you've shared out get the shared sign and a "Shared with …" line. The left side can be dragged wider on a computer. | [#64](https://github.com/lycharp/PaulRemembers/pull/64) |
| 2026-11-19 | Look C: soft lavender colours, and a white page with a thick purple border and an EDITING strip while writing. Settings → Appearance: Automatic, Light or Dark, saved on each device. | [#62](https://github.com/lycharp/PaulRemembers/pull/62) |
| 2026-11-18 | Journals are grouped as "My journals" then "Shared with me", and shared journals get a two-people sign. On iPhone, a "Journals ▾" button opens a list from the bottom. | [#61](https://github.com/lycharp/PaulRemembers/pull/61) |
| 2026-11-18 | Shared journals show the owner's name in front, like "Sam · My Journal". The share email is shorter for people who already have an account. | [#60](https://github.com/lycharp/PaulRemembers/pull/60) |
| 2026-11-18 | Admin page for admins only. It shows counts and dates only, never what anyone wrote. Block pauses an account and deletes nothing. There is no account deletion. You can't remove your own admin rights. | [#59](https://github.com/lycharp/PaulRemembers/pull/59) |
| 2026-11-18 | Others can share only with people already in the app. Otherwise they "Ask Paul to invite them", and Paul approves or declines on the Admin page. People who are shared a journal may also make their own journals. | [#59](https://github.com/lycharp/PaulRemembers/pull/59) |
| 2026-11-18 | To request an invite, people email PoquitoWare@gmail.com. | [#59](https://github.com/lycharp/PaulRemembers/pull/59) |
| 2026-11-18 | Everyone must pick a name and an icon before using the app. | [#58](https://github.com/lycharp/PaulRemembers/pull/58) |
| 2026-11-18 | Show a progress bar while syncing, and download photos and videos 4 at a time. | [#57](https://github.com/lycharp/PaulRemembers/pull/57) |
| 2026-11-17 | Version 3.0: show who wrote what in shared journals, with each person's name and icon on entries. Bookmarking doesn't count. Private journals show nothing. | [#56](https://github.com/lycharp/PaulRemembers/pull/56) |
| 2026-11-17 | Move the app to paulremembers.poquitoware.com, because Google won't accept a github.io home page. The app still works at the old address too. | [#52](https://github.com/lycharp/PaulRemembers/pull/52) |
| 2026-11-17 | The tour includes "Put it on your Home Screen" on iPhone and iPad. | [#54](https://github.com/lycharp/PaulRemembers/pull/54), [#55](https://github.com/lycharp/PaulRemembers/pull/55) |
| 2026-11-16 | Signed out, the app opens on the public welcome page, with a Sign in button and a splash screen. | [#51](https://github.com/lycharp/PaulRemembers/pull/51) |
| 2026-11-16 | Remove "Speak to write". This became Version 2.0. | [#44](https://github.com/lycharp/PaulRemembers/pull/44) |
| 2026-11-16 | Transcripts can be deleted (the recording stays). Voice notes play right on journal cards. Transcript tools live in Edit. | [#45](https://github.com/lycharp/PaulRemembers/pull/45), [#46](https://github.com/lycharp/PaulRemembers/pull/46) |
| 2026-11-16 | Contact is by email (PoquitoWare@gmail.com), not GitHub issues. | [#47](https://github.com/lycharp/PaulRemembers/pull/47) |
| 2026-11-16 | Weekly backup reminder if a device hasn't backed up for 7 days. iPhone daily backups are named by weekday, so at most 7 are kept. | [#37](https://github.com/lycharp/PaulRemembers/pull/37), [#39](https://github.com/lycharp/PaulRemembers/pull/39) |
| 2026-11-16 | A round purple + for a new entry, on computers as well as phones. | [#41](https://github.com/lycharp/PaulRemembers/pull/41) |
| 2026-11-14 | A public welcome page, and the Google verification file, which must never be deleted (also kept in the lycharp.github.io repo). | [#36](https://github.com/lycharp/PaulRemembers/pull/36) |
| 2026-11-13 | Sign-up is invite-only, and everyone must sign in. Single-entry links stay readable by anyone with the link. | [#35](https://github.com/lycharp/PaulRemembers/pull/35) |
| 2026-11-13 | Going back from an entry returns to the same spot in the list, with search and filter kept, and no outline. | [#34](https://github.com/lycharp/PaulRemembers/pull/34) |
| 2026-11-11 | Links show as a short "🔗 site name" label. Nothing is looked up online. | [#33](https://github.com/lycharp/PaulRemembers/pull/33), [#53](https://github.com/lycharp/PaulRemembers/pull/53) |
| 2026-11-10 | New entries start in the Title. | [#32](https://github.com/lycharp/PaulRemembers/pull/32) |
| 2026-11-10 | Backups leave out journals other people shared with you. File names include the account. | [#30](https://github.com/lycharp/PaulRemembers/pull/30) |
| 2026-11-10 | Daily backup at a chosen time, a restore that lets you select which journals, and sharing saved in backups. | [#29](https://github.com/lycharp/PaulRemembers/pull/29) |
| 2026-11-09 | Bookmarks on journals shared with you are kept on your device only, so the owner's journal never changes. | [#28](https://github.com/lycharp/PaulRemembers/pull/28) |
| 2026-11-09 | "A new version is ready" bar, checked only when the app opens. It never reloads by itself, so unsaved writing is safe. | [#27](https://github.com/lycharp/PaulRemembers/pull/27) |
| 2026-11-09 | Send invite offers Gmail, Outlook.com, Yahoo, your email app, or Copy. (Replaced by automatic emails in #67.) | [#25](https://github.com/lycharp/PaulRemembers/pull/25), [#26](https://github.com/lycharp/PaulRemembers/pull/26) |
| 2026-11-07 | Videos over 50 MB are made smaller in the browser so they can sync. Videos show a snapshot picture. | [#22](https://github.com/lycharp/PaulRemembers/pull/22), [#24](https://github.com/lycharp/PaulRemembers/pull/24) |
| 2026-11-06 | You can paste a copied photo into an entry. | [#19](https://github.com/lycharp/PaulRemembers/pull/19), [#20](https://github.com/lycharp/PaulRemembers/pull/20) |
| 2026-11-05 | The app is called "Paul Remembers". | [#15](https://github.com/lycharp/PaulRemembers/pull/15) |
| 2026-11-05 | The About box tells the PoquitoWare story in Paul's own words, exactly as he wrote it. | [#16](https://github.com/lycharp/PaulRemembers/pull/16) |
| 2026-11-05 | A scheduled job keeps the free Supabase project from pausing. (Not needed since Pro, 2026-11-24.) | [#17](https://github.com/lycharp/PaulRemembers/pull/17) |
| 2026-11-03 | "Erase" removes data from this device only. "Delete for good" removes it everywhere, and offers a backup first. | [#13](https://github.com/lycharp/PaulRemembers/pull/13) |
| 2026-11-03 | Help page, a guided tour shown once, and "Keep me signed in". | [#12](https://github.com/lycharp/PaulRemembers/pull/12) |
| 2026-11-03 | Importing skips duplicates only within the journal you chose. | [#11](https://github.com/lycharp/PaulRemembers/pull/11) |
| 2026-11-02 | Privacy policy and terms pages. | [#9](https://github.com/lycharp/PaulRemembers/pull/9) |
| 2026-11-02 | "Brought to you by PoquitoWare" in the sidebar, opening the About box. | [#7](https://github.com/lycharp/PaulRemembers/pull/7), [#8](https://github.com/lycharp/PaulRemembers/pull/8) |
| 2026-11-02 | Sign-in, sync and sharing use Supabase. Sign in with email or Google. Share a journal as Can read or Can edit, or share one entry by private link. | [#3](https://github.com/lycharp/PaulRemembers/pull/3), [#4](https://github.com/lycharp/PaulRemembers/pull/4) |
| 2026-11-02 | Several journals, and photos are never cropped. | [#2](https://github.com/lycharp/PaulRemembers/pull/2) |
| 2026-11-01 | An installable web app that works on Windows and iPhone, not a native iPhone app. Modelled on Apple's Journal, with import from its export. | [#1](https://github.com/lycharp/PaulRemembers/pull/1) |

## Things we said no to

| Date | Idea | Why not |
|---|---|---|
| 2026-11-16 | "Speak to write" microphone button. | Paul decided to drop it ([#44](https://github.com/lycharp/PaulRemembers/pull/44)). |
| 2026-11-11 | Link preview cards. | They needed an outside service. The short 🔗 label is simpler and works offline. |
| 2026-11-10 | Keeping deleted journals for 7 days. | The 7 daily backups already cover it. |
| 2026-11-10 | Showing the full folder path in the backup log. | Browsers only tell a website the folder's name. |
| 2026-11-18 | Deleting accounts from the Admin page. | Block is enough, and it deletes nothing. |

## Waiting for Paul

| Date | Question |
|---|---|
| 2026-11-24 | Comments on entries in shared journals: which layout, and OK to build. |
