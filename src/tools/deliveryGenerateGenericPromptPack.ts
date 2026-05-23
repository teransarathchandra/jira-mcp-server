import { generateGenericPromptPack } from '../genericPrompts/genericPromptPackGenerator.js';

export interface DeliveryGenerateGenericPromptPackInput {
  repoPath: string;
  overwrite: boolean;
}

export async function deliveryGenerateGenericPromptPack(
  input: DeliveryGenerateGenericPromptPackInput,
): Promise<string> {
  const result = generateGenericPromptPack(input);

  const lines: string[] = [];
  lines.push('# Generic MCP Prompt Pack');
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
