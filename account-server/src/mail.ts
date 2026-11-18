/**
 * Transactional mail through the Cloudflare Email Service binding (`EMAIL`).
 * Mails never contain synced data or keys. Links carry tokens in the URL fragment,
 * so they do not reach server logs or Referer headers of the website.
 */

export const MAIL_FROM = { email: "no-reply@seanimemobile.com", name: "Seanime Mobile" };

export type Mail =
  | { kind: "verify"; token: string }
  | { kind: "reset"; token: string }
  | { kind: "new_device"; deviceName: string }
  | { kind: "password_changed" }
  | { kind: "account_deleted" }
  | { kind: "start_fresh" }
  | { kind: "google_linked" }
  | { kind: "google_unlinked" }
  | { kind: "recovery_changed" }
  | { kind: "key_rotated" }
  | { kind: "inactivity"; deleteAt: number };

interface Content {
  subject: string;
  lines: string[];
  link?: { label: string; url: string };
}

const SIGNOFF = "Seanime Mobile";

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
          "If you did not sign up, you can ignore this mail. The account is removed after 7 days.",
        ],
        link: { label: "Confirm email", url: `${base}/account/verify/#token=${mail.token}` },
      };
    case "reset":
      return {
        subject: "Reset your password",
        lines: [
          "Someone asked to reset the password of your Seanime Mobile account.",
          "The link works for 30 minutes and only once.",
          "If this was not you, ignore this mail. Your password stays the same.",
        ],
        link: { label: "Reset password", url: `${base}/account/reset/#token=${mail.token}` },
      };
    case "new_device":
      return {
        subject: "New device signed in",
        lines: [
          `A device was added to your account: ${mail.deviceName}.`,
          "If this was not you, remove the device in your account settings and change your password.",
        ],
      };
    case "password_changed":
      return {
        subject: "Your password was changed",
        lines: [
          "The password of your Seanime Mobile account was changed. Other devices were signed out.",
          "If this was not you, reset your password right away.",
        ],
      };
    case "account_deleted":
      return {
        subject: "Your account was deleted",
        lines: [
          "Your Seanime Mobile account and all synced data were deleted.",
          "The app keeps working on your devices with the data stored there.",
        ],
      };
    case "start_fresh":
      return {
        subject: "Your synced data was reset",
        lines: [
          "Someone chose Start fresh for your Seanime Mobile account.",
          "All synced data was deleted, every other device was removed and signed out, and a new key was created.",
          "If this was not you, reset your password right away and remove any device you do not know.",
        ],
      };
    case "google_linked":
      return {
        subject: "Google sign-in was added",
        lines: [
          "A Google account was linked to your Seanime Mobile account. It can now be used to sign in.",
          "If this was not you, open your account settings, choose Disconnect Google and change your password.",
        ],
      };
    case "google_unlinked":
      return {
        subject: "Google sign-in was removed",
        lines: [
          "The Google account linked to your Seanime Mobile account was disconnected. Sign in with your email and password.",
          "If this was not you, change your password right away.",
        ],
      };
    case "recovery_changed":
      return {
        subject: "Your recovery code was changed",
        lines: [
          "A new recovery code was saved for your Seanime Mobile account. The old one no longer works.",
          "If this was not you, remove any device you do not know and change your password.",
        ],
      };
    case "key_rotated":
      return {
        subject: "Your account key was changed",
        lines: [
          "One of your devices switched your Seanime Mobile account to a new key, for example after a device was removed.",
          "Your other devices pick it up on their own. If you did not remove a device, check your device list.",
        ],
      };
    case "inactivity":
      return {
        subject: "Your account will be deleted soon",
        lines: [
          "Your Seanime Mobile account has not been used for 180 days.",
          `It will be deleted with all synced data on ${formatDate(mail.deleteAt)}.`,
          "To keep it, open the app while signed in or sign in on the website.",
        ],
      };
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function renderMail(env: Env, mail: Mail): { subject: string; text: string; html: string } {
  const c = content(env, mail);
  const text = [...c.lines, ...(c.link ? [`${c.link.label}: ${c.link.url}`] : []), "", SIGNOFF].join("\n\n");
  const html = [
    ...c.lines.map((l) => `<p>${escapeHtml(l)}</p>`),
    ...(c.link ? [`<p><a href="${escapeHtml(c.link.url)}">${escapeHtml(c.link.label)}</a></p>`] : []),
    `<p>${SIGNOFF}</p>`,
  ].join("\n");
  return { subject: c.subject, text, html };
}

/**
 * Sends one mail. Delivery problems never fail the request that triggered it:
 * the error code is logged (no address, no token) and the caller continues.
 */
export async function sendMail(env: Env, to: string, mail: Mail): Promise<boolean> {
  const { subject, text, html } = renderMail(env, mail);
  try {
    await env.EMAIL.send({ to, from: MAIL_FROM, subject, text, html });
    return true;
  } catch (err) {
    const code = (err as { code?: string })?.code ?? (err as Error)?.name ?? "unknown";
    console.error(JSON.stringify({ msg: "mail_failed", kind: mail.kind, code }));
    return false;
  }
}
