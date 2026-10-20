import { z } from 'zod';
import { McpInputError } from '../../security/inputValidation.js';
import { assertWritableIssue } from '../../writes/guard.js';
import { runGuardedWrite, WriteResultSchema, type WriteStep } from '../../writes/guardedWrite.js';
import { EnvelopeSchema } from '../envelope.js';
import { errorResult } from '../errors.js';
import { WRITE_ANNOTATIONS, formElicitation, writeToolResult } from '../writeResult.js';
import type { ToolRegistrar } from '../types.js';
import { issueKeyField } from './jiraIssueInputs.js';

const NAME = 'jira_update_issue';

type Transition = { id: string; name: string; to: { name: string } };

// Line breaks, other control characters and bidi overrides could add lines to,
// or reorder, the preview the user confirms.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f\u200e\u200f\u202a-\u202e\u2066-\u2069]/;

function assertSafeLink(link: { url: string; title: string }): void {
  let parsed: URL | undefined;
  try {
    parsed = new URL(link.url);
  } catch {
    parsed = undefined;
  }
  if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || /\s/.test(link.url) || UNSAFE_TEXT.test(link.url)) {
    throw new McpInputError('link.url must be a single http:// or https:// URL', 'link');
  }
  if (UNSAFE_TEXT.test(link.title)) {
    throw new McpInputError('link.title must be one line of plain text', 'link');
  }
}

/** Exact case-insensitive match on the transition name, else on the target status. */
function matchTransition(transitions: Transition[], wanted: string): Transition {
  const w = wanted.trim().toLowerCase();
  const byName = transitions.filter((t) => t.name.toLowerCase() === w);
  const byStatus = transitions.filter((t) => t.to.name.toLowerCase() === w);
  const match = byName.length === 1 ? byName[0] : byName.length === 0 && byStatus.length === 1 ? byStatus[0] : undefined;
  if (match) return match;
  const available = transitions.map((t) => `${t.name} (→ ${t.to.name})`).join(', ') || 'none';
  const problem = byName.length > 1 || byStatus.length > 1 ? `"${wanted}" matches more than one transition.` : `No transition matches "${wanted}".`;
  throw new McpInputError(`${problem} Available: ${available}`, 'transitionTo');
}

export const registerJiraUpdateIssue: ToolRegistrar = (server, { config, jiraClient, confirmTokens }) => {
  server.registerTool(
    NAME,
    {
      title: 'Update a Jira issue: status, assignee, links',
      description:
        'Move a Jira issue to another status (transitionTo: a transition or status name), assign it to yourself ' +
        '(assignToMe), and/or link a branch or PR (link). Nothing changes on the first call: it returns a preview and a ' +
        'confirmToken (or asks the user in a form). Call again with the same arguments plus confirmToken only after the user approves the preview.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        transitionTo: z.string().min(1).optional().describe('Transition or target status name, e.g. "In Review"'),
        assignToMe: z.literal(true).optional().describe('Assign the issue to the authenticated account'),
        link: z
          .object({ url: z.string().min(1).max(2000), title: z.string().min(1).max(255) })
          .optional()
          .describe('Link a branch or PR (http/https URL)'),
        confirmToken: z.string().optional().describe('Token from the preview call; applies the changes'),
      }),
      outputSchema: EnvelopeSchema.extend({ data: WriteResultSchema }),
      annotations: WRITE_ANNOTATIONS,
    },
    async ({ issueKey: rawKey, transitionTo, assignToMe, link, confirmToken }, ctx) => {
      try {
        if (transitionTo === undefined && assignToMe === undefined && link === undefined) {
          throw new McpInputError('Nothing to update: pass transitionTo, assignToMe or link.');
        }
        if (link) assertSafeLink(link);
        const issueKey = assertWritableIssue(rawKey, config);

        const steps: WriteStep[] = [];
        const preview: string[] = [`Update ${issueKey}:`];
        if (assignToMe) {
          preview.push('- Assign it to you (the account behind JIRA_EMAIL)');
          steps.push({
            action: 'assign',
            run: async () => {
              const me = await jiraClient.getMyself();
              await jiraClient.assignIssue(issueKey, me.accountId);
              return { detail: me.displayName, auditDetail: me.accountId };
            },
          });
        }
        let resolvedTransition: { id: string; to: string } | undefined;
        if (transitionTo !== undefined) {
          const transition = matchTransition(await jiraClient.getTransitions(issueKey), transitionTo);
          resolvedTransition = { id: transition.id, to: transition.to.name };
          preview.push(`- Move it with "${transition.name}" to ${transition.to.name}`);
          steps.push({
            action: 'transition',
            run: async () => {
              await jiraClient.transitionIssue(issueKey, transition.id);
              return transition.to.name;
            },
          });
        }
        if (link) {
          preview.push(`- Link ${link.url} ("${link.title}")`);
          steps.push({
            action: 'link',
            run: async () => {
              await jiraClient.addRemoteLink(issueKey, link);
              return link.url;
            },
          });
        }

        // The resolved transition is part of what the user confirmed: if the
        // workflow changes between preview and confirm, the token no longer fits.
        const args: Record<string, unknown> = { issueKey, transitionTo, resolvedTransition, assignToMe, link };
        const outcome = await runGuardedWrite(
          { tool: NAME, issueKey, args, preview: preview.join('\n'), steps },
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
