// Tool annotation presets so clients can decide when to ask for approval.

/** Reads from Jira/Confluence/git; never mutates anything. */
export const READ_ONLY_REMOTE = { readOnlyHint: true, openWorldHint: true } as const;

/** Writes or clears files inside the local repository. */
export const LOCAL_WRITE_DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: false,
} as const;
