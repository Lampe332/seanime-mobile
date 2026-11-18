// Test-only replacement for the Email Service binding: records every message instead of sending it.
import { WorkerEntrypoint } from "cloudflare:workers";

const outbox = [];

export class MailSink extends WorkerEntrypoint {
  async send(message) {
    outbox.push(structuredClone(message));
    return { messageId: `test-${outbox.length}` };
  }
  /** Returns and removes all mails sent to `to`. */
  async take(to) {
    const mine = outbox.filter((m) => m.to === to);
    for (const m of mine) outbox.splice(outbox.indexOf(m), 1);
    return mine;
  }
}

export default { fetch: () => new Response("mail-sink") };
