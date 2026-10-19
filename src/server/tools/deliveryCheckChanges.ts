import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { computeAlignment, DiffUnavailableError } from '../../tools/reviewPrAlignment.js';
import { computeDefinitionOfDone } from '../../tools/deliveryVerifyDefinitionOfDone.js';
import { computeImpact } from '../../tools/deliveryAnalyzeImplementationImpact.js';
import { CHECKS, CheckChangesDataSchema, type Check, type CheckChangesData } from '../../delivery/checkChangesTypes.js';
import { deriveVerdict } from '../../delivery/checkVerdict.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { formatError } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import { gitRefsShape } from '../gitRefs.js';
import type { ToolRegistrar } from '../types.js';
import { issueKeyField } from './jiraIssueInputs.js';

const NAME = 'delivery_check_changes';

export const registerDeliveryCheckChanges: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Check local changes against a Jira issue',
      description:
        'Check work on a Jira issue. alignment and dod compare the local diff with the acceptance criteria and ' +
        'Definition of Done — run them before opening a PR. impact predicts the affected areas and works before any code ' +
        'is written, so use checks ["impact"] when planning. Each check runs independently. ' +
        'Returns a verdict (ready_for_pr, needs_work, insufficient_evidence) and per-criterion coverage.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        checks: z
          .array(z.enum(CHECKS))
          .min(1)
          .default([...CHECKS])
          .describe('Which checks to run: alignment, dod, impact (default: all)'),
        ...gitRefsShape,
        includeConfluence: z.boolean().default(true).describe('Use Confluence context in the dod and impact checks'),
        maxDiffChars: z.number().int().min(1000).max(200000).default(50000).describe('Maximum diff characters to analyse'),
      }),
      outputSchema: EnvelopeSchema.extend({ data: CheckChangesDataSchema }),
      annotations: READ_ONLY_REMOTE,
    },
    async ({ issueKey, checks, baseBranch, compareRef, repoPath, includeConfluence, maxDiffChars }) => {
      const selected = CHECKS.filter((c) => checks.includes(c));
      const sections: string[] = [];
      const failedChecks: Check[] = [];
      const parts: Partial<Pick<CheckChangesData, 'alignment' | 'dod' | 'impact' | 'diff'>> = {};
      let diffUnreadable = false;
      let dodFilesChanged = 0;
      let dodReadDiff = false;

      const run = async (check: Check, body: () => Promise<string>) => {
        try {
          sections.push(await body());
        } catch (err) {
          if (err instanceof DiffUnavailableError) diffUnreadable = true;
          sections.push(`## ⚠️ ${check} check failed\n\n${formatError(err)}`);
          failedChecks.push(check);
        }
      };

      for (const check of selected) {
        if (check === 'alignment') {
          await run(check, async () => {
            const result = await computeAlignment(
              { issueKey, mode: 'local_diff', baseBranch, compareRef, repoPath, maxDiffChars },
              jiraClient,
              config,
            );
            parts.alignment = result.data;
            parts.diff = result.diff;
            return result.markdown;
          });
        } else if (check === 'dod') {
          await run(check, async () => {
            const result = await computeDefinitionOfDone({ issueKey, baseBranch, compareRef, repoPath, includeConfluence }, jiraClient, config);
            parts.dod = result.data;
            if (!result.diffRead) diffUnreadable = true;
            // The DoD read the diff itself; use its count when alignment did not run.
            dodFilesChanged = result.filesChanged;
            dodReadDiff = result.diffRead;
            return result.markdown;
          });
        } else {
          await run(check, async () => {
            const result = await computeImpact({ issueKey, includeConfluence }, jiraClient, config);
            parts.impact = result.data;
            return result.markdown;
          });
        }
      }

      const markdown = sections.join('\n\n---\n\n');
      if (failedChecks.length === selected.length) {
        const failed: CallToolResult = { content: [{ type: 'text', text: markdown }], isError: true };
        return failed;
      }

      const diff = parts.diff ?? { baseBranch, compareRef, filesChanged: dodFilesChanged, truncated: false };
      const diffKnown = parts.diff !== undefined || dodReadDiff;
      const data: CheckChangesData = {
        ...deriveVerdict({ selected, ...parts, diff: diffKnown ? diff : undefined, failedChecks, diffUnreadable, baseBranch }),
        ...parts,
        failedChecks,
        diff,
      };
      return toolResult(NAME, markdown, {
        issueKey,
        warnings: failedChecks.map((c) => `${c} check failed`),
        data,
      });
    },
  );
};
