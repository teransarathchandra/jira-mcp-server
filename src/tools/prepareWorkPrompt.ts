import { JiraClient } from '../jiraClient.js';
import { validateIssueKey } from '../utils/issueKey.js';
import { formatIssueBrief } from '../utils/formatIssueBrief.js';
import { processUntrustedContent, getUntrustedContentDisclaimer } from '../security/untrustedContentGuard.js';
import { adfToMarkdown } from '../utils/adfToMarkdown.js';

export interface PrepareWorkPromptInput {
  issueKey: string;
}

export async function prepareWorkPrompt(input: PrepareWorkPromptInput, client: JiraClient): Promise<string> {
  // 1. Validate the issue key
  validateIssueKey(input.issueKey);

  // 2. Fetch the full brief
  const issue = await client.getIssue(input.issueKey);
  const brief = formatIssueBrief(issue);

  // 3. Extract ONLY the "Implementation Prompt for Claude Code" section
  const promptSection = extractImplementationPrompt(brief, input.issueKey, issue.fields.summary);

  // 4. Wrap the Jira issue description content with untrusted content guard
  const descriptionContent = issue.fields.description
    ? adfToMarkdown(issue.fields.description)
    : '';

  const parts: string[] = [];

  if (descriptionContent) {
    const { wrapped, warningBlock } = processUntrustedContent(
      `Jira ${input.issueKey}`,
      descriptionContent
    );
    if (warningBlock) {
      parts.push(warningBlock);
    }
    parts.push(wrapped);
    parts.push('');
  }

  parts.push(promptSection);
  parts.push('');
  parts.push(getUntrustedContentDisclaimer());

  return parts.join('\n');
}

function extractImplementationPrompt(brief: string, issueKey: string, summary: string): string {
  // Find the "## Implementation Prompt for Claude Code" section
  const sectionStart = brief.indexOf('## Implementation Prompt for Claude Code');
  if (sectionStart === -1) {
    // Fallback: minimal prompt
    return `Implement Jira task ${issueKey}: ${summary}\n\nPlease inspect the repository before making changes.`;
  }
  return brief.slice(sectionStart).trim();
}
