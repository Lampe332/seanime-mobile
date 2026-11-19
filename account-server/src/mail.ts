/**
 * Transactional mail through the Cloudflare Email Service binding (`EMAIL`).
 * Mails never contain synced data or keys. Links carry tokens in the URL fragment,
 * so they do not reach server logs or Referer headers of the website.
 * Every mail goes out as HTML and as plain text with the same content. The HTML loads nothing from anywhere:
 * no images, fonts, scripts or tracking, and its only links are the mail's own link and the website.
 */

export const MAIL_FROM = { email: "no-reply@seanimemobile.com", name: "Seanime Mobile" };

export type Mail =
  | { kind: "verify"; token: string }
  | { kind: "reset"; token: string }
  | { kind: "new_device"; deviceName: string }
  | { kind: "device_removed"; deviceName: string }
  | { kind: "password_changed" }
  | { kind: "account_deleted" }
  | { kind: "start_fresh" }
  | { kind: "google_linked" }
  | { kind: "google_unlinked" }
  | { kind: "recovery_changed" }
  | { kind: "key_rotated" }
  | { kind: "device_signed_out"; deviceName: string }
  | { kind: "approvals_paused" }
  | { kind: "confirm_sign_in"; token: string }
  | { kind: "inactivity"; deleteAt: number };

/** Mails about a change to the account's security; each one is also kept as a visible event (I5) */
export type SecurityMail = Extract<
  Mail,
  {
    kind:
      | "new_device"
      | "device_removed"
      | "device_signed_out"
      | "password_changed"
      | "start_fresh"
      | "google_linked"
      | "google_unlinked"
      | "recovery_changed"
      | "key_rotated"
      | "approvals_paused";
  }
>;

interface Content {
  subject: string;
  lines: string[];
  /** One value worth seeing at a glance (a device name, a date), shown large */
  fact?: { label: string; value: string };
  link?: { label: string; url: string };
  /** The "if this wasn't you" advice, set apart from the rest */
  notice?: string;
  /** Why this address got the mail (footer) */
  reason: string;
}

