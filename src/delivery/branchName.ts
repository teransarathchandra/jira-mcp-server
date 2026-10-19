// Suggests a git branch name for a Jira issue. Suggestion only: nothing here
// runs git.

export const DEFAULT_BRANCH_PATTERN = '{type}/{KEY}-{slug}';

const MAX_SLUG_WORDS = 6;
const MAX_SLUG_CHARS = 50;

function branchType(issueType: string): string {
  if (/^(bug|defect)$/i.test(issueType)) return 'fix';
  if (/^(story|feature|improvement|epic)$/i.test(issueType)) return 'feature';
  return 'chore';
}

function slugify(summary: string): string {
  const words = summary
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .slice(0, MAX_SLUG_WORDS);
  const slug = words.join('-').slice(0, MAX_SLUG_CHARS).replace(/^-+|-+$/g, '');
  return slug || 'task';
}

export function suggestBranchName(
  issue: { key: string; summary: string; issueType: string },
  pattern: string = DEFAULT_BRANCH_PATTERN,
): string {
  return pattern
    .replaceAll('{type}', branchType(issue.issueType))
    .replaceAll('{KEY}', issue.key)
    .replaceAll('{slug}', slugify(issue.summary));
}
