import type { JiraProjectConfig } from '../config.js';

export function listConfiguredProjects(projectConfig: JiraProjectConfig): string {
  // ## Default Project
  const defaultSection = projectConfig.defaultProjectKey
    ? `- ${projectConfig.defaultProjectKey}`
    : `- None configured`;

  // ## Allowed Projects
  const allowedSection = projectConfig.allowedProjectKeys.length > 0
    ? projectConfig.allowedProjectKeys.map(k => `- ${k}`).join('\n')
    : `- All projects allowed (no allowlist configured)`;

  // ## Validation
  const patternSource = projectConfig.issueKeyPattern.source;

  return [
    `# Configured Jira Projects`,
    ``,
    `## Default Project`,
    defaultSection,
    ``,
    `## Allowed Projects`,
    allowedSection,
    ``,
    `## Validation`,
    `- Issue key pattern: ${patternSource}`,
    `- Strict allowlist: ${projectConfig.strictProjectAllowlist}`,
    `- Example issue key: ${projectConfig.exampleIssueKey}`,
  ].join('\n');
}
