import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getServerVersion, getPackageSpec } from '../src/version.js';

describe('getPackageSpec()', () => {
  it('uses the bare package name for a stable version', () => {
    expect(getPackageSpec('2.0.0')).toBe('jira-delivery-mcp');
  });

  it('pins the prerelease dist-tag so npx does not install latest', () => {
    expect(getPackageSpec('2.0.0-beta.1')).toBe('jira-delivery-mcp@beta');
    expect(getPackageSpec('2.0.0-rc.2')).toBe('jira-delivery-mcp@rc');
  });

  it('defaults to the running version', () => {
    const expected = getServerVersion().includes('-') ? /^jira-delivery-mcp@/ : /^jira-delivery-mcp$/;
    expect(getPackageSpec()).toMatch(expected);
  });
});

describe('getServerVersion()', () => {
  it('returns the version declared in package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(getServerVersion()).toBe(pkg.version);
  });
});
