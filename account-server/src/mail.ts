/**
 * Transactional mail through the Cloudflare Email Service binding (`EMAIL`).
 * Mails never contain synced data or keys. Links carry tokens in the URL fragment,
 * so they do not reach server logs or Referer headers of the website.
 * Every mail goes out as HTML and as plain text with the same content. The HTML loads nothing from anywhere:
 * no images, fonts, scripts or tracking. Its links go to the website, the Discord server and Ko-fi.
 */

export const MAIL_FROM = { email: "no-reply@seanimemobile.com", name: "Seanime Mobile" };

export type Mail =
  | { kind: "verify"; token: string }
  | { kind: "reset"; token: string }
  | { kind: "new_device"; deviceName: string }
  | { kind: "device_removed"; deviceName: string }
  | { kind: "password_changed"; afterCode?: boolean }
  | { kind: "account_deleted" }
  | { kind: "start_fresh" }
  | { kind: "google_linked" }
  | { kind: "google_unlinked" }
  | { kind: "recovery_changed" }
  | { kind: "key_rotated" }
  | { kind: "device_signed_out"; deviceName: string }
  | { kind: "approvals_paused" }
  | { kind: "confirm_sign_in"; token: string }
  | { kind: "sign_in_code"; code: string }
  | { kind: "code_only_on" }
  | { kind: "code_only_off" }
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
      | "approvals_paused"
      | "code_only_on"
      | "code_only_off";
  }
>;

interface Fact {
  label: string;
  value: string;
}

interface Content {
  subject: string;
  /** What kind of mail this is, shown as the pill and in the band */
  tag: string;
  lines: string[];
  /** Values worth seeing at a glance (a device, a time, the next step), shown as tiles */
  facts?: Fact[];
  /** A sign-in code, shown digit by digit */
  code?: string;
  link?: { label: string; url: string };
  /** The "if this wasn't you" advice, set apart from the rest */
  notice?: string;
  /** Why this address got the mail (footer) */
  reason: string;
}

const SIGNOFF = "Seanime Mobile";
const SECURITY_REASON = "You get an email like this for every security change on your Seanime Mobile account.";
const DISCORD = "https://discord.gg/dxJdj5Dqt9";
const KOFI = "https://ko-fi.com/lampe332";

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

