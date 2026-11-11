import path from "node:path"
import { defineConfig } from "vitest/config"

// Logic tests only (the *.test.ts files carried over from seanime-web). They run in Node; nothing here renders.
// Native modules cannot load in Node, so the two the logic touches are aliased to Node-side equivalents (test/).
export default defineConfig({
    define: { __DEV__: "false" },
    resolve: {
        alias: [
            { find: /^@\//, replacement: path.resolve(__dirname, "src") + "/" },
            { find: /^react-native-mmkv$/, replacement: path.resolve(__dirname, "test/react-native-mmkv.ts") },
            { find: /^expo-crypto$/, replacement: path.resolve(__dirname, "test/expo-crypto.ts") },
        ],
    },
    test: {
        include: ["src/**/*.test.ts"],
        environment: "node",
    },
})
