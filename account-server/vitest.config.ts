import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          // Fixed test-only values (same as .dev.vars.example). Real secrets never live in the repo.
          bindings: {
            PEPPER_V1: "dev-pepper-not-secret-0123456789abcdef",
            ENUM_SECRET: "dev-enum-secret-not-secret-0123456789",
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
