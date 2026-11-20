// Paul Remembers: send an invite email (Version 4).
//
// Supabase → Edge Functions → Deploy a new function → Via Editor, name it
// send-invite, paste this whole file in place of the example, and Deploy.
// Needs one secret (Edge Functions → Secrets): RESEND_API_KEY, from resend.com.
// Optional secret INVITE_FROM changes the sender (default below).
//
// The app sends the email it made (subject, formatted and plain text) and who
// it is for. Before sending, the database checks the signed-in person may
// invite that address and has sent fewer than 20 today (claim_invite_send in
// supabase/setup.sql). The sender gets a copy, and replies go to them.

const FROM = Deno.env.get('INVITE_FROM') ?? 'Paul Remembers <invites@poquitoware.com>';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'Use POST.' });

  let body: { to?: unknown; journalId?: unknown; subject?: unknown; html?: unknown; text?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply(400, { error: 'The invite could not be read.' });
  }
  const to = typeof body.to === 'string' ? body.to.trim().toLowerCase() : '';
  const journalId = typeof body.journalId === 'string' && body.journalId ? body.journalId : null;
  const { subject, html, text } = body;
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to)) return reply(400, { error: 'That email address doesn’t look right.' });
  if (typeof subject !== 'string' || typeof html !== 'string' || typeof text !== 'string'
      || subject.length > 200 || html.length > 30000 || text.length > 10000) {
    return reply(400, { error: 'The invite could not be read.' });
  }

  const key = Deno.env.get('RESEND_API_KEY');
  if (!key) return reply(500, { error: 'Sending invites isn’t set up yet (RESEND_API_KEY is missing in Supabase).' });

  // Ask the database, as the signed-in person, whether this invite may go out.
  const auth = req.headers.get('Authorization') ?? '';
  const apikey = req.headers.get('apikey') ?? Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const check = await fetch(`${Deno.env.get('SUPABASE_URL')}/rest/v1/rpc/claim_invite_send`, {
    method: 'POST',
    headers: { Authorization: auth, apikey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ e: to, j: journalId }),
  });
  const checked = await check.json().catch(() => null);
  if (!check.ok) {
    const msg = checked?.message ?? '';
    if (/claim_invite_send|schema cache|does not exist/i.test(msg)) {
      return reply(500, { error: 'The online database needs the Version 4 update (run the latest supabase/setup.sql).' });
    }
    return reply(check.status === 401 ? 401 : 403, { error: msg || 'Please sign in again, then send the invite.' });
  }
  const sender = typeof checked === 'string' ? checked : '';

  const sent = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: [to],
      // The sender's own copy, and replies go to them.
      ...(sender && sender !== to ? { bcc: [sender], reply_to: sender } : {}),
      subject,
      html,
      text,
    }),
  });
  if (!sent.ok) {
    const detail = await sent.json().catch(() => null);
    console.error('Resend refused the email', sent.status, detail);
    return reply(502, { error: `The email service refused the invite: ${detail?.message ?? sent.status}` });
  }
  return reply(200, { ok: true, copyTo: sender });
});
