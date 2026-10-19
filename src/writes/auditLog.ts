import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// Append-only audit log of Jira writes (R3 design §5.5). One JSON line per
// attempted step. Never contains comment bodies, tokens or credentials.

export type AuditAction = 'comment' | 'assign' | 'transition' | 'link';
export type AuditOutcome = 'applied' | 'failed' | 'refused';

export interface AuditEntry {
  tool: string;
  issueKey: string;
  action: AuditAction;
  outcome: AuditOutcome;
  /** A status name, transition id, link URL, comment id or error class. */
  detail?: string;
}

/** Returns null on success, or a warning to surface; never throws. */
export function appendAudit(path: string, entry: AuditEntry): string | null {
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const line = {
      ts: new Date().toISOString(),
      tool: entry.tool,
      issueKey: entry.issueKey,
      action: entry.action,
      outcome: entry.outcome,
      ...(entry.detail !== undefined ? { detail: entry.detail } : {}),
    };
    appendFileSync(path, `${JSON.stringify(line)}\n`, { mode: 0o600 });
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `Could not write the audit log at ${path}: ${message}`;
  }
}
