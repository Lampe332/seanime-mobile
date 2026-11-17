import { errorResponse, finalize, HttpError, preflight } from "./http";
import { cleanup } from "./cron";
import * as approval from "./approval";
import * as id from "./identity";
import { rotate } from "./rotate";
import * as r from "./routes";

type Handler = (ctx: r.Ctx) => Promise<Response>;

const routes: Array<[method: string, pattern: RegExp, handler: Handler]> = [
  ["POST", /^\/v1\/auth\/prelogin$/, r.prelogin],
  ["POST", /^\/v1\/auth\/signup$/, r.signup],
  ["POST", /^\/v1\/auth\/login$/, r.login],
  ["POST", /^\/v1\/auth\/logout$/, r.logout],
  ["POST", /^\/v1\/auth\/verify$/, id.verifyEmail],
  ["POST", /^\/v1\/auth\/verify\/resend$/, id.resendVerification],
  ["POST", /^\/v1\/auth\/reset-request$/, id.resetRequest],
  ["POST", /^\/v1\/auth\/reset\/info$/, id.resetInfo],
  ["POST", /^\/v1\/auth\/reset$/, id.resetPassword],
  ["POST", /^\/v1\/auth\/google\/nonce$/, id.googleNonce],
  ["POST", /^\/v1\/auth\/google$/, id.googleLogin],
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
  ["POST", /^\/v1\/account\/rotate$/, rotate],
  ["POST", /^\/v1\/account\/link-google$/, id.linkGoogle],
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
    return handler({ request, env, isBrowser, params: { ...m.groups }, waitUntil: (p) => exec.waitUntil(p) });
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
