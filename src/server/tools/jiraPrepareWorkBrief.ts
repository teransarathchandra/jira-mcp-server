import { z } from 'zod';
import { prepareWorkPrompt } from '../../tools/prepareWorkPrompt.js';
import { prepareContextualWorkPrompt } from '../../tools/prepareContextualWorkPrompt.js';
import { jiraPrepareConfluenceEnrichedWorkPrompt } from '../../tools/jiraPrepareConfluenceEnrichedWorkPrompt.js';
import { fetchIssueContext } from '../../jira/issueContextService.js';
import { buildWorkBriefData } from '../../delivery/workBriefGuidance.js';
import { WorkBriefDataSchema } from '../../delivery/workBriefTypes.js';
import { formatStartHere } from '../../delivery/formatStartHere.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import type { ToolRegistrar } from '../types.js';
import {
  issueKeyField,
  depthField,
  includeConfluenceField,
  CONTEXT_INCLUDE_DEFAULTS,
  CONTEXT_FETCH_DEFAULTS,
  CONFLUENCE_BRIEF_DEFAULTS,
} from './jiraIssueInputs.js';

const NAME = 'jira_prepare_work_brief';

export const registerJiraPrepareWorkBrief: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Prepare a work brief for a Jira issue',
      description:
        'Turn a Jira issue into a ready-to-implement brief for a coding agent: goal, acceptance criteria, ' +
        'constraints and an implementation prompt. Use this when starting work on a ticket.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        depth: depthField,
        includeConfluence: includeConfluenceField,
      }),
      outputSchema: EnvelopeSchema.extend({ data: WorkBriefDataSchema }),
      annotations: READ_ONLY_REMOTE,
    },
    async ({ issueKey, depth, includeConfluence }) => {
      try {
        // Guidance always uses full-depth context; `depth` only shapes the prompt.
        const context = await fetchIssueContext(issueKey, { ...CONTEXT_FETCH_DEFAULTS }, jiraClient, config);
        const data = buildWorkBriefData(context, config);

        let prompt: string;
        if (includeConfluence) {
          prompt = await jiraPrepareConfluenceEnrichedWorkPrompt({ issueKey, ...CONFLUENCE_BRIEF_DEFAULTS }, jiraClient, config);
        } else if (depth === 'full') {
          prompt = await prepareContextualWorkPrompt({ issueKey, ...CONTEXT_INCLUDE_DEFAULTS }, jiraClient, config);
        } else {
          prompt = await prepareWorkPrompt({ issueKey }, jiraClient);
        }
        return toolResult(NAME, `${formatStartHere(data)}\n\n${prompt}`, { issueKey, data });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
