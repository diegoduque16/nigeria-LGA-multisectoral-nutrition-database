// Outgoing email through Resend (https://resend.com), with attachments.
// Set up once in Cloudflare (Worker → Settings → Variables and Secrets):
//   EMAIL_API_KEY  (Secret)  — the Resend API key
//   EMAIL_FROM     (Text)    — e.g. "LGA Scorecard <reports@lganutritiondata.org>" (the domain verified in Resend)
// Without them, the app shows the reminder text and links for sharing by hand (WhatsApp) instead.
export const emailConfigured = (env) => !!(env.EMAIL_API_KEY && env.EMAIL_FROM);

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// attachments: [{ filename, bytes: Uint8Array }]
export async function sendEmail(env, { to, subject, html, text, attachments = [], replyTo }) {
  if (!emailConfigured(env)) throw new Error('Email is not set up.');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.EMAIL_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM, to: [to], subject, html, text, ...(replyTo ? { reply_to: replyTo } : {}),
      attachments: attachments.map((a) => ({ filename: a.filename, content: b64(a.bytes) })),
    }),
  });
  if (!res.ok) {
    let msg = `the email service answered ${res.status}`;
    try { const j = await res.json(); if (j && j.message) msg = j.message; } catch {}
    throw new Error(msg);
  }
  return true;
}
