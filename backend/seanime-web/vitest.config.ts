import path from "node:path"
import { defineConfig } from "vitest/config"

// Unit tests resolve the same "@/..." imports as the app build (rsbuild.config.ts / tsconfig paths).
export default defineConfig({
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
    },
})
