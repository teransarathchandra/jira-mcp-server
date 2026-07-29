import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Only run the canonical suite. Git worktrees under .claude/worktrees/
    // contain full copies of tests/ and would otherwise be collected too.
    include: ['tests/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/**'],
  },
});
