// ── Delivery Intelligence Layer — Generate Claude Workflow Pack Tool ───────────
// MCP tool handler: generate optional Claude Code workflow asset files under a
// target repo's .claude/ directory. No Jira/network calls needed.

import { generateWorkflowPack } from '../claudeWorkflow/workflowPackGenerator.js';

// ── Input type ────────────────────────────────────────────────────────────────

export interface DeliveryGenerateWorkflowPackInput {
  repoPath: string;
  overwrite: boolean;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function deliveryGenerateClaudeWorkflowPack(
  input: DeliveryGenerateWorkflowPackInput,
): Promise<string> {
  const result = generateWorkflowPack(input);

  const lines: string[] = [];

  lines.push('# Claude Code Workflow Pack');
  lines.push('');

  if (result.generated.length > 0) {
    lines.push('Generated files:');
    for (const filePath of result.generated) {
      lines.push(`- ${filePath}`);
    }
    lines.push('');
  } else {
    lines.push('No new files generated.');
    lines.push('');
  }

  if (result.skipped.length > 0) {
    lines.push('Skipped (already exist):');
    for (const filePath of result.skipped) {
      lines.push(`- ${filePath}`);
    }
    lines.push('');
  }

  lines.push('## Usage Examples');
  for (const example of result.usageExamples) {
    lines.push(`- ${example}`);
  }

  return lines.join('\n');
}
