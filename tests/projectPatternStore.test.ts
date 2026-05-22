import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  savePatterns,
  loadPatterns,
  clearPatterns,
} from '../src/projectPatterns/projectPatternStore.js';
import type { ProjectPatterns } from '../src/projectPatterns/projectPatternScanner.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePatterns(overrides: Partial<ProjectPatterns> = {}): ProjectPatterns {
  return {
    scannedAt: new Date().toISOString(),
    repoPath: '/tmp/test-repo',
    moduleNames: ['utils', 'tools'],
    testLocations: ['tests/'],
    namingConventions: ['camelCase files detected'],
    apiStructure: ['MCP SDK detected'],
    componentPatterns: [],
    permissionPatterns: [],
    validationPatterns: ['Zod'],
    techStack: ['TypeScript', 'Vitest', 'MCP SDK'],
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('projectPatternStore', () => {
  let tempDir: string;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'pattern-store-test-'));
    // Ensure disabled by default
    delete process.env['DELIVERY_PATTERN_MEMORY_ENABLED'];
    delete process.env['DELIVERY_PATTERN_MEMORY_FILE'];
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Restore env
    delete process.env['DELIVERY_PATTERN_MEMORY_ENABLED'];
    delete process.env['DELIVERY_PATTERN_MEMORY_FILE'];
    Object.assign(process.env, originalEnv);
  });

  it('pattern memory is disabled by default (DELIVERY_PATTERN_MEMORY_ENABLED not set)', () => {
    expect(process.env['DELIVERY_PATTERN_MEMORY_ENABLED']).toBeUndefined();
  });

  it('savePatterns returns saved=false when disabled', () => {
    const patterns = makePatterns();
    const result = savePatterns(tempDir, patterns);
    expect(result.saved).toBe(false);
    expect(result.reason).toContain('DELIVERY_PATTERN_MEMORY_ENABLED');
  });

  it('loadPatterns returns null when disabled', () => {
    const result = loadPatterns(tempDir);
    expect(result).toBeNull();
  });

  it('clearPatterns returns cleared=true when file exists', () => {
    // Write a temp file directly
    const filePath = join(tempDir, '.mcp-project-patterns.json');
    writeFileSync(filePath, JSON.stringify(makePatterns()), 'utf-8');
    expect(existsSync(filePath)).toBe(true);

    const result = clearPatterns(tempDir);
    expect(result.cleared).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it('clearPatterns returns cleared=false when no file', () => {
    const result = clearPatterns(tempDir);
    expect(result.cleared).toBe(false);
    expect(result.reason).toBe('No pattern file found.');
  });

  it('savePatterns saves JSON when enabled', () => {
    process.env['DELIVERY_PATTERN_MEMORY_ENABLED'] = 'true';
    const patterns = makePatterns({ repoPath: tempDir });
    const result = savePatterns(tempDir, patterns);
    expect(result.saved).toBe(true);

    // Verify file was written
    const filePath = join(tempDir, '.mcp-project-patterns.json');
    expect(existsSync(filePath)).toBe(true);
  });

  it('loadPatterns returns patterns when enabled and file exists', () => {
    process.env['DELIVERY_PATTERN_MEMORY_ENABLED'] = 'true';
    const patterns = makePatterns({ repoPath: tempDir });

    // Save first
    savePatterns(tempDir, patterns);

    // Then load
    const loaded = loadPatterns(tempDir);
    expect(loaded).not.toBeNull();
    expect(loaded?.repoPath).toBe(tempDir);
    expect(loaded?.techStack).toEqual(['TypeScript', 'Vitest', 'MCP SDK']);
  });

  it('clearPatterns deletes file when enabled', () => {
    process.env['DELIVERY_PATTERN_MEMORY_ENABLED'] = 'true';
    const patterns = makePatterns({ repoPath: tempDir });
    savePatterns(tempDir, patterns);

    const filePath = join(tempDir, '.mcp-project-patterns.json');
    expect(existsSync(filePath)).toBe(true);

    const result = clearPatterns(tempDir);
    expect(result.cleared).toBe(true);
    expect(existsSync(filePath)).toBe(false);
  });

  it('pattern file path uses env var DELIVERY_PATTERN_MEMORY_FILE when set', () => {
    process.env['DELIVERY_PATTERN_MEMORY_ENABLED'] = 'true';
    process.env['DELIVERY_PATTERN_MEMORY_FILE'] = 'custom-patterns.json';

    const patterns = makePatterns({ repoPath: tempDir });
    const result = savePatterns(tempDir, patterns);
    expect(result.saved).toBe(true);

    const customFilePath = join(tempDir, 'custom-patterns.json');
    expect(existsSync(customFilePath)).toBe(true);

    // Default file should NOT exist
    const defaultFilePath = join(tempDir, '.mcp-project-patterns.json');
    expect(existsSync(defaultFilePath)).toBe(false);

    delete process.env['DELIVERY_PATTERN_MEMORY_FILE'];
  });
});
