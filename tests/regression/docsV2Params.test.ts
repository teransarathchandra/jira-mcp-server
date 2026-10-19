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

  it('installs the release line of package.json (a bare name would install `latest` during a prerelease)', () => {
    const specs = [...readme.matchAll(/(?:npx -y|npm install -g|"-y", ")\s*(jira-delivery-mcp[@\w.-]*)/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set([getPackageSpec()]));
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
  it.each(['README.md', 'USAGE_GUIDE.md'])('%s does not document removed parameters', (file) => {
    expect(mentioned(readFileSync(file, 'utf8'))).toEqual([]);
  });

  it('CHANGELOG lists every removed parameter', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const section = changelog.split('### Removed parameters')[1]?.split('\n### ')[0] ?? '';
    expect(mentioned(section).sort()).toEqual([...REMOVED_PARAMETERS].sort());
  });
});
