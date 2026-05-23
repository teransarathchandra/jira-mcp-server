export type McpClientProfile =
  | 'generic'
  | 'claude-code'
  | 'claude-desktop'
  | 'codex-cli'
  | 'cursor'
  | 'windsurf'
  | 'vscode';

export interface PromptStyle {
  agentNameLabel: string;
  repoInspectionInstruction: string;
  implementationInstruction: string;
  prReviewInstruction: string;
}
