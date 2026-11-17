/**
 * The invite emails people send from their own email (the app sends none itself).
 * Each has a plain-text version, for compose links, which only take plain text,
 * and a formatted version with the PoquitoWare logo and a button, for pasting.
 */
import { appUrl } from './cloud/cloud';

export interface InviteEmail {
  subject: string;
  text: string;
  html: string;
}

/** The invite's link: opens "Create an account" with their email filled in. */
export const joinUrl = (email: string) => `${appUrl()}#/join/${encodeURIComponent(email)}`;

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Parts {
  subject: string;
  intro: string;
  /** Step 1, before and after the link. */
  linkLead: string;
  linkTail: string;
  email: string;
  /** Show the "Already have an account?" tip. */
  maybeHasAccount: boolean;
  outro: string;
  from?: string;
}

function build(p: Parts): InviteEmail {
  const url = joinUrl(p.email);
  const google = 'If you’re using a Gmail address, feel free to choose “Continue with Google.”';
  const signIn = 'Already have an account? Just click “Already have an account? Sign in.”';
  const confirm = 'Check your inbox (and spam folder) for a quick confirmation email, then sign in.';

  const text = [
    'Hi!',
    '',
    p.intro,
    '',
    'Here’s how to get started:',
    '',
    `1. ${p.linkLead}Paul Remembers${p.linkTail}: ${url}`,
    '',
    `2. Create your account using this email address: ${p.email}`,
    `   • ${google}`,
    ...(p.maybeHasAccount ? [`   • ${signIn}`] : []),
    '',
    `3. ${confirm}`,
    '',
    p.outro,
    ...(p.from ? ['', p.from] : []),
  ].join('\n');

  const font = "font-family:Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5;color:#2b2233";
  const purple = '#6d4bd8';
  const link = `<a href="${esc(url)}" style="color:${purple};font-weight:600">Paul Remembers</a>`;
  const html = `<div style="${font};max-width:560px">
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px"><tr>
<td style="padding-right:12px;vertical-align:middle"><img src="${esc(appUrl())}poquitoware-logo.png" width="56" height="56" alt="PoquitoWare" style="display:block;border:0"></td>
<td style="vertical-align:middle;${font}"><div style="font-size:22px;font-weight:700;color:${purple}">Paul Remembers</div><div style="font-size:13px;color:#7a7085">A private journal app by PoquitoWare</div></td>
</tr></table>
<p style="margin:0 0 12px">Hi!</p>
<p style="margin:0 0 16px">${esc(p.intro)}</p>
<p style="margin:0 0 20px"><a href="${esc(url)}" style="display:inline-block;background:${purple};color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:999px">Open Paul Remembers</a></p>
<p style="margin:0 0 8px"><strong>Here’s how to get started:</strong></p>
<ol style="margin:0 0 16px;padding-left:24px">
<li style="margin-bottom:10px">${esc(p.linkLead)}${link}${esc(p.linkTail)}.</li>
<li style="margin-bottom:10px">Create your account using this email address: <strong>${esc(p.email)}</strong>
<ul style="margin:6px 0 0;padding-left:20px"><li>${esc(google)}</li>${p.maybeHasAccount ? `<li>${esc(signIn)}</li>` : ''}</ul></li>
<li>${esc(confirm)}</li>
</ol>
<p style="margin:0 0 16px">${esc(p.outro)}</p>
${p.from ? `<p style="margin:0">${esc(p.from)}</p>` : ''}
</div>`;
  return { subject: p.subject, text, html };
}

/** "<name> is sharing a Journal in Paul Remembers". */
export function journalInvite(journalName: string, email: string, role: 'editor' | 'viewer', from?: string): InviteEmail {
  return build({
    subject: `${from || 'A friend'} is sharing a Journal in Paul Remembers`,
    intro: role === 'editor'
      ? `I shared my journal, “${journalName},” with you on Paul Remembers! I’d love for you to check it out and add your own entries anytime.`
      : `I shared my journal, “${journalName},” with you on Paul Remembers! I’d love for you to check it out and read along anytime.`,
    linkLead: 'Click this link to ',
    linkTail: ' to join the Journal',
    email,
    maybeHasAccount: true,
    outro: 'Once you’re signed in, the journal will be waiting for you!',
    from,
  });
}

/** Invite to the app itself (Settings → Invite someone), no journal shared. */
export function appInvite(email: string, from?: string): InviteEmail {
  return build({
    subject: `${from || 'A friend'} invited you to Paul Remembers`,
    intro: 'I’ve invited you to Paul Remembers, my private journal app! It’s a lovely place to write about your days and keep photos, videos and voice notes with them. It’s invite-only, so I’ve saved you a spot.',
    linkLead: 'Click this link to open ',
    linkTail: '',
    email,
    maybeHasAccount: false,
    outro: 'Once you’re signed in, you can start your first entry right away!',
    from,
  });
}

/** Put the formatted invite on the clipboard (plain text too, for apps that can't take it). */
export async function copyInvite(mail: InviteEmail, withSubject: boolean): Promise<boolean> {
  const text = withSubject ? `${mail.subject}\n\n${mail.text}` : mail.text;
  const html = withSubject ? `<p style="font-weight:700">${esc(mail.subject)}</p>${mail.html}` : mail.html;
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([text], { type: 'text/plain' }),
      })]);
      return true;
    }
  } catch { /* fall through to plain text */ }
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
