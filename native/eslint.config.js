// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Logic copied unchanged from backend/seanime-web (docs/NATIVE-UMBAU.md §3.2). It was written before the React
    // Compiler rules and breaks some of them on purpose (setState in effects, refs/Date.now while rendering, manual
    // memoization). Where the compiler cannot keep such code safe (refs, purity, memoization) it skips that function
    // and leaves it plain React, which is how it ran in the web app; setState in an effect is a style check that does
    // not change what the compiler emits. So these rules only warn here: rewriting the code to satisfy them would
    // change ported behaviour. New code outside these files keeps them as errors. See §9 (04.11.2026).
    files: [
      'src/hooks/use-debounce.ts',
      'src/lib/helpers/debug.ts',
      'src/main/**/_lib/**/*.{ts,tsx}',
    ],
    rules: {
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/use-memo': 'warn',
    },
  },
]);
