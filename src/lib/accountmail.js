// Account emails: the invite / password link, and "your sign-up is approved". Sent only when email is set up;
// the link is always shown on screen too, so it can be shared by WhatsApp instead.
import { emailConfigured, sendEmail } from './email.js';

const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const SYSTEM = 'LGA Multi-Sectoral Nutrition Scorecard Data Reporting System';
const fmt = (ms) => new Date(ms).toLocaleString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Lagos' });

function mail(name, lines, button) {
  const text = [`Dear ${name},`, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : []), '', SYSTEM].join('\n');
  const html = `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#1c2321;max-width:560px">
<p>Dear ${esc(name)},</p>${lines.filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('')}
${button ? `<p><a href="${esc(button.url)}" style="display:inline-block;background:#00704a;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">${esc(button.label)}</a></p>` : ''}
<p style="color:#5d6b66;font-size:13px">${SYSTEM}</p></div>`;
  return { text, html };
}

// Returns true when emailed, false when email is not set up or sending failed (the link is still on screen).
export async function emailPasswordLink(env, { name, email, roleName, place, link, expiresAt, purpose, replyTo }) {
  if (!emailConfigured(env)) return false;
  const invite = purpose === 'invite';
  const m = mail(name, invite
    ? [`An account has been created for you: ${roleName}${place ? `, ${place}` : ''}.`, 'Open the link below to choose your password. It works once and expires on ' + fmt(expiresAt) + '.']
    : ['Open the link below to choose a new password. It works once and expires on ' + fmt(expiresAt) + '.', 'If you did not ask for this, you can ignore this email.'],
    { label: invite ? 'Choose your password' : 'Choose a new password', url: link });
  try { await sendEmail(env, { to: email, subject: invite ? 'Your account — LGA Nutrition Scorecard' : 'New password link — LGA Nutrition Scorecard', ...m, replyTo }); return true; }
  catch { return false; }
}

export async function emailApproved(env, { name, email, roleName, place, signIn, replyTo }) {
  if (!emailConfigured(env)) return false;
  const m = mail(name, [`Your request for an account has been approved: ${roleName}${place ? `, ${place}` : ''}.`, 'Sign in with your email and the password you chose when you registered.'], { label: 'Sign in', url: signIn });
  try { await sendEmail(env, { to: email, subject: 'Your account is approved — LGA Nutrition Scorecard', ...m, replyTo }); return true; }
  catch { return false; }
}
