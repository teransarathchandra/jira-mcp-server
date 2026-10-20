import { defineConfig } from 'vitest/config';

// `npm run eval` only: calls a model (Claude Code or the Anthropic API), so it is kept out of `npm test`.
export default defineConfig({
  test: {
    include: ['evals/**/*.eval.ts'],
    testTimeout: 15 * 60 * 1000,
  },
});
