import { errorResponse, finalize, HttpError, preflight } from "./http";
import { cleanup } from "./cron";
import * as approval from "./approval";
import * as code from "./codelogin";
import * as id from "./identity";
import { rotate } from "./rotate";
import { MAX_JSON_BYTES } from "./http";
import { MAX_BODY_BYTES, withBodyDigest } from "./signature";
import { precheckSession } from "./session";
import { fixedWindow, rateKey, WEB_UPLOAD_LIMIT } from "./ratelimit";
import * as r from "./routes";
import * as websync from "./websync";

type Handler = (ctx: r.Ctx) => Promise<Response>;

/** N-2: the only routes that take more than a JSON body; only an existing session with signature headers may send one. */
const UPLOAD_LIMITS: Record<string, number> = {
  "PUT /v1/sync/snapshot": r.MAX_SNAPSHOT_BYTES,
  "POST /v1/account/rotate": MAX_BODY_BYTES,
};

const routes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  ["POST", /^\/v1\/auth\/prelogin$/, r.prelogin],
  ["POST", /^\/v1\/auth\/signup$/, r.signup],
  ["POST", /^\/v1\/auth\/login$/, r.login],
  ["POST", /^\/v1\/auth\/login\/confirm$/, id.confirmLogin],
  ["POST", /^\/v1\/auth\/logout$/, r.logout],
  ["POST", /^\/v1\/auth\/verify$/, id.verifyEmail],
  ["POST", /^\/v1\/auth\/verify\/resend$/, id.resendVerification],
  ["POST", /^\/v1\/auth\/reset-request$/, id.resetRequest],
  ["POST", /^\/v1\/auth\/reset\/info$/, id.resetInfo],
  ["POST", /^\/v1\/auth\/reset$/, id.resetPassword],
  ["POST", /^\/v1\/auth\/code\/request$/, code.codeRequest],
  ["POST", /^\/v1\/auth\/code\/login$/, code.codeLogin],
  ["POST", /^\/v1\/auth\/google\/nonce$/, id.googleNonce],
  ["POST", /^\/v1\/auth\/google$/, id.googleLogin],
  ["GET", /^\/v1\/sessions$/, r.listSessions],
  ["DELETE", /^\/v1\/sessions\/others$/, r.signOutOthers],
  ["DELETE", /^\/v1\/sessions\/(?<id>[^/]+)$/, r.deleteSession],
  ["GET", /^\/v1\/devices$/, r.listDevices],
  ["POST", /^\/v1\/devices\/requests$/, approval.createRequest],
  ["GET", /^\/v1\/devices\/requests$/, approval.listRequests],
  ["GET", /^\/v1\/devices\/requests\/(?<id>[^/]+)$/, approval.getRequest],
  ["POST", /^\/v1\/devices\/requests\/(?<id>[^/]+)\/nonce$/, approval.postNonce],
  ["POST", /^\/v1\/devices\/requests\/(?<id>[^/]+)\/reveal$/, approval.postReveal],
  ["POST", /^\/v1\/devices\/requests\/(?<id>[^/]+)\/approve$/, approval.approveRequest],
  ["POST", /^\/v1\/devices\/requests\/(?<id>[^/]+)\/deny$/, approval.denyRequest],
  ["DELETE", /^\/v1\/devices\/(?<id>[^/]+)$/, r.deleteDevice],
  ["PUT", /^\/v1\/account\/keys$/, r.putKeys],
  ["GET", /^\/v1\/account\/keys\/device$/, r.getDeviceKey],
  ["POST", /^\/v1\/account\/start-fresh$/, r.startFresh],
  ["POST", /^\/v1\/account\/password$/, r.changePassword],
  ["POST", /^\/v1\/account\/password\/after-code$/, code.passwordAfterCode],
  ["PUT", /^\/v1\/account\/escrow$/, code.putEscrow],
  ["DELETE", /^\/v1\/account\/escrow$/, code.deleteEscrow],
  ["PUT", /^\/v1\/account\/web-access$/, websync.putWebAccess],
  ["DELETE", /^\/v1\/account\/web-access$/, websync.deleteWebAccess],
  ["POST", /^\/v1\/web\/unlock$/, websync.webUnlock],
  ["POST", /^\/v1\/web\/key$/, websync.webKey],
  ["POST", /^\/v1\/web\/lock$/, websync.webLock],
  ["POST", /^\/v1\/account\/rotate$/, rotate],
  ["POST", /^\/v1\/account\/link-google$/, id.linkGoogle],
  ["POST", /^\/v1\/account\/unlink-google$/, id.unlinkGoogle],
  ["GET", /^\/v1\/account$/, r.getAccount],
  ["DELETE", /^\/v1\/account$/, r.deleteAccount],
  ["GET", /^\/v1\/sync\/meta$/, r.syncMeta],
  ["GET", /^\/v1\/sync\/snapshot$/, r.getSnapshot],
  ["PUT", /^\/v1\/sync\/snapshot$/, r.putSnapshot],
  ["DELETE", /^\/v1\/sync$/, r.deleteSync],
];

