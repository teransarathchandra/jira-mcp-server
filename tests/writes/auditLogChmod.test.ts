import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// A log file the user can write to but doesn't own cannot be chmod-ed (EPERM);
// the entry must still be written.
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    fchmodSync: () => {
      throw Object.assign(new Error('EPERM: operation not permitted, fchmod'), { code: 'EPERM' });
    },
  };
});

const { appendAudit } = await import('../../src/writes/auditLog.js');

describe('appendAudit() when the mode cannot be changed', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('still writes the entry and warns about the permissions', () => {
    const root = mkdtempSync(join(tmpdir(), 'audit-'));
    dirs.push(root);
    const path = join(root, 'audit.log');
    const warning = appendAudit(path, { tool: 't', issueKey: 'ABC-1', action: 'comment', outcome: 'applied', detail: '1' });
    expect(readFileSync(path, 'utf8')).toContain('"issueKey":"ABC-1"');
    expect(warning).toMatch(/permissions/i);
  });
});
