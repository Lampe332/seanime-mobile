/**
 * Transactional mail through the Cloudflare Email Service binding (`EMAIL`).
 * Mails never contain synced data or keys. Links carry tokens in the URL fragment,
 * so they do not reach server logs or Referer headers of the website.
 * Every mail goes out as HTML and as plain text with the same content. The HTML loads nothing from anywhere:
 * no remote images, fonts, scripts or tracking. The one image, the app icon, travels inside the mail as an
 * inline attachment (cid:). Its links go to the website, the Discord server and Ko-fi.
 */

import { LOGO_PNG_BASE64 } from "./logo";

export const MAIL_FROM = { email: "no-reply@seanimemobile.com", name: "Seanime Mobile" };

/** Content-ID of the inline app icon; the HTML shows it with src="cid:…" */
export const LOGO_CID = "seanime-logo";

/** The app icon as an inline attachment (decoded per send: a fresh buffer for every message) */
export function logoAttachment() {
  const bytes = Uint8Array.from(atob(LOGO_PNG_BASE64), (c) => c.charCodeAt(0));
  return { filename: "seanime-mobile.png", content: bytes.buffer, type: "image/png", disposition: "inline" as const, contentId: LOGO_CID };
}

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
  | { kind: "web_edit_on" }
  | { kind: "web_edit_off" }
  | { kind: "web_unlocked"; method: WebUnlockMethod }
  | { kind: "inactivity"; deleteAt: number };

/** How the website showed the owner before it proved the key (web/unlock) */
export type WebUnlockMethod = "password" | "recovery" | "code";

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
      | "code_only_off"
      | "web_edit_on"
      | "web_edit_off"
      | "web_unlocked";
  }
>;

interface Fact {
  label: string;
  value: string;
}

