import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Tests replace the Email Service binding with a sink worker that keeps sent mails in memory.
          email: { send_email: [] },
          serviceBindings: { EMAIL: { name: "mail-sink", entrypoint: "MailSink" } },
          workers: [{ name: "mail-sink", modules: true, compatibilityDate: "2026-11-17", scriptPath: "./test/mail-sink.js" }],
          // Fixed test-only values (same as .dev.vars.example). Real secrets never live in the repo.
          bindings: {
            PEPPER_V1: "dev-pepper-not-secret-0123456789abcdef",
            ENUM_SECRET: "dev-enum-secret-not-secret-0123456789",
            // 32 bytes base64url ("escrow-test-key-not-secret-01234")
            ESCROW_KEY: "ZXNjcm93LXRlc3Qta2V5LW5vdC1zZWNyZXQtMDEyMzQ",
            GOOGLE_WEB_CLIENT_ID: "test-client.apps.googleusercontent.com",
            // Test-only JWKS host; the tests answer it with their own RSA key.
            GOOGLE_JWKS_URL: "https://jwks.test/certs",
            // Pinned so a local .dev.vars (e.g. a localhost origin for wrangler dev) never changes test results.
            ALLOWED_ORIGIN: "https://seanimemobile.com",
            TEST_MIGRATIONS: migrations,
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
