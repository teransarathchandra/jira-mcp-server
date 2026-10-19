import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';

// Slash-command prompts. Each one is a one-line instruction that points the
// agent at the right v2 tool for a common workflow.
const PROMPTS: Array<{ name: string; description: string; text: (issueKey: string) => string }> = [
  {
    name: 'jira_implementation_prompt',
    description: 'Prepare a full implementation brief for a Jira task',
    text: (k) => `Use jira_prepare_work_brief with issueKey ${k}, depth full and includeConfluence true.`,
  },
  {
    name: 'jira_pr_review_prompt',
    description: 'Review the current branch against a Jira task',
    text: (k) => `Use delivery_check_changes for ${k} on the current branch and summarise gaps.`,
  },
  {
    name: 'jira_qa_handoff_prompt',
    description: 'Generate a QA handoff for a Jira task',
    text: (k) => `Use delivery_generate with type qa_handoff for ${k}.`,
  },
  {
    name: 'jira_definition_of_done_prompt',
    description: 'Verify the Definition of Done for a Jira task',
    text: (k) => `Use delivery_check_changes with checks ["dod"] for ${k} and return the verdict and score.`,
  },
  {
    name: 'jira_release_note_prompt',
    description: 'Generate release notes for a Jira task',
    text: (k) => `Use delivery_generate with type release_notes and audience internal for ${k}.`,
  },
];

export function registerPrompts(server: McpServer): void {
  for (const prompt of PROMPTS) {
    server.registerPrompt(
      prompt.name,
      { description: prompt.description, argsSchema: z.object({ issueKey: z.string().describe('Jira issue key') }) },
      async ({ issueKey }) => ({
        messages: [{ role: 'user', content: { type: 'text', text: prompt.text(issueKey) } }],
      }),
    );
  }
}
