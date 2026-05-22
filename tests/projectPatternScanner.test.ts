import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { scanProjectPatterns } from '../src/projectPatterns/projectPatternScanner.js';

// Use the actual project root for integration-style tests
const PROJECT_ROOT = resolve(new URL('.', import.meta.url).pathname, '..');

describe('projectPatternScanner', () => {
  it('scanProjectPatterns returns scannedAt (ISO date) and repoPath', () => {
    const result = scanProjectPatterns(PROJECT_ROOT);
    expect(result.scannedAt).toBeDefined();
    // Validate ISO date format
    expect(() => new Date(result.scannedAt)).not.toThrow();
    const parsed = new Date(result.scannedAt);
    expect(parsed.toISOString()).toBe(result.scannedAt);
    expect(result.repoPath).toBe(PROJECT_ROOT);
  });

  it('techStack detects typescript and vitest', () => {
    const result = scanProjectPatterns(PROJECT_ROOT);
    expect(result.techStack).toContain('TypeScript');
    expect(result.techStack).toContain('Vitest');
  });

  it('moduleNames returns src subdirectories', () => {
    const result = scanProjectPatterns(PROJECT_ROOT);
    // The project has src/tools, src/delivery, src/jira, src/utils, etc.
    expect(result.moduleNames.length).toBeGreaterThan(0);
    // Should include known subdirectories
    expect(result.moduleNames).toContain('tools');
    expect(result.moduleNames).toContain('delivery');
  });

  it('testLocations detects tests directory', () => {
    const result = scanProjectPatterns(PROJECT_ROOT);
    // The project has a tests/ directory at the root
    expect(result.testLocations.some((loc) => loc.includes('tests'))).toBe(true);
  });

  it('namingConventions detects file naming patterns', () => {
    const result = scanProjectPatterns(PROJECT_ROOT);
    // The project uses camelCase (e.g., jiraClient.ts) files
    // It should detect at least one naming convention
    expect(result.namingConventions.length).toBeGreaterThan(0);
  });

  it('does not include dist or node_modules in moduleNames', () => {
    const result = scanProjectPatterns(PROJECT_ROOT);
    expect(result.moduleNames).not.toContain('dist');
    expect(result.moduleNames).not.toContain('node_modules');
  });
});
