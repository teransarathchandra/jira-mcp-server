/**
 * Regression: v2 tools strip unknown arguments, so documenting a v1-only
 * parameter makes users set options that are silently ignored. The docs must
 * not advertise them, and the CHANGELOG must say they were removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { getPackageSpec } from '../../src/version.js';

const DOCS = ['README.md', ...readdirSync('docs').filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)];

describe('README install instructions', () => {
  const readme = readFileSync('README.md', 'utf8');

  it.each(DOCS)('%s installs the release line of package.json (a bare name would install `latest` during a prerelease)', (file) => {
    const text = readFileSync(file, 'utf8');
    const specs = [...text.matchAll(/(?:npx(?: -y)?|npm install -g|"-y", ")\s*(jira-delivery-mcp[@\w.-]*)/g)].map((m) => m[1]);
    expect(new Set(specs).size).toBeLessThanOrEqual(1);
    if (specs.length > 0) expect(specs[0]).toBe(getPackageSpec());
  });

  it('README shows the install command', () => {
    expect(readme).toMatch(/npx -y jira-delivery-mcp/);
  });

  it('uses the real plugin install commands', () => {
    expect(readme).toContain('/plugin marketplace add teransarathchandra/jira-mcp-server');
    expect(readme).toContain('/plugin install jira-delivery@jira-delivery');
    expect(readme).not.toContain('--marketplace');
  });

  it('has a Cursor install link whose config installs the release line', () => {
    const config = /cursor\.com\/install-mcp\?name=jira-delivery&config=([^)\s"]+)/.exec(readme)?.[1];
    expect(config).toBeDefined();
    const decoded = JSON.parse(Buffer.from(decodeURIComponent(config!), 'base64').toString('utf8'));
    expect(decoded).toMatchObject({ command: 'npx', args: ['-y', getPackageSpec()] });
  });

  it('has VS Code install links that prompt for the credentials and keep the token secret', () => {
    const links = [...readme.matchAll(/https:\/\/insiders\.vscode\.dev\/redirect\/mcp\/install\?([^)\s"]+)/g)].map((m) => new URLSearchParams(m[1]));
    expect(links.length).toBeGreaterThanOrEqual(2);
    for (const params of links) {
      expect(params.get('name')).toBe('jira-delivery');
      const config = JSON.parse(params.get('config')!);
      expect(config).toMatchObject({ command: 'npx', args: ['-y', getPackageSpec()] });
      const inputs = JSON.parse(params.get('inputs')!) as Array<{ id: string; password?: boolean }>;
      for (const value of Object.values(config.env as Record<string, string>)) {
        const id = /^\$\{input:(\w+)\}$/.exec(value)?.[1];
        expect(inputs.map((i) => i.id)).toContain(id);
      }
      expect(inputs.find((i) => i.id === 'jira_api_token')?.password).toBe(true);
    }
    expect(links.some((p) => p.get('quality') === 'insiders')).toBe(true);
  });

  it('links only to files that exist', () => {
    for (const file of DOCS) {
      const text = readFileSync(file, 'utf8');
      const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
      for (const [, target] of text.matchAll(/\]\((?!https?:|#|mailto:)([^)#\s]+)/g)) {
        expect(() => readFileSync(new URL(`../../${dir}${target}`, import.meta.url)), `${file} -> ${target}`).not.toThrow();
      }
    }
  });

  it('keeps the v1 → v2 migration table', () => {
    const migration = readFileSync('docs/migrating-from-v1.md', 'utf8');
    expect(migration).toMatch(/\| `jira_get_issue_context` \| `jira_get_issue` with `depth: "full"` \|/);
    expect(readme).toContain('docs/migrating-from-v1.md');
  });
});

const REMOVED_PARAMETERS = [
  'includeComments',
  'includeAttachments',
  'includeParent',
  'includeEpic',
  'includeLinkedIssues',
  'includeSubtasks',
  'includeEpicSiblings',
  'maxLinkedIssues',
  'maxSubtasks',
  'maxCommentsPerIssue',
  'contextDepth',
  'includeJiraComments',
  'confluenceMaxSearchResults',
  'confluenceMaxPagesToRead',
  'includeMediumRelevancePages',
  'includeLowRelevancePages',
  'maxConfluenceChars',
  'prNumber',
  'outputPath',
];

const mentioned = (text: string) => REMOVED_PARAMETERS.filter((p) => new RegExp(`\\b${p}\\b`).test(text));

describe('docs only describe v2 parameters', () => {
  it.each(DOCS)('%s does not document removed parameters', (file) => {
    expect(mentioned(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('CHANGELOG lists every removed parameter', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const section = changelog.split('### Removed parameters')[1]?.split('\n### ')[0] ?? '';
    expect(mentioned(section).sort()).toEqual([...REMOVED_PARAMETERS].sort());
  });
});
