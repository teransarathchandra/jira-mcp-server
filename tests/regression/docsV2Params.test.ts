/**
 * Regression: v2 tools strip unknown arguments, so documenting a v1-only
 * parameter makes users set options that are silently ignored. The docs must
 * not advertise them, and the CHANGELOG must say they were removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getPackageSpec } from '../../src/version.js';

describe('README install instructions', () => {
  const readme = readFileSync('README.md', 'utf8');

  it('docs/reference.md runs the CLI from the release line too', () => {
    const specs = [...readFileSync('docs/reference.md', 'utf8').matchAll(/npx(?: -y)?\s+(jira-delivery-mcp[@\w.-]*)/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set([getPackageSpec()]));
  });

  it('installs the release line of package.json (a bare name would install `latest` during a prerelease)', () => {
    const specs = [...readme.matchAll(/(?:npx(?: -y)?|npm install -g|"-y", ")\s*(jira-delivery-mcp[@\w.-]*)/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set([getPackageSpec()]));
  });

  it('uses the real plugin install commands', () => {
    expect(readme).toContain('/plugin marketplace add teransarathchandra/jira-mcp-server');
    expect(readme).toContain('/plugin install jira-delivery@jira-delivery');
    expect(readme).not.toContain('--marketplace');
  });

  it('has a Cursor install link whose config installs the release line', () => {
    const config = /cursor\.com\/install-mcp\?name=jira-delivery&config=([^)\s]+)/.exec(readme)?.[1];
    expect(config).toBeDefined();
    const decoded = JSON.parse(Buffer.from(decodeURIComponent(config!), 'base64').toString('utf8'));
    expect(decoded).toMatchObject({ command: 'npx', args: ['-y', getPackageSpec()] });
  });

  it('carries the v1 → v2 migration table', () => {
    expect(readme).toContain('## Migrating from 1.x');
    expect(readme).toMatch(/\| `jira_get_issue_context` \| `jira_get_issue` with `depth: "full"` \|/);
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
  it.each(['README.md', 'USAGE_GUIDE.md', 'docs/reference.md', 'docs/workflows.md'])('%s does not document removed parameters', (file) => {
    expect(mentioned(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('CHANGELOG lists every removed parameter', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const section = changelog.split('### Removed parameters')[1]?.split('\n### ')[0] ?? '';
    expect(mentioned(section).sort()).toEqual([...REMOVED_PARAMETERS].sort());
  });
});
