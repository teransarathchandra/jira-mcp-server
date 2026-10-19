import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getServerVersion } from '../src/version.js';

describe('getServerVersion()', () => {
  it('returns the version declared in package.json', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
    expect(getServerVersion()).toBe(pkg.version);
  });
});
