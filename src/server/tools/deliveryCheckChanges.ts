import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { reviewPrAlignment } from '../../tools/reviewPrAlignment.js';
import { deliveryVerifyDefinitionOfDone } from '../../tools/deliveryVerifyDefinitionOfDone.js';
import { deliveryAnalyzeImplementationImpact } from '../../tools/deliveryAnalyzeImplementationImpact.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { formatError } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import { gitRefsShape } from '../gitRefs.js';
import type { ToolRegistrar } from '../types.js';
import { issueKeyField } from './jiraIssueInputs.js';

const NAME = 'delivery_check_changes';
const CHECK_ORDER = ['alignment', 'dod', 'impact'] as const;
type Check = (typeof CHECK_ORDER)[number];

export const registerDeliveryCheckChanges: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Check local changes against a Jira issue',
      description:
        'Check work on a Jira issue. alignment and dod compare the local diff with the acceptance criteria and ' +
        'Definition of Done — run them before opening a PR. impact predicts the affected areas and works before any code ' +
        'is written, so use checks ["impact"] when planning. Each check runs independently.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        checks: z
          .array(z.enum(CHECK_ORDER))
          .min(1)
          .default([...CHECK_ORDER])
          .describe('Which checks to run: alignment, dod, impact (default: all)'),
        ...gitRefsShape,
        includeConfluence: z.boolean().default(true).describe('Use Confluence context in the dod and impact checks'),
        maxDiffChars: z.number().int().min(1000).max(200000).default(50000).describe('Maximum diff characters to analyse'),
      }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ONLY_REMOTE,
    },
    async ({ issueKey, checks, baseBranch, compareRef, repoPath, includeConfluence, maxDiffChars }) => {
      const runners: Record<Check, () => Promise<string>> = {
        alignment: () =>
          reviewPrAlignment({ issueKey, mode: 'local_diff', baseBranch, compareRef, repoPath, maxDiffChars }, jiraClient, config),
        dod: () =>
          deliveryVerifyDefinitionOfDone({ issueKey, baseBranch, compareRef, repoPath, includeConfluence }, jiraClient, config),
        impact: () => deliveryAnalyzeImplementationImpact({ issueKey, includeConfluence }, jiraClient, config),
      };

      const sections: string[] = [];
      const warnings: string[] = [];
      const selected = CHECK_ORDER.filter((c) => checks.includes(c));
      for (const check of selected) {
        try {
          sections.push(await runners[check]());
        } catch (err) {
          sections.push(`## ⚠️ ${check} check failed\n\n${formatError(err)}`);
          warnings.push(`${check} check failed`);
        }
      }

      const markdown = sections.join('\n\n---\n\n');
      if (warnings.length === selected.length) {
        const failed: CallToolResult = { content: [{ type: 'text', text: markdown }], isError: true };
        return failed;
      }
      return toolResult(NAME, markdown, { issueKey, warnings });
    },
  );
};
