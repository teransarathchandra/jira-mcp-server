import { z } from 'zod';
import {
  deliveryScanProjectPatterns,
  deliveryGetProjectPatterns,
  deliveryClearProjectPatterns,
} from '../../tools/deliveryScanProjectPatterns.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { LOCAL_WRITE_DESTRUCTIVE } from '../annotations.js';
import type { ToolRegistrar } from '../types.js';

const NAME = 'delivery_project_patterns';

const ACTIONS = {
  scan: deliveryScanProjectPatterns,
  get: deliveryGetProjectPatterns,
  clear: deliveryClearProjectPatterns,
} as const;

export const registerDeliveryProjectPatterns: ToolRegistrar = (server) => {
  server.registerTool(
    NAME,
    {
      title: 'Scan, read or clear stored project patterns',
      description:
        'Detect the repository’s conventions (framework, test layout, tooling) and store them so other delivery tools ' +
        'can tailor their output. scan = detect and store, get = read stored patterns, clear = delete them. ' +
        'Storing requires DELIVERY_PATTERN_MEMORY_ENABLED=true in the server environment.',
      inputSchema: z.object({
        action: z.enum(['scan', 'get', 'clear']),
        repoPath: z.string().default('.').describe('Repository to inspect'),
      }),
      outputSchema: EnvelopeSchema,
      annotations: LOCAL_WRITE_DESTRUCTIVE,
    },
    async ({ action, repoPath }) => {
      try {
        return toolResult(NAME, await ACTIONS[action]({ repoPath }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
