/**
 * Regression: v2 tools strip unknown arguments, so documenting a v1-only
 * parameter makes users set options that are silently ignored. The docs must
 * not advertise them, and the CHANGELOG must say they were removed.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

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