interface Content {
  subject: string;
  /** What kind of mail this is, shown in the band */
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
          "Someone asked to sign in to your Seanime Mobile account with a code. Type it in the app or on the website, wherever you asked for it.",
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
    case "web_edit_on":
      return {
        subject: "Edit on the website was turned on",
        tag: "Security",
        lines: [
          "You can now unlock your synced Seanime Mobile settings on the website and change them there.",
          "While they are unlocked, your browser holds the key to your synced data. You get an email every time that happens.",
        ],
        facts: [at, { label: "Turn it off in", value: "Settings > Account" }],
        notice: "If this was not you, turn it off in Settings > Account on one of your devices and change your password.",
        reason: SECURITY_REASON,
      };
    case "web_edit_off":
      return {
        subject: "Edit on the website was turned off",
        tag: "Security",
        lines: [
          "The website can no longer unlock your synced data. Only your devices hold the key now.",
          "If your settings were unlocked on the website, they are locked now.",
        ],
        facts: [at, { label: "Edit on the website", value: "Off" }],
        notice: "If this was not you, check your devices and change your password.",
        reason: SECURITY_REASON,
      };
    case "web_unlocked":
      return {
        subject: "Your synced data was unlocked on the website",
        tag: "Website",
        lines: [
          "Someone unlocked your synced Seanime Mobile data on the website to see and change your settings.",
          "It locks again after 30 minutes at the latest.",
        ],
        facts: [
          at,
          { label: "Unlocked with", value: mail.method === "password" ? "Password" : mail.method === "recovery" ? "Recovery code" : "Email code" },
          { label: "Locks after", value: "30 minutes at the latest" },
        ],
        notice: "If this was not you, turn off Edit on the website in Settings > Account and change your password.",
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

// Colors and type from the website (seanimemobile.com, assets/css/style.css): ink ground, violet, one yellow.
// No web fonts: both stacks name the website's faces first and fall back to system faces.
//
// Dark mode. The mail is dark by design, like the website, so mail apps find little to recolor:
// - Gmail on Android ignores color-scheme and prefers-color-scheme and recolors on its own: light backgrounds turn
//   dark, dark text turns light, dark backgrounds and light text stay (partial inversion; Litmus, quoted in
//   courier.com/blog/dark-mode-email-design). So every background here is dark and every text is light. The one light
//   fill, the yellow bar, is a one-color linear-gradient, which Gmail leaves alone (html-email-guide.vercel.app).
// - Dark fills are left unprotected on purpose. Gmail on iOS inverts everything, text included: an unprotected dark
//   background turns light together with its text, while a protected one would stay dark under darkened text.
// - Apple Mail, iOS Mail and Outlook.com read color-scheme "light dark" and keep the colors as they are.
// Layout: phone first in the inline styles (Gmail with a non-Google account drops <style>), larger sizes from 521px.
const C = {
  ink: "#0b0a1c",
  /** the one panel */
  card: "#17153a",
  /** rows and dividers inside the panel */
  line: "#2e2a66",
  violet: "#6f5cff",
  /** button and band fill: dark enough that no mail app recolors it; white text on it is 8.9:1 */
  deep: "#3f30c8",
  violetHi: "#b3a9ff",
  sun: "#ffd938",
  white: "#fffdf7",
  text: "#f6f1e7",
  dim: "#c9c4d6",
};
const DISPLAY = "'Dela Gothic One','Arial Black','Segoe UI Black',Helvetica,Arial,sans-serif";
const BODY = "Figtree,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const T = 'role="presentation" cellpadding="0" cellspacing="0" border="0"';
/** The logo's gradient; mail apps without CSS gradients show the flat violet bgcolor instead */
const LOGO_GRADIENT = "linear-gradient(135deg,#8b3cff 0%,#d23cf0 55%,#ff4d7a 100%)";
const LOGO_GRADIENT_WIDE = "linear-gradient(90deg,#8b3cff 0%,#d23cf0 55%,#ff4d7a 100%)";
/** A light fill that Gmail's dark mode must not darken: bgcolor for Outlook, the same color as a gradient for the rest */
const keep = (color: string) => `background-color:${color};background-image:linear-gradient(${color},${color})`;

const HEAD_CSS = `:root{color-scheme:light dark;supported-color-schemes:light dark}
body{margin:0;padding:0;-webkit-text-size-adjust:100%;background:${C.ink}}
a{text-decoration:none}
@media (min-width:521px){
.sm-gut{padding-left:16px !important;padding-right:16px !important}
.sm-pad{padding:38px 40px 40px !important}
.sm-px{padding-left:40px !important;padding-right:40px !important}
.sm-h1{font-size:34px !important}
.sm-band{font-size:18px !important;padding:13px 0 12px !important}
.sm-btnw{width:auto !important}
.sm-btn{padding:16px 36px !important}
.sm-dcell{padding-right:10px !important}
.sm-digit{width:52px !important;height:64px !important;font-size:34px !important;line-height:64px !important}
.sm-word{font-size:30px !important}
}
@media (max-width:359px){
.sm-dcell{padding-right:4px !important}
.sm-digit{width:36px !important;height:48px !important;font-size:24px !important;line-height:48px !important}
}`;

function paragraph(line: string, first: boolean): string {
  return `<p style="margin:${first ? 20 : 14}px 0 0;font-family:${BODY};font-size:16px;line-height:1.6;font-weight:${first ? 600 : 400};color:${C.text}">${escapeHtml(line)}</p>`;
}

/** Values worth seeing at a glance, as label and value rows */
function facts(list: Fact[]): string {
  const rows = list
    .map((f) => {
      const edge = `border-top:1px solid ${C.line}`;
      return `<tr><td width="40%" valign="top" style="width:40%;padding:12px 12px 12px 0;${edge};font-family:${BODY};font-size:14px;line-height:1.45;color:${C.dim}">${escapeHtml(f.label)}</td><td valign="top" style="padding:12px 0;${edge};font-family:${BODY};font-size:16px;line-height:1.45;font-weight:700;color:${C.text};word-break:break-word">${escapeHtml(f.value)}</td></tr>`;
    })
    .join("");
  return `<table ${T} width="100%" style="margin:26px 0 0;border-collapse:collapse">${rows}</table>`;
}

/** The code in large single boxes, plus one line to copy it from (copying table cells adds tabs) */
function codeBoxes(code: string): string {
  const cells = [...code]
    .map(
      (d, i, all) =>
        `<td${i === all.length - 1 ? "" : ` class="sm-dcell" style="padding-right:6px"`}><table ${T}><tr><td class="sm-digit" width="40" height="54" align="center" bgcolor="${C.ink}" style="width:40px;height:54px;background:${C.ink};border:2px solid ${C.violet};border-radius:10px;font-family:${DISPLAY};font-size:28px;line-height:54px;font-weight:900;color:${C.sun};text-align:center">${escapeHtml(d)}</td></tr></table></td>`,
    )
    .join("");
  return `<p style="margin:26px 0 10px;font-family:${BODY};font-size:14px;line-height:1.3;font-weight:700;color:${C.violetHi}">Sign-in code</p>
<table ${T}><tr>${cells}</tr></table>
<p style="margin:14px 0 0;font-family:${BODY};font-size:14px;line-height:1.5;color:${C.dim}">To copy it: <span style="font-weight:800;letter-spacing:0.16em;color:${C.text};-webkit-user-select:all;user-select:all">${escapeHtml(code)}</span></p>`;
}

/** Full width on a phone, sized to its label from 521px; the label never wraps */
function button(link: { label: string; url: string }): string {
  const href = escapeHtml(link.url);
  return `<table ${T} width="100%" class="sm-btnw" style="margin:28px 0 0"><tr><td align="center" bgcolor="${C.deep}" style="background:${C.deep};border-radius:999px">
<a class="sm-btn" href="${href}" target="_blank" style="display:block;padding:16px 22px;font-family:${BODY};font-size:17px;line-height:1.2;font-weight:800;color:${C.white};text-decoration:none;text-align:center;white-space:nowrap;border-radius:999px">${escapeHtml(link.label)}&nbsp;&#8594;</a>
</td></tr></table>
<p style="margin:16px 0 0;font-family:${BODY};font-size:13px;line-height:1.5;color:${C.dim}">If the button does not open, copy this link into your browser:<br>
<a href="${href}" target="_blank" style="color:${C.violetHi};text-decoration:underline;word-break:break-all">${href}</a></p>`;
}

/** The "Not you?" part, set apart by a divider. Security mails also get a way to check the account on the website. */
function notice(text: string, check: string | undefined): string {
  const action = check
    ? `<p style="margin:12px 0 0;font-family:${BODY};font-size:15px;line-height:1.4;font-weight:800"><a href="${escapeHtml(check)}" target="_blank" style="color:${C.sun};text-decoration:underline;white-space:nowrap">Check your account&nbsp;&#8594;</a></p>`
    : "";
  return `<table ${T} width="100%" style="margin:30px 0 0"><tr><td style="padding:22px 0 0;border-top:2px solid ${C.line}">
<p style="margin:0;font-family:${BODY};font-size:17px;line-height:1.3;font-weight:800;color:${C.sun}">&#10022;&nbsp;Not you?</p>
<p style="margin:6px 0 0;font-family:${BODY};font-size:15px;line-height:1.55;color:${C.text}">${escapeHtml(text)}</p>
${action}
</td></tr></table>`;
}

/** The website's ticker: the mail's kind and the name, between four-point stars */
function band(tag: string): string {
  const star = `<span style="color:${C.sun}">&#10022;</span>`;
  const words = Array.from({ length: 4 }, () => `${escapeHtml(tag)} ${star} ${escapeHtml(SIGNOFF)} ${star}`).join(" ");
  return `<table ${T} width="100%" style="table-layout:fixed"><tr><td bgcolor="${C.deep}" style="background:${C.deep}">
<div class="sm-band" style="white-space:nowrap;overflow:hidden;padding:11px 0 10px;text-indent:-30px;font-family:${DISPLAY};font-size:15px;line-height:1.1;font-weight:900;color:${C.white}">${words}</div>
</td></tr></table>`;
}

function footLink(label: string, url: string): string {
  return `<a href="${escapeHtml(url)}" target="_blank" style="color:${C.violetHi};font-weight:700;text-decoration:none;white-space:nowrap">${escapeHtml(label)}</a>`;
}

function layout(c: Content, base: string, to: string | undefined, check: string | undefined): string {
  const site = base.replace(/^https?:\/\//, "");
  const body = [
    `<h1 class="sm-h1" style="margin:0;font-family:${DISPLAY};font-size:25px;line-height:1.15;font-weight:900;letter-spacing:-0.01em;color:${C.text}">${escapeHtml(c.subject)}</h1>`,
    `<table ${T} style="margin:16px 0 0"><tr><td width="64" height="5" style="width:64px;height:5px;line-height:5px;font-size:0;border-radius:5px;${keep(C.sun)}">&nbsp;</td></tr></table>`,
    ...c.lines.map((l, i) => paragraph(l, i === 0)),
    c.code ? codeBoxes(c.code) : "",
    c.facts?.length ? facts(c.facts) : "",
    c.link ? button(c.link) : "",
    c.notice ? notice(c.notice, check) : "",
  ].join("\n");
  const foot = (html: string, top: number) =>
    `<p style="margin:${top}px 0 0;font-family:${BODY};font-size:14px;line-height:1.6;color:${C.dim};word-break:break-word">${html}</p>`;
  const sentTo = to
    ? `Sent by ${escapeHtml(SIGNOFF)} to <span style="color:${C.text};font-weight:700">${escapeHtml(to)}</span>.`
    : `Sent by ${escapeHtml(SIGNOFF)}.`;
  const dot = `<span style="color:${C.dim}">&nbsp;&nbsp;&#183;&nbsp;&nbsp;</span>`;
  const wide = (inner: string, pad: string) =>
    `<tr><td align="center" class="sm-gut" style="padding:${pad}">
<!--[if mso]><table ${T} width="600"><tr><td><![endif]-->
<table ${T} width="100%" style="max-width:600px">${inner}</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>`;
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
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:${C.text}">${escapeHtml(c.lines[0] ?? c.subject)}</div>
<table ${T} width="100%" bgcolor="${C.ink}" style="background-color:${C.ink}">
<tr><td height="4" bgcolor="${C.violet}" style="height:4px;line-height:4px;font-size:0;background:${C.violet};background-image:${LOGO_GRADIENT_WIDE}">&nbsp;</td></tr>
${wide(
  `<tr><td class="sm-px" style="padding:0 20px"><table ${T}><tr>
<td width="34" height="34" align="center" bgcolor="${C.violet}" style="width:34px;height:34px;border-radius:9px;background:${C.violet};background-image:${LOGO_GRADIENT}"><img src="cid:${LOGO_CID}" width="34" height="34" alt="" style="display:block;width:34px;height:34px;border:0;border-radius:9px"></td>
<td style="padding-left:11px;font-family:${DISPLAY};font-size:18px;line-height:34px;font-weight:900;letter-spacing:-0.01em;color:${C.text}">${escapeHtml(SIGNOFF)}</td>
</tr></table></td></tr>`,
  "20px 10px 0",
)}
<tr><td style="padding:20px 0 0">${band(c.tag)}</td></tr>
${wide(
  `<tr><td class="sm-pad" bgcolor="${C.card}" style="background:${C.card};border-radius:20px;padding:26px 20px 28px">
${body}
</td></tr>
<tr><td class="sm-px" style="padding:34px 20px 0">
<p class="sm-word" style="margin:0;font-family:${DISPLAY};font-size:24px;line-height:1.1;font-weight:900;letter-spacing:-0.015em;color:${C.text}">${escapeHtml(SIGNOFF)}</p>
${foot(escapeHtml(c.reason), 12)}
${foot(sentTo, 4)}
<p style="margin:14px 0 0;font-family:${BODY};font-size:14px;line-height:1.9">${footLink(site, base)}${dot}${footLink("Discord", DISCORD)}${dot}${footLink("Ko-fi", KOFI)}</p>
</td></tr>`,
  "24px 10px 40px",
)}
</table>
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
  await env.DB.prepare("INSERT INTO account_events (user_id, kind, method, device_name, at) VALUES (?, ?, ?, ?, ?)")
    .bind(
      userId,
      mail.kind,
      "method" in mail ? mail.method : null,
      "deviceName" in mail ? mail.deviceName : null,
      Math.floor(Date.now() / 1000),
    )
    .run();
  await sendMail(env, to, mail);
}

/**
 * Events the account lists without a mail: sign-ins, a password reset (its mail is "password_changed"), a confirmed email,
 * sessions ended from the session list, the first save of settings on the website after an unlock (its mail was
 * "web_unlocked"). GET account keeps the security events ahead of the frequent "signed_in".
 */
export type ActivityEvent =
  | { kind: "signed_in"; method: "password" | "code" | "google"; sigKey: { alg: string; pub: string } }
  | { kind: "password_reset" }
  | { kind: "sessions_signed_out"; deviceName: string | null }
  | { kind: "web_settings_changed" };

/**
 * The statement that keeps an activity event (for a batch). A sign-in names the device whose live row carries the signing
 * key (the app keeps its key across sign-ins); the website and a new device have none.
 */
export function eventStatement(env: Env, userId: string, event: ActivityEvent): D1PreparedStatement {
  const t = Math.floor(Date.now() / 1000);
  if (event.kind === "signed_in") {
    return env.DB.prepare(
      `INSERT INTO account_events (user_id, kind, method, device_name, at) VALUES (?1, 'signed_in', ?2,
         (SELECT name FROM devices WHERE user_id = ?1 AND sig_alg = ?3 AND sig_pub = ?4 AND signed_out_at IS NULL LIMIT 1), ?5)`,
    ).bind(userId, event.method, event.sigKey.alg, event.sigKey.pub, t);
  }
  return env.DB.prepare("INSERT INTO account_events (user_id, kind, device_name, at) VALUES (?, ?, ?, ?)").bind(
    userId,
    event.kind,
    "deviceName" in event ? event.deviceName : null,
    t,
  );
}

/**
 * Sends one mail. Delivery problems never fail the request that triggered it:
 * the error code is logged (no address, no token) and the caller continues.
 */
export async function sendMail(env: Env, to: string, mail: Mail): Promise<boolean> {
  const { subject, text, html } = renderMail(env, mail, to);
  try {
    await env.EMAIL.send({ to, from: MAIL_FROM, subject, text, html, attachments: [logoAttachment()] });
    return true;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? (err as Error)?.name ?? "unknown";
    console.error(JSON.stringify({ msg: "mail_failed", kind: mail.kind, code }));
    return false;
  }
}
