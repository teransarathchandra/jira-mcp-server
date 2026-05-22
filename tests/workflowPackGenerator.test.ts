import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  generateWorkflowPack,
  type WorkflowPackInput,
  type WorkflowPackResult,
} from '../src/claudeWorkflow/workflowPackGenerator.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

const TOTAL_FILES = 7;

const EXPECTED_RELATIVE_PATHS = [
  '.claude/skills/jira-delivery-review/SKILL.md',
  '.claude/skills/jira-implementation-plan/SKILL.md',
  '.claude/skills/jira-qa-handoff/SKILL.md',
  '.claude/commands/jira-plan.md',
  '.claude/commands/jira-review-pr.md',
  '.claude/commands/jira-qa.md',
  '.claude/commands/jira-dod.md',
];

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('generateWorkflowPack', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'workflow-pack-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('generates all 7 files when none exist', () => {
    const result: WorkflowPackResult = generateWorkflowPack({
      repoPath: tempDir,
      overwrite: false,
    });

    expect(result.generated).toHaveLength(TOTAL_FILES);
    expect(result.skipped).toHaveLength(0);

    for (const relativePath of EXPECTED_RELATIVE_PATHS) {
      const absolutePath = join(tempDir, relativePath);
      expect(existsSync(absolutePath), `Expected file to exist: ${absolutePath}`).toBe(true);
    }
  });

  it('skips existing files when overwrite=false', () => {
    // First pass — generate all files
    generateWorkflowPack({ repoPath: tempDir, overwrite: false });

    // Second pass — all should be skipped
    const result = generateWorkflowPack({ repoPath: tempDir, overwrite: false });

    expect(result.generated).toHaveLength(0);
    expect(result.skipped).toHaveLength(TOTAL_FILES);
  });

  it('overwrites existing files when overwrite=true', () => {
    // First pass — generate
    generateWorkflowPack({ repoPath: tempDir, overwrite: false });

    // Second pass — overwrite
    const result = generateWorkflowPack({ repoPath: tempDir, overwrite: true });

    expect(result.generated).toHaveLength(TOTAL_FILES);
    expect(result.skipped).toHaveLength(0);
  });

  it('usageExamples always has 5 items', () => {
    const result = generateWorkflowPack({ repoPath: tempDir, overwrite: false });

    expect(result.usageExamples).toHaveLength(5);
  });

  it('generated + skipped equals total files (7)', () => {
    // Fresh run — all generated
    const first = generateWorkflowPack({ repoPath: tempDir, overwrite: false });
    expect(first.generated.length + first.skipped.length).toBe(TOTAL_FILES);

    // Second run with overwrite=false — all skipped
    const second = generateWorkflowPack({ repoPath: tempDir, overwrite: false });
    expect(second.generated.length + second.skipped.length).toBe(TOTAL_FILES);

    // Third run with overwrite=true — all generated again
    const third = generateWorkflowPack({ repoPath: tempDir, overwrite: true });
    expect(third.generated.length + third.skipped.length).toBe(TOTAL_FILES);
  });

  it('does not overwrite when skipping (file content unchanged)', () => {
    // Generate the files
    generateWorkflowPack({ repoPath: tempDir, overwrite: false });

    // Read original content of the first skill file
    const skillFilePath = join(
      tempDir,
      '.claude/skills/jira-delivery-review/SKILL.md',
    );
    const originalContent = readFileSync(skillFilePath, 'utf8');

    // Re-run with overwrite=false — should skip
    const result = generateWorkflowPack({ repoPath: tempDir, overwrite: false });
    expect(result.skipped.length).toBeGreaterThan(0);

    // Content must be unchanged
    const contentAfter = readFileSync(skillFilePath, 'utf8');
    expect(contentAfter).toBe(originalContent);
  });
});
