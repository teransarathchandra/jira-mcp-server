import { McpClientProfile, PromptStyle } from './clientProfile.js';

const VALID_PROFILES: McpClientProfile[] = [
  'generic',
  'claude-code',
  'claude-desktop',
  'codex-cli',
  'cursor',
  'windsurf',
  'vscode',
];

export function parseClientProfile(envValue?: string): McpClientProfile {
  if (!envValue) return 'generic';
  const normalized = envValue.trim().toLowerCase() as McpClientProfile;
  if (VALID_PROFILES.includes(normalized)) return normalized;
  return 'generic';
}

export function getClientDisplayName(profile: McpClientProfile): string {
  switch (profile) {
    case 'generic':        return 'Generic MCP Client';
    case 'claude-code':    return 'Claude Code';
    case 'claude-desktop': return 'Claude Desktop';
    case 'codex-cli':      return 'Codex CLI';
    case 'cursor':         return 'Cursor';
    case 'windsurf':       return 'Windsurf';
    case 'vscode':         return 'VS Code';
  }
}

function getSetupSteps(profile: McpClientProfile, serverName: string, serverCommand: string, serverArgs: string[]): string {
  const argsStr = serverArgs.join(' ');
  switch (profile) {
    case 'generic':
      return '1. Build the server: `npm run build`\n2. Configure your MCP client to launch the server via stdio.\n3. Pass credentials via environment variables.';
    case 'claude-code':
      return `1. Build the server: \`npm run build\`\n2. Run: \`claude mcp add ${serverName} ${serverCommand} -- ${argsStr}\`\n3. Pass credentials via environment variables or \`.env\` file.`;
    case 'claude-desktop':
      return '1. Build the server: `npm run build`\n2. Add the server to `claude_desktop_config.json` under `mcpServers`.\n3. Restart Claude Desktop.';
    case 'codex-cli':
      return '1. Build the server: `npm run build`\n2. Add the server to `~/.codex/config.toml` under `[mcp_servers]`.\n3. Pass credentials via environment variables.';
    case 'cursor':
      return '1. Build the server: `npm run build`\n2. Open Cursor Settings → Features → MCP → Add Server.\n3. Enter the command and args.';
    case 'windsurf':
      return '1. Build the server: `npm run build`\n2. Open Windsurf Settings → MCP Servers → Add.\n3. Enter the server command and args.';
    case 'vscode':
      return '1. Build the server: `npm run build`\n2. Configure the server in your VS Code MCP extension settings.\n3. Pass credentials via environment variables.';
  }
}

function getExampleUsage(_profile: McpClientProfile): string {
  return [
    'Use the Jira Delivery MCP server to fetch <ISSUE-KEY> and prepare an implementation plan.',
    'Use the Jira Delivery MCP server to review your current branch against <ISSUE-KEY>.',
    'Use the Jira Delivery MCP server to verify Definition of Done for <ISSUE-KEY>.',
  ].join('\n');
}

export function getClientSetupInstructions(
  profile: McpClientProfile,
  serverName: string,
  serverCommand: string,
  serverArgs: string[],
): string {
  const displayName = getClientDisplayName(profile);
  const argsStr = serverArgs.join(' ');
  const steps = getSetupSteps(profile, serverName, serverCommand, serverArgs);
  const examples = getExampleUsage(profile);

  return [
    `# MCP Setup Instructions: ${displayName}`,
    '',
    '## Server',
    `- Name: ${serverName}`,
    `- Command: ${serverCommand}`,
    `- Args: ${argsStr}`,
    '',
    '## Setup Steps',
    steps,
    '',
    '## Example Usage',
    examples,
  ].join('\n');
}

export function getClientExampleCommands(profile: McpClientProfile, exampleIssueKey: string): string[] {
  const examples = [
    `Fetch ${exampleIssueKey} and prepare an implementation plan`,
    `Review my current branch against ${exampleIssueKey}`,
    `Verify Definition of Done for ${exampleIssueKey}`,
    `Generate QA handoff for ${exampleIssueKey}`,
    `Generate test strategy for ${exampleIssueKey}`,
  ];

  if (profile === 'claude-code') {
    examples.push(`Run jira_get_issue_with_confluence_context for ${exampleIssueKey}`);
  }

  return examples;
}

export function getClientPromptStyle(profile: McpClientProfile): PromptStyle {
  if (profile === 'claude-code') {
    return {
      agentNameLabel: 'Claude Code',
      repoInspectionInstruction: 'Claude Code should inspect the repository before making changes.',
      implementationInstruction: 'Use Claude Code to implement the changes.',
      prReviewInstruction: 'Use Claude Code to review PR alignment against the Jira requirement.',
    };
  }

  return {
    agentNameLabel: 'The coding agent',
    repoInspectionInstruction: 'The coding agent should inspect the repository before making changes.',
    implementationInstruction: 'Use your MCP client or coding agent to implement the changes.',
    prReviewInstruction: 'Use your MCP client to review PR alignment against the Jira requirement.',
  };
}
