import { z } from 'zod';
import { deliveryGenerateClaudeWorkflowPack } from '../../tools/deliveryGenerateClaudeWorkflowPack.js';
import { deliveryGenerateCodexPromptPack } from '../../tools/deliveryGenerateCodexPromptPack.js';
import { deliveryGenerateGenericPromptPack } from '../../tools/deliveryGenerateGenericPromptPack.js';
import { EnvelopeSchema, toolResult } from '../envelope.js';
import { errorResult } from '../errors.js';
import { LOCAL_WRITE_DESTRUCTIVE } from '../annotations.js';
import type { ToolRegistrar } from '../types.js';

const NAME = 'delivery_generate_agent_pack';

const GENERATORS = {
  claude: deliveryGenerateClaudeWorkflowPack,
  codex: deliveryGenerateCodexPromptPack,
  generic: deliveryGenerateGenericPromptPack,
} as const;

export const registerDeliveryGenerateAgentPack: ToolRegistrar = (server) => {
  server.registerTool(
    NAME,
    {
      title: 'Write an agent workflow pack into the repo',
      description:
        'Write reusable Jira delivery prompts/commands for a coding agent into the repository ' +
        '(claude: .claude/commands and .claude/skills, codex: .codex-prompts/, generic: .mcp-prompts/).',
      inputSchema: z.object({
        client: z.enum(['claude', 'codex', 'generic']),
        repoPath: z.string().default('.').describe('Repository to write the pack into'),
        overwrite: z.boolean().default(false).describe('Replace files that already exist'),
      }),
      outputSchema: EnvelopeSchema,
      annotations: LOCAL_WRITE_DESTRUCTIVE,
    },
    async ({ client, repoPath, overwrite }) => {
      try {
        return toolResult(NAME, await GENERATORS[client]({ repoPath, overwrite }));
      } catch (err) {
        return errorResult(err);
      }
    },
  );
};
