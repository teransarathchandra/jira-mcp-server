import { z } from 'zod';
import { prepareWorkPrompt } from '../../tools/prepareWorkPrompt.js';
import { prepareContextualWorkPrompt } from '../../tools/prepareContextualWorkPrompt.js';
import { jiraPrepareConfluenceEnrichedWorkPrompt } from '../../tools/jiraPrepareConfluenceEnrichedWorkPrompt.js';
import { fetchIssueContext } from '../../jira/issueContextService.js';
import { buildWorkBriefData } from '../../delivery/workBriefGuidance.js';
import { WorkBriefDataSchema, type WorkBriefData } from '../../delivery/workBriefTypes.js';
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

const ELICITATION_TIMEOUT_MS = 60_000;
const MAX_ANSWER_CHARS = 500;
// C0 controls other than tab, newline and carriage return, plus DEL.
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

type Question = WorkBriefData['clarifyingQuestions'][number];
type ElicitInput = (
  params: { message: string; requestedSchema: { type: 'object'; properties: Record<string, { type: 'string'; title: string; maxLength: number }> } },
  options?: { timeout?: number },
) => Promise<{ action: string; content?: Record<string, unknown> }>;

/**
 * Asks the material questions in one client form. Answers stay in this
 * response only: they are not logged, cached or treated as Jira evidence.
 * Any decline, cancel, timeout or error leaves the questions unanswered.
 */
async function askClarifyingQuestions(questions: Question[], elicitInput: ElicitInput): Promise<Question[]> {
  const properties = Object.fromEntries(
    questions.map((q, i) => [`q${i}`, { type: 'string' as const, title: q.text, maxLength: MAX_ANSWER_CHARS }]),
  );
  try {
    const result = await elicitInput(
      { message: 'A few questions could change how this ticket should be approached.', requestedSchema: { type: 'object', properties } },
      { timeout: ELICITATION_TIMEOUT_MS },
    );
    if (result.action !== 'accept' || !result.content) return questions;
    const content = result.content;
    return questions.map((q, i) => {
      const answer = content[`q${i}`];
      const valid = typeof answer === 'string' && answer.trim() !== '' && answer.length <= MAX_ANSWER_CHARS && !CONTROL_CHARS.test(answer);
      return valid ? { ...q, answer: answer.trim() } : q;
    });
  } catch {
    return questions;
  }
}

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
        allowElicitation: z
          .boolean()
          .default(false)
          .describe('If the client supports it, ask the user the clarifying questions in a form before answering'),
      }),
      outputSchema: EnvelopeSchema.extend({ data: WorkBriefDataSchema }),
      annotations: READ_ONLY_REMOTE,
    },
    async ({ issueKey, depth, includeConfluence, allowElicitation }, ctx) => {
      try {
        // Guidance always uses full-depth context; `depth` only shapes the prompt.
        const context = await fetchIssueContext(issueKey, { ...CONTEXT_FETCH_DEFAULTS }, jiraClient, config);
        const data = buildWorkBriefData(context, config);
        if (allowElicitation && data.clarifyingQuestions.length > 0 && server.server.getClientCapabilities()?.elicitation) {
          data.clarifyingQuestions = await askClarifyingQuestions(data.clarifyingQuestions, ctx.mcpReq.elicitInput);
        }

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
