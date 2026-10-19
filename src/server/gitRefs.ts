import { z } from 'zod';

/** Git inputs shared by every tool that inspects the local diff. */
export const gitRefsShape = {
  baseBranch: z.string().default('origin/main').describe('Base branch to diff against'),
  compareRef: z.string().default('HEAD').describe('Branch or commit to compare'),
  repoPath: z.string().default('.').describe('Path to the git repository'),
};
