import { z } from 'zod';
import { markdownToAdf } from '../../utils/markdownToAdf.js';
import { assertWritableIssue } from '../../writes/guard.js';
import { runGuardedWrite, WriteResultSchema } from '../../writes/guardedWrite.js';
import { EnvelopeSchema } from '../envelope.js';
import { errorResult } from '../errors.js';
import { WRITE_ANNOTATIONS, formElicitation, writeToolResult } from '../writeResult.js';
import type { ToolRegistrar } from '../types.js';
import { issueKeyField } from './jiraIssueInputs.js';

const NAME = 'jira_add_comment';

/** Shows the comment verbatim: a fence longer than any backtick run inside it. */
function fenced(text: string): string {
  const longestRun = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longestRun + 1));
  return `${fence}\n${text}\n${fence}`;
}

export const registerJiraAddComment: ToolRegistrar = (server, { config, jiraClient, confirmTokens }) => {
  server.registerTool(
    NAME,
    {
      title: 'Add a comment to a Jira issue',
      description:
        'Post a Markdown comment to a Jira issue, e.g. the QA handoff or release notes from delivery_generate. ' +
        'Nothing is posted on the first call: it returns a preview and a confirmToken (or asks the user in a form). ' +
        'Call again with the same arguments plus confirmToken only after the user approves the preview.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        markdown: z.string().min(1).max(32_000).describe('The comment, in Markdown'),
        confirmToken: z.string().optional().describe('Token from the preview call; posts the comment'),
      }),
      outputSchema: EnvelopeSchema.extend({ data: WriteResultSchema }),
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ issueKey: rawKey, markdown, confirmToken }, ctx) => {
      try {
        const issueKey = assertWritableIssue(rawKey, config);
        const outcome = await runGuardedWrite(
          {
            tool: NAME,
            issueKey,
            args: { issueKey, markdown },
            preview: `Add this comment to ${issueKey} (${markdown.length} characters):\n\n${fenced(markdown)}`,
            steps: [{ action: 'comment', run: async () => (await jiraClient.addComment(issueKey, markdownToAdf(markdown))).id }],
          },
          {
            confirmToken,
            tokens: confirmTokens!,
            auditLogPath: config.auditLogPath,
            elicit: confirmToken === undefined ? formElicitation(server, ctx.mcpReq.elicitInput) : undefined,
          },
        );
        return writeToolResult(NAME, issueKey, outcome);
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
