import { z } from 'zod';
import { deliveryGenerateTestStrategy } from '../../tools/deliveryGenerateTestStrategy.js';
import { deliveryGenerateReviewerReport } from '../../tools/deliveryGenerateReviewerReport.js';
import { deliveryGenerateQaHandoff } from '../../tools/deliveryGenerateQaHandoff.js';
import { deliveryGenerateReleaseNotes } from '../../tools/deliveryGenerateReleaseNotes.js';
import { deliveryExportTaskReport } from '../../tools/deliveryExportTaskReport.js';
import type { ReportSection } from '../../delivery/exportTaskReport.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import { gitRefsShape } from '../gitRefs.js';
import type { ToolRegistrar } from '../types.js';
import { issueKeyField } from './jiraIssueInputs.js';

const NAME = 'delivery_generate';

const PERSONAS = [
  'product_reviewer',
  'frontend_reviewer',
  'backend_reviewer',
  'qa_reviewer',
  'security_reviewer',
  'release_reviewer',
] as const;

const REPORT_SECTIONS = [
  'context',
  'impact',
  'traceability',
  'pr_alignment',
  'definition_of_done',
  'test_strategy',
  'qa_handoff',
  'release_notes',
] as const satisfies readonly ReportSection[];

const DEFAULT_REPORT_SECTIONS: ReportSection[] = ['context', 'impact', 'traceability', 'definition_of_done', 'test_strategy', 'qa_handoff'];

export const registerDeliveryGenerate: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Generate a delivery document for a Jira issue',
      description:
        'Generate a delivery artifact from a Jira issue and the local diff: test_strategy, reviewer_report (needs persona), ' +
        'qa_handoff, release_notes (audience) or task_report (combined sections). Use test_strategy to plan tests and ' +
        'reviewer_report to review a ticket from a persona\'s point of view. Fetches the issue itself. Returns Markdown; writes no files.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        type: z.enum(['test_strategy', 'reviewer_report', 'qa_handoff', 'release_notes', 'task_report']),
        persona: z.enum(PERSONAS).optional().describe('Required when type is reviewer_report'),
        audience: z.enum(['internal', 'qa', 'product', 'customer_safe']).default('internal').describe('release_notes only'),
        sections: z.array(z.enum(REPORT_SECTIONS)).default(DEFAULT_REPORT_SECTIONS).describe('task_report only: sections to include'),
        includePrDiff: z.boolean().default(false).describe('test_strategy only: include the local diff'),
        ...gitRefsShape,
        includeConfluence: z.boolean().default(true),
      }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ONLY_REMOTE,
    },
    async (input) => {
      const { issueKey, type, persona, audience, sections, includePrDiff, baseBranch, compareRef, repoPath, includeConfluence } = input;
      if (type === 'reviewer_report' && persona === undefined) {
        return {
          content: [{ type: 'text', text: 'Invalid input: persona is required when type is reviewer_report' }],
          isError: true,
        };
      }
      const common = { issueKey, baseBranch, compareRef, repoPath, includeConfluence };
      try {
        let markdown: string;
        switch (type) {
          case 'test_strategy':
            markdown = await deliveryGenerateTestStrategy({ ...common, includePrDiff }, jiraClient, config);
            break;
          case 'reviewer_report':
            markdown = await deliveryGenerateReviewerReport({ ...common, persona: persona! }, jiraClient, config);
            break;
          case 'qa_handoff':
            markdown = await deliveryGenerateQaHandoff(common, jiraClient, config);
            break;
          case 'release_notes':
            markdown = await deliveryGenerateReleaseNotes({ ...common, audience }, jiraClient, config);
            break;
          case 'task_report':
            markdown = await deliveryExportTaskReport({ ...common, sections }, jiraClient, config);
            break;
        }
        return toolResult(NAME, markdown, { issueKey });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