function formatTime(unixSeconds: number): string {
  const iso = new Date(unixSeconds * 1000).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** `when` is the time the mail is rendered, which is when the change happened */
function content(env: Env, mail: Mail, when: string): Content {
  const base = env.WEB_BASE_URL;
  const at: Fact = { label: "When", value: when };
  switch (mail.kind) {
    case "verify":
      return {
        subject: "Confirm your email",
        tag: "Account",
        lines: [
          "Thanks for creating a Seanime Mobile account.",
          "Please confirm your email address. The link works for 7 days.",
        ],
        facts: [{ label: "Link works for", value: "7 days" }],
        link: { label: "Confirm email", url: `${base}/account/verify/#token=${mail.token}` },
        notice: "If you did not sign up, you can ignore this email. The account is removed after 7 days.",
        reason: "This address was used to create a Seanime Mobile account.",
      };
    case "reset":
      return {
        subject: "Reset your password",
        tag: "Password",
        lines: [
          "Someone asked to reset the password of your Seanime Mobile account.",
          "The link works for 30 minutes and only once.",
        ],
        facts: [{ label: "Link works for", value: "30 minutes, once" }],
        link: { label: "Reset password", url: `${base}/account/reset/#token=${mail.token}` },
        notice: "If this was not you, ignore this email. Your password stays the same.",
        reason: "Someone asked for a password reset for this address.",
      };
    case "new_device":
      return {
        subject: "New device signed in",
        tag: "New device",
        lines: [`A device was added to your account: ${mail.deviceName}.`],
        facts: [{ label: "Device", value: mail.deviceName }, at],
        notice: "If this was not you, remove the device in your account settings and change your password.",
        reason: SECURITY_REASON,
      };
    case "device_removed":
      return {
        subject: "A device was removed",
        tag: "Device removed",
        lines: [
          `${mail.deviceName} was removed from your account and signed out.`,
          "Open Seanime Mobile on one of your devices and choose Change encryption key. Until then the removed device still knows the old key. If you have no device left, sign in with your password or your recovery code first.",
        ],
        facts: [{ label: "Device", value: mail.deviceName }, at, { label: "Next step", value: "Change encryption key" }],
        notice: "If this was not you, change your password and check your devices.",
        reason: SECURITY_REASON,
      };
    case "password_changed":
      return {
        subject: "Your password was changed",
        tag: "Password",
        lines: [
          mail.afterCode
            ? "The password of your Seanime Mobile account was changed after a sign-in with an email code. Your devices stay signed in and a linked Google sign-in was removed."
            : "The password of your Seanime Mobile account was changed. Other devices were signed out and a linked Google sign-in was removed.",
        ],
        facts: [
          at,
          { label: "Other devices", value: mail.afterCode ? "Still signed in" : "Signed out" },
          { label: "Google sign-in", value: "Removed" },
        ],
        notice: "If this was not you, reset your password right away.",
        reason: SECURITY_REASON,
      };
    case "account_deleted":
      return {
        subject: "Your account was deleted",
        tag: "Account",
        lines: [
          "Your Seanime Mobile account and all synced data were deleted.",
          "The app keeps working on your devices with the data stored there.",
        ],
        facts: [at, { label: "Synced data", value: "Deleted" }],
        reason: "This address belonged to a Seanime Mobile account.",
      };
    case "start_fresh":
      return {
        subject: "Your synced data was reset",
        tag: "Security",
        lines: [
          "Someone chose Start fresh for your Seanime Mobile account.",
          "All synced data was deleted, every other device was removed and signed out, and a new key was created.",
        ],
        facts: [at, { label: "Other devices", value: "Removed" }],
        notice: "If this was not you, reset your password right away and remove any device you do not know.",
        reason: SECURITY_REASON,
      };
    case "google_linked":
      return {
        subject: "Google sign-in was added",
        tag: "Google sign-in",
        lines: ["A Google account was linked to your Seanime Mobile account. It can now be used to sign in."],
        facts: [at, { label: "Google sign-in", value: "On" }],
        notice: "If this was not you, open your account settings, choose Disconnect Google and change your password.",
        reason: SECURITY_REASON,
      };
    case "google_unlinked":
      return {
        subject: "Google sign-in was removed",
        tag: "Google sign-in",
        lines: [
          "The Google account linked to your Seanime Mobile account was disconnected. Sign in with your email and password.",
        ],
        facts: [at, { label: "Google sign-in", value: "Off" }],
        notice: "If this was not you, change your password right away.",
        reason: SECURITY_REASON,
      };
    case "recovery_changed":
      return {
        subject: "Your recovery code was changed",
        tag: "Recovery code",
        lines: ["A new recovery code was saved for your Seanime Mobile account. The old one no longer works."],
        facts: [at, { label: "Old code", value: "No longer works" }],
        notice: "If this was not you, remove any device you do not know and change your password.",
        reason: SECURITY_REASON,
      };
    case "key_rotated":
      return {
        subject: "Your account key was changed",
        tag: "Security",
        lines: [
          "One of your devices switched your Seanime Mobile account to a new key, for example after a device was removed.",
          "Your other devices pick it up on their own.",
        ],
        facts: [at, { label: "Other devices", value: "Update on their own" }],
        notice: "If you did not remove a device, check your device list.",
        reason: SECURITY_REASON,
      };
    case "device_signed_out":
      return {
        subject: "A device signed out",
        tag: "Device",
        lines: [`${mail.deviceName} signed out of your account. Your device list shows it as signed out.`],
        facts: [{ label: "Device", value: mail.deviceName }, at],
        notice:
          "If you did not sign it out yourself, open Seanime Mobile on one of your devices and choose Change encryption key, so it can't read anything new.",
        reason: SECURITY_REASON,
      };
    case "approvals_paused":
      return {
        subject: "New device sign-ins are paused",
        tag: "Security",
        lines: [
          "In the last hour, the numbers of three device sign-ins did not match. That can be an attack, so approving new devices is paused for one hour.",
          "Your password and your recovery code still work.",
        ],
        facts: [at, { label: "Paused for", value: "1 hour" }],
        notice: "If you did not try to add a device, change your password.",
        reason: SECURITY_REASON,
      };
    case "confirm_sign_in":
      return {
        subject: "Confirm your sign-in",
        tag: "Sign-in",
        lines: [
          "Someone signed in to your Seanime Mobile account with the right password. Many wrong passwords were tried for your email lately, so the sign-in waits for this link.",
          "The link works for 15 minutes. After you open it, go back to the app or the website and press Continue.",
        ],
        facts: [
          { label: "Link works for", value: "15 minutes" },
          { label: "Then", value: "Press Continue" },
        ],
        link: { label: "Confirm sign-in", url: `${base}/account/confirm/#token=${mail.token}` },
        notice: "If this was not you, do not open the link and change your password.",
        reason: "Someone signed in to the Seanime Mobile account that uses this address.",
      };
    case "sign_in_code":
      return {
        subject: "Your Seanime Mobile sign-in code",
        tag: "Sign-in code",
        lines: [
          "Someone asked to sign in to your Seanime Mobile account with a code. Type this code in the app.",
          "The code works for 10 minutes and only once.",
        ],
        code: mail.code,
        facts: [{ label: "Code works for", value: "10 minutes, once" }],
        notice: "If this was not you, ignore this email. Your password stays the same.",
        reason: "Someone asked for a sign-in code for this address.",
      };
    case "code_only_on":
      return {
        subject: "Sign-in with an email code only was turned on",
        tag: "Security",
        lines: [
          "A code sent to this address now signs you in to Seanime Mobile with all your synced data, no password needed.",
          "For that the server keeps a copy of your key, so Seanime Mobile can read your synced data while this is on. Turn it off in Settings > Account to keep it end-to-end encrypted.",
        ],
        facts: [at, { label: "Turn it off in", value: "Settings > Account" }],
        notice: "If this was not you, turn it off in Settings > Account on one of your devices and change your password.",
        reason: SECURITY_REASON,
      };
    case "code_only_off":
      return {
        subject: "Sign-in with an email code only was turned off",
        tag: "Security",
        lines: [
          "The server's copy of your key was deleted. Your synced data is end-to-end encrypted again.",
          "A code from this address still signs you in. A new device then needs another device, your recovery code or your password to unlock your data.",
        ],
        facts: [at, { label: "Server copy of your key", value: "Deleted" }],
        notice: "If this was not you, check your devices and change your password.",
        reason: SECURITY_REASON,
      };
    case "inactivity": {
      const date = formatDate(mail.deleteAt);
      return {
        subject: "Your account will be deleted soon",
        tag: "Account",
        lines: [
          "Your Seanime Mobile account has not been used for 180 days.",
          `It will be deleted with all synced data on ${date}.`,
          "To keep it, open the app while signed in or sign in on the website.",
        ],
        facts: [
          { label: "Deletion date", value: date },
          { label: "Not used for", value: "180 days" },
        ],
        link: { label: "Sign in to keep it", url: `${base}/account/` },
        reason: "This address belongs to a Seanime Mobile account.",
      };
    }
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

// ---------------------------------------------------------------- HTML layout

// Colors and type from the website (seanimemobile.com, assets/css/style.css): ink ground, paper panels with a hard
// violet drop, one yellow. No web fonts: both stacks name the website's faces first and fall back to system faces.
const C = {
  ink: "#0b0a1c",
  ink2: "#15132f",
  ink3: "#1f1c47",
  paper: "#f4eee1",
  white: "#fffdf7",
  violet: "#6f5cff",
  violet2: "#4b3bdc",
  violetHi: "#aea3ff",
  sun: "#ffd938",
  text: "#f6f1e7",
  dim: "#c9c4c0",
  muted: "#55516a",
  edge: "#4a4766",
};
const DISPLAY = "'Dela Gothic One','Arial Black','Segoe UI Black',Helvetica,Arial,sans-serif";
const BODY = "Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
/** The logo's gradient; mail apps without CSS gradients show the flat violet bgcolor instead */
const LOGO_GRADIENT = "linear-gradient(135deg,#8b3cff 0%,#d23cf0 55%,#ff4d7a 100%)";
const LOGO_GRADIENT_WIDE = "linear-gradient(90deg,#8b3cff 0%,#d23cf0 55%,#ff4d7a 100%)";

// Dark colors for mail apps that know prefers-color-scheme (Apple Mail, iOS Mail, Outlook for Mac) and for
// Outlook.com's dark mode, which marks recolored elements with data-ogsc. Gmail recolors on its own.
const DARK = `.sm-card{background:${C.ink2} !important;border-color:#3b3866 !important}
.sm-drop{border-color:${C.violet2} !important}
.sm-ink{color:${C.text} !important}
.sm-muted{color:${C.dim} !important}
.sm-link{color:${C.violetHi} !important}
.sm-label{color:${C.violetHi} !important}
.sm-tile{background:${C.ink3} !important;border-color:#5a5690 !important}
.sm-tdrop{border-color:${C.ink} !important}
.sm-digit{background:${C.ink} !important;border-color:#8f7fff !important;color:${C.sun} !important}
.sm-note{background:${C.sun} !important}
.sm-note-h,.sm-note-t{color:${C.ink} !important}
.sm-note-i,.sm-note-a{background:${C.ink} !important;color:${C.sun} !important}`;
const ogsc = (css: string) => css.replace(/(^|\n|,)\.sm-/g, "$1[data-ogsc] .sm-");

const HEAD_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%}
a{text-decoration:none}
@media (max-width:520px){
.sm-gut{padding-left:12px !important;padding-right:12px !important}
.sm-pad{padding:24px 18px 24px !important}
.sm-h1{font-size:26px !important}
.sm-word{font-size:30px !important}
.sm-col{display:block !important;width:100% !important;padding:0 0 12px !important}
.sm-dcell{padding-right:5px !important}
.sm-digit{width:36px !important;height:50px !important;font-size:25px !important;line-height:50px !important}
.sm-band{font-size:16px !important}
}
@media (prefers-color-scheme:dark){
${DARK}
}
${ogsc(DARK)}`;

/** A hard offset drop like the website's box-shadow, made of a right and a bottom border, so Gmail shows it too */
function drop(inner: string, o: { color: string; size: number; radius: number; cls?: string; full?: boolean }): string {
  return `<table ${T}${o.full ? ' width="100%"' : ""}><tr><td${o.cls ? ` class="${o.cls}"` : ""} style="border-right:${o.size}px solid ${o.color};border-bottom:${o.size}px solid ${o.color};border-radius:${o.radius}px">${inner}</td></tr></table>`;
}

function paragraph(line: string, first: boolean): string {
  const size = first ? 18 : 16;
  return `<p class="sm-ink" style="margin:${first ? 0 : 12}px 0 0;font-family:${BODY};font-size:${size}px;line-height:1.55;font-weight:${first ? 600 : 400};color:${C.ink}">${escapeHtml(line)}</p>`;
}

function tile(f: Fact): string {
  const inner = `<table ${T} width="100%"><tr><td class="sm-tile" bgcolor="${C.white}" style="background:${C.white};border:2px solid ${C.ink};border-radius:14px;padding:12px 16px 13px">
<p class="sm-label" style="margin:0 0 3px;font-family:${BODY};font-size:13px;line-height:1.3;font-weight:800;color:${C.violet2}">${escapeHtml(f.label)}</p>
<p class="sm-ink" style="margin:0;font-family:${BODY};font-size:18px;line-height:1.3;font-weight:800;color:${C.ink};word-break:break-word">${escapeHtml(f.value)}</p>
</td></tr></table>`;
  return drop(inner, { color: C.ink, size: 4, radius: 16, cls: "sm-tdrop", full: true });
}

/** Tiles two to a row; on a phone they stack */
function tiles(facts: Fact[]): string {
  const rows: string[] = [];
  for (let i = 0; i < facts.length; i += 2) {
    const a = facts[i]!;
    const b = facts[i + 1];
    rows.push(
      b
        ? `<tr><td class="sm-col" width="50%" valign="top" style="width:50%;padding:0 6px 12px 0">${tile(a)}</td><td class="sm-col" width="50%" valign="top" style="width:50%;padding:0 0 12px 6px">${tile(b)}</td></tr>`
        : `<tr><td class="sm-col" colspan="2" valign="top" style="padding:0 0 12px">${tile(a)}</td></tr>`,
    );
  }
  return `<table ${T} width="100%" style="margin:24px 0 0">${rows.join("")}</table>`;
}

/** The code in large single boxes, plus one line to copy it from (copying table cells adds tabs) */
function codeBoxes(code: string): string {
  const cells = [...code]
    .map(
      (d, i, all) =>
        `<td class="sm-dcell" style="padding-right:${i === all.length - 1 ? 0 : 8}px">${drop(
          `<table ${T}><tr><td class="sm-digit" width="50" height="64" align="center" bgcolor="${C.white}" style="width:50px;height:64px;background:${C.white};border:2.5px solid ${C.ink};border-radius:12px;font-family:${DISPLAY};font-size:34px;line-height:64px;font-weight:900;color:${C.ink};text-align:center">${escapeHtml(d)}</td></tr></table>`,
          { color: C.violet, size: 4, radius: 14, cls: "sm-drop" },
        )}</td>`,
    )
    .join("");
  return `<p class="sm-label" style="margin:26px 0 10px;font-family:${BODY};font-size:13px;line-height:1.3;font-weight:800;color:${C.violet2}">Sign-in code</p>
<table ${T}><tr>${cells}</tr></table>
<p class="sm-muted" style="margin:14px 0 0;font-family:${BODY};font-size:14px;line-height:1.5;color:${C.muted}">To copy it: <span class="sm-ink" style="font-weight:800;letter-spacing:0.16em;color:${C.ink};-webkit-user-select:all;user-select:all">${escapeHtml(code)}</span></p>`;
}

function button(link: { label: string; url: string }): string {
  const href = escapeHtml(link.url);
  const pill = `<table ${T}><tr><td bgcolor="${C.sun}" style="background:${C.sun};border:2.5px solid ${C.ink};border-radius:999px">
<a href="${href}" target="_blank" style="display:inline-block;padding:16px 30px;font-family:${BODY};font-size:17px;line-height:1.2;font-weight:800;color:${C.ink};text-decoration:none;border-radius:999px">${escapeHtml(link.label)} &#8594;</a>
</td></tr></table>`;
  return `<table ${T} style="margin:26px 0 0"><tr><td>${drop(pill, { color: C.violet, size: 5, radius: 999 })}</td></tr></table>
<p class="sm-muted" style="margin:16px 0 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${C.muted}">If the button does not open, copy this link into your browser:<br>
<a class="sm-link" href="${href}" target="_blank" style="color:${C.violet2};text-decoration:underline;word-break:break-all">${href}</a></p>`;
}

/** The "Not you?" box. Security mails also get a way to check the account on the website. */
function notice(text: string, check: string | undefined): string {
  const action = check
    ? `<table ${T} style="margin:14px 0 0"><tr><td class="sm-note-a" bgcolor="${C.sun}" style="background:${C.sun};border-radius:999px;color:${C.ink}">
<a class="sm-note-a" href="${escapeHtml(check)}" target="_blank" style="display:inline-block;padding:10px 18px;font-family:${BODY};font-size:15px;line-height:1.2;font-weight:800;color:${C.ink};text-decoration:none;border-radius:999px;background:${C.sun}">Check your account &#8594;</a>
</td></tr></table>`
    : "";
  return `<table ${T} width="100%" style="margin:26px 0 0"><tr><td class="sm-note" bgcolor="${C.ink}" style="background:${C.ink};border-radius:18px;padding:18px 20px 20px">
<table ${T} width="100%"><tr>
<td width="34" valign="top" style="width:34px;padding:0 12px 0 0"><table ${T}><tr><td class="sm-note-i" width="32" height="32" align="center" bgcolor="${C.sun}" style="width:32px;height:32px;border-radius:50%;background:${C.sun};font-family:${DISPLAY};font-size:19px;line-height:32px;font-weight:900;color:${C.ink};text-align:center">!</td></tr></table></td>
<td valign="top">
<p class="sm-note-h" style="margin:2px 0 0;font-family:${DISPLAY};font-size:19px;line-height:1.2;font-weight:900;color:${C.sun}">Not you?</p>
<p class="sm-note-t" style="margin:6px 0 0;font-family:${BODY};font-size:15px;line-height:1.5;font-weight:600;color:${C.text}">${escapeHtml(text)}</p>
${action}
</td></tr></table>
</td></tr></table>`;
}

/** The website's yellow ticker: the mail's kind and the name, between four-point stars */
function band(tag: string): string {
  const star = `<span style="color:${C.violet2}">&#10022;</span>`;
  const words = Array.from({ length: 4 }, () => `${escapeHtml(tag)} ${star} ${escapeHtml(SIGNOFF)} ${star}`).join(" ");
  return `<table ${T} width="100%" style="table-layout:fixed"><tr><td bgcolor="${C.sun}" style="background:${C.sun};border-top:2.5px solid ${C.ink};border-bottom:2.5px solid ${C.ink};box-shadow:0 7px 0 rgba(0,0,0,0.35)">
<div class="sm-band" style="white-space:nowrap;overflow:hidden;padding:13px 0 12px;text-indent:-34px;font-family:${DISPLAY};font-size:19px;line-height:1.1;font-weight:900;color:${C.ink}">${words}</div>
</td></tr></table>`;
}

/** The website's paper panel: ink outline and a hard violet drop */
function card(inner: string): string {
  const panel = `<table ${T} width="100%"><tr><td class="sm-card sm-pad" bgcolor="${C.paper}" style="background:${C.paper};border:2.5px solid ${C.ink};border-radius:24px;padding:32px 32px 32px">${inner}</td></tr></table>`;
  return drop(panel, { color: C.violet, size: 8, radius: 26, cls: "sm-drop", full: true });
}

function footPill(label: string, url: string): string {
  return `<td style="padding:0 8px 8px 0"><table ${T}><tr><td style="border:1.5px solid ${C.edge};border-radius:999px"><a href="${escapeHtml(url)}" target="_blank" style="display:inline-block;padding:8px 14px;font-family:${BODY};font-size:13px;line-height:1.2;font-weight:700;color:${C.text};text-decoration:none">${escapeHtml(label)}</a></td></tr></table></td>`;
}

function layout(c: Content, base: string, to: string | undefined, check: string | undefined): string {
  const site = base.replace(/^https?:\/\//, "");
  const body = [
    ...c.lines.map((l, i) => paragraph(l, i === 0)),
    c.code ? codeBoxes(c.code) : "",
    c.facts?.length ? tiles(c.facts) : "",
    c.link ? button(c.link) : "",
    c.notice ? notice(c.notice, check) : "",
  ].join("\n");
  const foot = (html: string, top: number) =>
    `<p style="margin:${top}px 0 0;font-family:${BODY};font-size:14px;line-height:1.6;color:${C.dim}">${html}</p>`;
  const sentTo = to
    ? `Sent by ${escapeHtml(SIGNOFF)} to <span style="color:${C.text};font-weight:700">${escapeHtml(to)}</span>.`
    : `Sent by ${escapeHtml(SIGNOFF)}.`;
  const dots = `background-image:radial-gradient(circle,rgba(111,92,255,0.22) 0 1.5px,transparent 1.6px);background-size:11px 11px`;
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
<table ${T} width="100%" bgcolor="${C.ink}" style="background-color:${C.ink};${dots}">
<tr><td height="5" bgcolor="${C.violet}" style="height:5px;line-height:5px;font-size:0;background:${C.violet};background-image:${LOGO_GRADIENT_WIDE}">&nbsp;</td></tr>
<tr><td align="center" class="sm-gut" style="padding:24px 16px 0">
<!--[if mso]><table ${T} width="600"><tr><td><![endif]-->
<table ${T} width="100%" style="max-width:600px"><tr><td><table ${T}><tr>
<td width="38" height="38" align="center" bgcolor="${C.violet}" style="width:38px;height:38px;border-radius:11px;background:${C.violet};background-image:${LOGO_GRADIENT};font-family:${DISPLAY};font-size:23px;line-height:38px;font-weight:900;color:#ffffff;text-align:center">S</td>
<td style="padding-left:12px;font-family:${DISPLAY};font-size:19px;line-height:38px;font-weight:900;letter-spacing:-0.01em;color:${C.text}">${escapeHtml(SIGNOFF)}</td>
</tr></table></td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
<tr><td style="padding:24px 0 0">${band(c.tag)}</td></tr>
<tr><td align="center" class="sm-gut" style="padding:36px 16px 44px">
<!--[if mso]><table ${T} width="600"><tr><td><![endif]-->
<table ${T} width="100%" style="max-width:600px">
<tr><td style="padding:0 0 28px">
<table ${T} width="100%"><tr>
<td valign="middle"><table ${T} style="transform:rotate(-3deg)"><tr><td bgcolor="${C.sun}" style="background:${C.sun};border:2px solid ${C.ink};border-radius:999px;box-shadow:3px 3px 0 ${C.violet};padding:7px 15px 8px;font-family:${DISPLAY};font-size:15px;line-height:1.1;font-weight:900;color:${C.ink}">${escapeHtml(c.tag)}</td></tr></table></td>
<td align="right" valign="middle" style="font-family:${DISPLAY};line-height:1;text-align:right"><span style="font-size:22px;color:${C.violet}">&#10022;</span>&nbsp;<span style="font-size:40px;color:${C.sun}">&#10022;</span></td>
</tr></table>
<h1 class="sm-h1" style="margin:20px 0 0;font-family:${DISPLAY};font-size:38px;line-height:1.08;font-weight:900;letter-spacing:-0.012em;color:${C.text}">${escapeHtml(c.subject)}</h1>
<table ${T} style="margin:16px 0 0"><tr><td width="120" height="6" bgcolor="${C.sun}" style="width:120px;height:6px;line-height:6px;font-size:0;border-radius:6px;background:${C.sun}">&nbsp;</td></tr></table>
</td></tr>
<tr><td>${card(body)}</td></tr>
<tr><td style="padding:46px 2px 0">
<p class="sm-word" style="margin:0;font-family:${DISPLAY};font-size:42px;line-height:1;font-weight:900;letter-spacing:-0.02em;color:${C.text}">${escapeHtml(SIGNOFF)}</p>
${foot(escapeHtml(c.reason), 18)}
${foot(sentTo, 4)}
<table ${T} style="margin:18px 0 0"><tr>${footPill(site, base)}${footPill("Discord", DISCORD)}${footPill("Ko-fi", KOFI)}</tr></table>
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table>
</body>
</html>`;
}

/** Renders one mail. `to` (the recipient) only goes into the footer. */
export function renderMail(env: Env, mail: Mail, to?: string): { subject: string; text: string; html: string } {
  const c = content(env, mail, formatTime(Math.floor(Date.now() / 1000)));
  const base = env.WEB_BASE_URL;
  const check = c.reason === SECURITY_REASON ? `${base}/account/` : undefined;
  const text = [
    ...c.lines,
    ...(c.code ? [`Sign-in code: ${c.code}`] : []),
    ...(c.facts ?? []).map((f) => `${f.label}: ${f.value}`),
    ...(c.link ? [`${c.link.label}: ${c.link.url}`] : []),
    ...(c.notice ? [c.notice] : []),
    ...(check ? [`Check your account: ${check}`] : []),
    [
      to ? `Sent by ${SIGNOFF} to ${to}.` : `Sent by ${SIGNOFF}.`,
      c.reason,
      base,
      `Discord: ${DISCORD}`,
      `Ko-fi: ${KOFI}`,
    ].join("\n"),
  ].join("\n\n");
  return { subject: c.subject, text, html: layout(c, base, to, check) };
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
