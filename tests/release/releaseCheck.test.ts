import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { releaseInfo } from '../../scripts/release-check.mjs';
import { getPackageSpec } from '../../src/version.js';

const manifests = (version: string) => ({ 'package.json': version, 'plugin/.claude-plugin/plugin.json': version, 'server.json': version });

describe('releaseInfo()', () => {
  it('publishes a stable tag to latest', () => {
    expect(releaseInfo('v2.0.0', manifests('2.0.0'))).toEqual({ version: '2.0.0', distTag: 'latest' });
  });

  it.each([
    ['v2.0.0-beta.3', 'beta'],
    ['v2.0.0-rc.1', 'rc'],
    ['v2.1.0-alpha.0', 'alpha'],
  ])('publishes %s under the dist-tag the install docs use', (tag, distTag) => {
    const version = tag.slice(1);
    expect(releaseInfo(tag, manifests(version)).distTag).toBe(distTag);
    expect(getPackageSpec(version)).toBe(`jira-delivery-mcp@${distTag}`);
  });

  it('refuses a tag that is not a version', () => {
    expect(() => releaseInfo('v2.0', manifests('2.0'))).toThrow(/not a release tag/);
    expect(() => releaseInfo('2.0.0', manifests('2.0.0'))).toThrow(/not a release tag/);
    expect(() => releaseInfo('v2.0.0-latest.1', manifests('2.0.0-latest.1'))).toThrow(/not a release tag/);
  });

  it('refuses a tag that does not match every manifest', () => {
    expect(() => releaseInfo('v2.0.0', { ...manifests('2.0.0'), 'server.json': '2.0.0-beta.3' })).toThrow(/server\.json is 2\.0\.0-beta\.3/);
  });
});

describe('release workflow', () => {
  const wf = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8');
  const [, build, publish] = wf.split(/\n  (?=build:|publish:)/);

  it('builds without publish credentials or install scripts', () => {
    expect(build).toMatch(/permissions:\n\s+contents: read/);
    expect(build).not.toContain('id-token');
    expect(build).toContain('npm ci --ignore-scripts');
    expect(build).toContain('persist-credentials: false');
  });

  it('publishes only from the job that needs the build, without running npm ci', () => {
    expect(publish).toContain('needs: build');
    expect(publish).toContain('id-token: write');
    expect(publish).not.toContain('npm ci');
  });

  it('pins every action by commit SHA', () => {
    const uses = [...wf.matchAll(/uses: (\S+)/g)].map((m) => m[1]);
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) expect(u).toMatch(/@[0-9a-f]{40}$/);
  });
});
