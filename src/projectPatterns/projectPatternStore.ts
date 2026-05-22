// ── Project Pattern Store ─────────────────────────────────────────────────────
// Read/write/clear the local pattern memory file. Respects env var config.

import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProjectPatterns } from './projectPatternScanner.js';

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_PATTERN_FILE = '.mcp-project-patterns.json';

function isPatternMemoryEnabled(): boolean {
  return process.env['DELIVERY_PATTERN_MEMORY_ENABLED'] === 'true';
}

function getPatternFile(repoPath: string): string {
  const file = process.env['DELIVERY_PATTERN_MEMORY_FILE'] ?? DEFAULT_PATTERN_FILE;
  return resolve(repoPath, file);
}

// ── Exports ───────────────────────────────────────────────────────────────────

export function savePatterns(
  repoPath: string,
  patterns: ProjectPatterns,
): { saved: boolean; reason?: string } {
  if (!isPatternMemoryEnabled()) {
    return {
      saved: false,
      reason: 'Pattern memory is disabled. Set DELIVERY_PATTERN_MEMORY_ENABLED=true to enable.',
    };
  }

  const filePath = getPatternFile(repoPath);
  writeFileSync(filePath, JSON.stringify(patterns, null, 2), 'utf-8');
  return { saved: true };
}

export function loadPatterns(repoPath: string): ProjectPatterns | null {
  if (!isPatternMemoryEnabled()) return null;

  const filePath = getPatternFile(repoPath);
  if (!existsSync(filePath)) return null;

  try {
    return JSON.parse(readFileSync(filePath, 'utf-8')) as ProjectPatterns;
  } catch {
    return null;
  }
}

export function clearPatterns(repoPath: string): { cleared: boolean; reason?: string } {
  const filePath = getPatternFile(repoPath);

  if (!existsSync(filePath)) {
    return { cleared: false, reason: 'No pattern file found.' };
  }

  unlinkSync(filePath);
  return { cleared: true };
}