async function handle(request: Request, env: Env, isBrowser: boolean, exec: ExecutionContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  let pathMatched = false;
  for (const [method, pattern, handler] of routes) {
    const m = pattern.exec(pathname);
    if (!m) continue;
    pathMatched = true;
    if (method !== request.method) continue;
    // N-2: before any byte is read, the declared size must fit the route; large bodies only on the upload routes and
    // only with an existing session and well-formed signature headers. Then the body is read once (bounded) so its
    // hash can be checked against the request signature (signature.ts).
    const upload = UPLOAD_LIMITS[`${method} ${pathname}`];
    if (upload !== undefined) {
      // NEU-11: the account's upload counter is counted before a byte of the body is read, so even a valid token of an
      // own free account reads at most UPLOAD_LIMIT large bodies per hour.
      const { userId, web: fromWebsite } = await precheckSession(request, env);
      // Website sessions: their own counter first on every upload route (snapshot and rotate), so they never use up more
      // than WEB_UPLOAD_LIMIT of the account's counter, which the devices need for their sync.
      if (fromWebsite) {
        await fixedWindow(env, await rateKey(env, "web-upload", userId), WEB_UPLOAD_LIMIT, r.HOUR);
      }
      await fixedWindow(env, await rateKey(env, "upload", userId), r.UPLOAD_LIMIT, r.HOUR);
    }
    const req = await withBodyDigest(request, upload ?? MAX_JSON_BYTES);
    return handler({ request: req, env, isBrowser, params: { ...m.groups }, waitUntil: (p) => exec.waitUntil(p) });
  }
  throw pathMatched ? new HttpError(405, "method_not_allowed") : new HttpError(404, "not_found");
}

export default {
  async fetch(request, env, exec): Promise<Response> {
    const origin = request.headers.get("Origin");
    // CORS: only the website may call from a browser. Requests without Origin come from the app.
    if (origin !== null && origin !== env.ALLOWED_ORIGIN) {
      return finalize(errorResponse(new HttpError(403, "origin_not_allowed")), null);
    }
    const corsOrigin = origin;
    if (request.method === "OPTIONS") return finalize(preflight(), corsOrigin);
    try {
      return finalize(await handle(request, env, origin !== null, exec), corsOrigin);
    } catch (err) {
      if (err instanceof HttpError) return finalize(errorResponse(err), corsOrigin);
      // Never log bodies, tokens or emails: only the route and the error type.
      console.error(
        JSON.stringify({ msg: "unhandled", path: new URL(request.url).pathname, error: (err as Error)?.name ?? "unknown" }),
      );
      return finalize(errorResponse(new HttpError(500, "internal_error", "Internal error")), corsOrigin);
    }
  },

  async scheduled(_controller, env, ctx): Promise<void> {
    ctx.waitUntil(cleanup(env));
  },
} satisfies ExportedHandler<Env>;