const SIGNOFF = "Seanime Mobile";
const SECURITY_REASON = "You get an email like this for every security change on your Seanime Mobile account.";

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function content(env: Env, mail: Mail): Content {
  const base = env.WEB_BASE_URL;
  switch (mail.kind) {
    case "verify":
      return {
        subject: "Confirm your email",
        lines: [
          "Thanks for creating a Seanime Mobile account.",
          "Please confirm your email address. The link works for 7 days.",
        ],
        link: { label: "Confirm email", url: `${base}/account/verify/#token=${mail.token}` },
        notice: "If you did not sign up, you can ignore this email. The account is removed after 7 days.",
        reason: "This address was used to create a Seanime Mobile account.",
      };
    case "reset":
      return {
        subject: "Reset your password",
        lines: [
          "Someone asked to reset the password of your Seanime Mobile account.",
          "The link works for 30 minutes and only once.",
        ],
        link: { label: "Reset password", url: `${base}/account/reset/#token=${mail.token}` },
        notice: "If this was not you, ignore this email. Your password stays the same.",
        reason: "Someone asked for a password reset for this address.",
      };
    case "new_device":
      return {
        subject: "New device signed in",
        lines: [`A device was added to your account: ${mail.deviceName}.`],
        fact: { label: "Device", value: mail.deviceName },
        notice: "If this was not you, remove the device in your account settings and change your password.",
        reason: SECURITY_REASON,
      };
    case "device_removed":
      return {
        subject: "A device was removed",
        lines: [
          `${mail.deviceName} was removed from your account and signed out.`,
          "Open Seanime Mobile on one of your devices and choose Change encryption key. Until then the removed device still knows the old key. If you have no device left, sign in with your password or your recovery code first.",
        ],
        fact: { label: "Device", value: mail.deviceName },
        notice: "If this was not you, change your password and check your devices.",
        reason: SECURITY_REASON,
      };
    case "password_changed":
      return {
        subject: "Your password was changed",
        lines: [
          "The password of your Seanime Mobile account was changed. Other devices were signed out and a linked Google sign-in was removed.",
        ],
        notice: "If this was not you, reset your password right away.",
        reason: SECURITY_REASON,
      };
    case "account_deleted":
      return {
        subject: "Your account was deleted",
        lines: [
          "Your Seanime Mobile account and all synced data were deleted.",
          "The app keeps working on your devices with the data stored there.",
        ],
        reason: "This address belonged to a Seanime Mobile account.",
      };
    case "start_fresh":
      return {
        subject: "Your synced data was reset",
        lines: [
          "Someone chose Start fresh for your Seanime Mobile account.",
          "All synced data was deleted, every other device was removed and signed out, and a new key was created.",
        ],
        notice: "If this was not you, reset your password right away and remove any device you do not know.",
        reason: SECURITY_REASON,
      };
    case "google_linked":
      return {
        subject: "Google sign-in was added",
        lines: ["A Google account was linked to your Seanime Mobile account. It can now be used to sign in."],
        notice: "If this was not you, open your account settings, choose Disconnect Google and change your password.",
        reason: SECURITY_REASON,
      };
    case "google_unlinked":
      return {
        subject: "Google sign-in was removed",
        lines: [
          "The Google account linked to your Seanime Mobile account was disconnected. Sign in with your email and password.",
        ],
        notice: "If this was not you, change your password right away.",
        reason: SECURITY_REASON,
      };
    case "recovery_changed":
      return {
        subject: "Your recovery code was changed",
        lines: ["A new recovery code was saved for your Seanime Mobile account. The old one no longer works."],
        notice: "If this was not you, remove any device you do not know and change your password.",
        reason: SECURITY_REASON,
      };
    case "key_rotated":
      return {
        subject: "Your account key was changed",
        lines: [
          "One of your devices switched your Seanime Mobile account to a new key, for example after a device was removed.",
          "Your other devices pick it up on their own.",
        ],
        notice: "If you did not remove a device, check your device list.",
        reason: SECURITY_REASON,
      };
    case "device_signed_out":
      return {
        subject: "A device signed out",
        lines: [`${mail.deviceName} signed out of your account. Your device list shows it as signed out.`],
        fact: { label: "Device", value: mail.deviceName },
        notice:
          "If you did not sign it out yourself, open Seanime Mobile on one of your devices and choose Change encryption key, so it can't read anything new.",
        reason: SECURITY_REASON,
      };
    case "approvals_paused":
      return {
        subject: "New device sign-ins are paused",
        lines: [
          "In the last hour, the numbers of three device sign-ins did not match. That can be an attack, so approving new devices is paused for one hour.",
          "Your password and your recovery code still work.",
        ],
        notice: "If you did not try to add a device, change your password.",
        reason: SECURITY_REASON,
      };
    case "confirm_sign_in":
      return {
        subject: "Confirm your sign-in",
        lines: [
          "Someone signed in to your Seanime Mobile account with the right password. Many wrong passwords were tried for your email lately, so the sign-in waits for this link.",
          "The link works for 15 minutes. After you open it, go back to the app or the website and press Continue.",
        ],
        link: { label: "Confirm sign-in", url: `${base}/account/confirm/#token=${mail.token}` },
        notice: "If this was not you, do not open the link and change your password.",
        reason: "Someone signed in to the Seanime Mobile account that uses this address.",
      };
    case "inactivity": {
      const date = formatDate(mail.deleteAt);
      return {
        subject: "Your account will be deleted soon",
        lines: [
          "Your Seanime Mobile account has not been used for 180 days.",
          `It will be deleted with all synced data on ${date}.`,
          "To keep it, open the app while signed in or sign in on the website.",
        ],
        fact: { label: "Deletion date", value: date },
        reason: "This address belongs to a Seanime Mobile account.",
      };
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------------------------------------------------------------- HTML layout

// Colors and type from the website (seanimemobile.com, assets/css/style.css). No web fonts: the display stack
// falls back to the heaviest system face, so nothing is loaded.
const C = {
  ink: "#0b0a1c",
  paper: "#f4eee1",
  paper2: "#e6dcc6",
  violet: "#6f5cff",
  violet2: "#4b3bdc",
  sun: "#ffd938",
  text: "#f6f1e7",
  dim: "#bdb9b6",
  muted: "#55516a",
};
const DISPLAY = "'Dela Gothic One','Arial Black','Segoe UI Black',Helvetica,Arial,sans-serif";
const BODY = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';

// Mail apps that know prefers-color-scheme (Apple Mail, iOS) get a dark card; Gmail and Outlook recolor on their own.
const HEAD_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
@media (max-width:520px){.sm-gut{padding:20px 10px 28px !important}.sm-card{padding:26px 20px 24px !important}.sm-h1{font-size:23px !important}}
@media (prefers-color-scheme:dark){.sm-card{background:#1c1936 !important}.sm-ink{color:${C.text} !important}.sm-muted{color:${C.dim} !important}.sm-link{color:#aea3ff !important}.sm-fact{background:#110f24 !important;border-color:#8f7fff !important}.sm-note{background:#29234f !important;border-color:#8f7fff !important}}`;

function paragraph(line: string, last: boolean): string {
  return `<p class="sm-ink" style="margin:0 0 ${last ? 0 : 14}px;font-family:${BODY};font-size:16px;line-height:1.55;color:${C.ink}">${escapeHtml(line)}</p>`;
}

function factBox(f: { label: string; value: string }): string {
  return `<table ${T} width="100%" style="margin:6px 0 0"><tr><td class="sm-fact" bgcolor="#ffffff" style="background:#ffffff;border:2px solid ${C.ink};border-radius:12px;padding:12px 16px">
<p class="sm-muted" style="margin:0 0 2px;font-family:${BODY};font-size:13px;line-height:1.4;font-weight:700;color:${C.muted}">${escapeHtml(f.label)}</p>
<p class="sm-ink" style="margin:0;font-family:${BODY};font-size:21px;line-height:1.3;font-weight:800;color:${C.ink};word-break:break-word">${escapeHtml(f.value)}</p>
</td></tr></table>`;
}

function button(link: { label: string; url: string }): string {
  const href = escapeHtml(link.url);
  return `<table ${T} style="margin:10px 0 0"><tr><td bgcolor="${C.sun}" style="background:${C.sun};border:2px solid ${C.ink};border-radius:999px">
<a href="${href}" target="_blank" style="display:inline-block;padding:14px 30px;font-family:${BODY};font-size:16px;line-height:1.2;font-weight:800;color:${C.ink};text-decoration:none;border-radius:999px">${escapeHtml(link.label)}</a>
</td></tr></table>
<p class="sm-muted" style="margin:16px 0 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${C.muted}">If the button does not open, copy this link into your browser:<br>
<a class="sm-link" href="${href}" target="_blank" style="color:${C.violet2};word-break:break-all">${href}</a></p>`;
}

function notice(text: string): string {
  return `<table ${T} width="100%" style="margin:22px 0 0"><tr><td class="sm-note" bgcolor="${C.paper2}" style="background:${C.paper2};border:2px solid ${C.ink};border-radius:12px;padding:13px 16px">
<p class="sm-ink" style="margin:0;font-family:${BODY};font-size:15px;line-height:1.5;font-weight:700;color:${C.ink}">${escapeHtml(text)}</p>
</td></tr></table>`;
}

/**
 * The website's paper panel with its hard violet shadow. box-shadow is missing in Gmail, so the shadow is a right and a
 * bottom border on a wrapper cell; with the rounded corners both borders taper off like an offset shadow.
 */
function card(inner: string): string {
  return `<table ${T} width="100%"><tr><td style="border-right:6px solid ${C.violet};border-bottom:6px solid ${C.violet};border-radius:18px">
<table ${T} width="100%"><tr><td class="sm-card" bgcolor="${C.paper}" style="background:${C.paper};border:2px solid ${C.ink};border-radius:16px;padding:34px 34px 30px">${inner}</td></tr></table>
</td></tr></table>`;
}

function layout(c: Content, base: string, to: string | undefined): string {
  const site = base.replace(/^https?:\/\//, "");
  const body = [
    `<h1 class="sm-ink sm-h1" style="margin:0 0 18px;font-family:${DISPLAY};font-size:27px;line-height:1.15;font-weight:900;letter-spacing:-0.01em;color:${C.ink}">${escapeHtml(c.subject)}</h1>`,
    ...c.lines.map((l, i) => paragraph(l, i === c.lines.length - 1 && !c.fact && !c.link && !c.notice)),
    c.fact ? factBox(c.fact) : "",
    c.link ? button(c.link) : "",
    c.notice ? notice(c.notice) : "",
  ].join("\n");
  const foot = (html: string, last = false) =>
    `<p style="margin:0 0 ${last ? 0 : 6}px;font-family:${BODY};font-size:13px;line-height:1.6;color:${C.dim}">${html}</p>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(c.subject)}</title>
<style>${HEAD_CSS}</style>
</head>
<body style="margin:0;padding:0;background:${C.ink}">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.ink}">${escapeHtml(c.lines[0] ?? c.subject)}</div>
<table ${T} width="100%" bgcolor="${C.ink}" style="background:${C.ink}"><tr><td align="center" class="sm-gut" style="padding:32px 16px 40px">
<!--[if mso]><table ${T} width="600"><tr><td><![endif]-->
<table ${T} width="100%" style="max-width:600px">
<tr><td style="padding:0 0 18px 2px"><table ${T}><tr>
<td width="30" height="30" align="center" bgcolor="${C.violet}" style="width:30px;height:30px;border-radius:9px;background:${C.violet};background-image:linear-gradient(135deg,#8b3cff 0%,#d23cf0 55%,#ff4d7a 100%);font-family:${DISPLAY};font-size:19px;line-height:30px;font-weight:900;color:${C.ink};text-align:center">S</td>
<td style="padding-left:11px;font-family:${DISPLAY};font-size:18px;line-height:30px;font-weight:900;letter-spacing:-0.01em;color:${C.text}">${escapeHtml(SIGNOFF)}</td>
</tr></table></td></tr>
<tr><td>${card(body)}</td></tr>
<tr><td style="padding:26px 4px 0">
${to ? foot(`Sent by ${escapeHtml(SIGNOFF)} to <span style="color:${C.text}">${escapeHtml(to)}</span>.`) : foot(`Sent by ${escapeHtml(SIGNOFF)}.`)}
${foot(escapeHtml(c.reason))}
${foot(`<a href="${escapeHtml(base)}" target="_blank" style="color:${C.text};text-decoration:underline">${escapeHtml(site)}</a>`, true)}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

/** Renders one mail. `to` (the recipient) only goes into the footer. */
export function renderMail(env: Env, mail: Mail, to?: string): { subject: string; text: string; html: string } {
  const c = content(env, mail);
  const base = env.WEB_BASE_URL;
  const text = [
    ...c.lines,
    ...(c.fact ? [`${c.fact.label}: ${c.fact.value}`] : []),
    ...(c.link ? [`${c.link.label}: ${c.link.url}`] : []),
    ...(c.notice ? [c.notice] : []),
    [to ? `Sent by ${SIGNOFF} to ${to}.` : `Sent by ${SIGNOFF}.`, c.reason, base].join("\n"),
  ].join("\n\n");
  return { subject: c.subject, text, html: layout(c, base, to) };
}

/**
 * I5: a security event is kept for the account (GET account lists the newest ones) and mailed. The row is written before
 * the mail, so the event shows even when the mail fails.
 */
export async function notify(env: Env, userId: string, to: string, mail: SecurityMail): Promise<void> {
  await env.DB.prepare("INSERT INTO account_events (user_id, kind, device_name, at) VALUES (?, ?, ?, ?)")
    .bind(userId, mail.kind, "deviceName" in mail ? mail.deviceName : null, Math.floor(Date.now() / 1000))
    .run();
  await sendMail(env, to, mail);
}

/**
 * Sends one mail. Delivery problems never fail the request that triggered it:
 * the error code is logged (no address, no token) and the caller continues.
 */
export async function sendMail(env: Env, to: string, mail: Mail): Promise<boolean> {
  const { subject, text, html } = renderMail(env, mail, to);
  try {
    await env.EMAIL.send({ to, from: MAIL_FROM, subject, text, html });
    return true;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? (err as Error)?.name ?? "unknown";
    console.error(JSON.stringify({ msg: "mail_failed", kind: mail.kind, code }));
    return false;
  }
}
