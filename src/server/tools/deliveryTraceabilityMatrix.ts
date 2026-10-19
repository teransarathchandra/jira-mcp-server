import { z } from 'zod';
import { deliveryGetTraceabilityMatrix } from '../../tools/deliveryGetTraceabilityMatrix.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { READ_ONLY_REMOTE } from '../annotations.js';
import { gitRefsShape } from '../gitRefs.js';
import type { ToolRegistrar } from '../types.js';
import { issueKeyField } from './jiraIssueInputs.js';

const NAME = 'delivery_traceability_matrix';

export const registerDeliveryTraceabilityMatrix: ToolRegistrar = (server, { config, jiraClient }) => {
  server.registerTool(
    NAME,
    {
      title: 'Build a requirement traceability matrix',
      description:
        'Map each requirement and acceptance criterion of a Jira issue to the changed files that implement it, and flag gaps.',
      inputSchema: z.object({
        issueKey: issueKeyField(config),
        ...gitRefsShape,
        includeConfluence: z.boolean().default(true).describe('Include requirements found in Confluence'),
        includePrDiff: z.boolean().default(true).describe('Match requirements against the local diff'),
      }),
      outputSchema: EnvelopeSchema,
      annotations: READ_ONLY_REMOTE,
    },
    async (input) => {
      try {
        return toolResult(NAME, await deliveryGetTraceabilityMatrix(input, jiraClient, config), { issueKey: input.issueKey });
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
