import nodemailer, { type Transporter } from 'nodemailer';
import { env } from './env.js';

/**
 * Outgoing email for PMS sign-in codes, sent through the same mailbox OMS
 * uses (by the owner's decision, 2026-11-26): SMTP_* are copied from OMS's
 * own configuration. Unset means email-code sign-in is unavailable and the
 * password login is the only way in.
 */

let transporter: Transporter | null = null;

export function mailerConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function mailer(): Transporter {
  if (transporter) return transporter;
  const port = Number(env.SMTP_PORT ?? 587);
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transporter;
}

/** "Crystal PMS <address>": OMS's sending address, with a PMS display name. */
function fromAddress(): string {
  const raw = env.SMTP_FROM ?? env.SMTP_USER ?? '';
  const address = /<([^>]+)>/.exec(raw)?.[1] ?? raw;
  return `Crystal PMS <${address.trim()}>`;
}

const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The PMS-branded sign-in code email, deliberately unlike OMS's own code email. */
export async function sendPmsLoginCode(to: string, code: string, name: string): Promise<void> {
  const safeName = escapeHtml(name || 'there');
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#f3f5f8;font-family:Arial,Helvetica,sans-serif;color:#1d2733">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f8;padding:24px 0"><tr><td align="center">
    <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:10px;overflow:hidden;border:1px solid #dfe4ea">
      <tr><td style="background:#0f4c81;padding:18px 24px;color:#ffffff">
        <div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;opacity:.85">Crystal Group</div>
        <div style="font-size:20px;font-weight:bold;margin-top:2px">PMS &middot; Yard Preparation System</div>
      </td></tr>
      <tr><td style="padding:24px">
        <p style="margin:0 0 12px;font-size:15px">Hi ${safeName},</p>
        <p style="margin:0 0 18px;font-size:15px">Use this code to sign in to <b>PMS</b> (the yard preparation system):</p>
        <div style="font-size:34px;font-weight:bold;letter-spacing:8px;text-align:center;background:#eef4fb;border:1px dashed #0f4c81;border-radius:8px;padding:14px 0;color:#0f4c81">${code}</div>
        <p style="margin:18px 0 6px;font-size:13px;color:#52606d">The code expires in <b>10 minutes</b>.</p>
        <p style="margin:0 0 6px;font-size:13px;color:#52606d">This code is <b>only for PMS</b>. It is not an OMS code and will not work in OMS.</p>
        <p style="margin:0;font-size:13px;color:#52606d">If you didn't try to sign in to PMS, ignore this email. Nobody can sign in without the code.</p>
      </td></tr>
      <tr><td style="background:#f7f9fb;padding:12px 24px;font-size:11px;color:#7b8794;border-top:1px solid #e6eaef">Crystal PMS &middot; sent automatically, please don't reply.</td></tr>
    </table>
  </td></tr></table></body></html>`;
  const text = `Crystal PMS (Yard Preparation System)\n\nHi ${name || 'there'},\n\nYour PMS sign-in code is: ${code}\n\nIt expires in 10 minutes. This code is only for PMS; it is not an OMS code.\nIf you didn't try to sign in to PMS, ignore this email.`;
  await mailer().sendMail({ from: fromAddress(), to, subject: `${code} is your PMS sign-in code`, text, html });
}
