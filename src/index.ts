#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { getConfig } from './config.js';
import { JiraClient } from './jiraClient.js';
import { getIssue } from './tools/getIssue.js';
import { searchMyIssues } from './tools/searchMyIssues.js';
import { prepareWorkPrompt } from './tools/prepareWorkPrompt.js';
import { getIssueContext } from './tools/getIssueContext.js';
import { prepareContextualWorkPrompt } from './tools/prepareContextualWorkPrompt.js';
import {
  JiraAuthError,
  JiraNotFoundError,
  JiraRateLimitError,
  JiraServerError,
  JiraNetworkError,
} from './jiraClient.js';

// Input schemas for each tool
const GetIssueSchema = z.object({
  issueKey: z.string().describe('Jira issue key (e.g., CMPI-1234)'),
  includeComments: z.boolean().optional().default(true).describe('Include comments in the brief'),
  includeAttachments: z.boolean().optional().default(true).describe('Include attachment list in the brief'),
});

const SearchMyIssuesSchema = z.object({
  maxResults: z.number().int().min(1).max(50).optional().default(10).describe('Maximum number of issues to return'),
});

const PrepareWorkPromptSchema = z.object({
  issueKey: z.string().describe('Jira issue key to prepare implementation prompt for (e.g., CMPI-1234)'),
});

const GetIssueContextSchema = z.object({
  issueKey: z.string().describe('Jira issue key (e.g., CMPI-1234)'),
  includeComments: z.boolean().optional().default(true),
  includeParent: z.boolean().optional().default(true),
  includeEpic: z.boolean().optional().default(true),
  includeLinkedIssues: z.boolean().optional().default(true),
  includeSubtasks: z.boolean().optional().default(true),
  includeEpicSiblings: z.boolean().optional().default(false),
  maxLinkedIssues: z.number().int().min(1).max(15).optional().default(8),
  maxSubtasks: z.number().int().min(1).max(20).optional().default(10),
  maxCommentsPerIssue: z.number().int().min(1).max(20).optional().default(10),
  contextDepth: z.number().int().min(1).max(2).optional().default(1),
});

const PrepareContextualWorkPromptSchema = z.object({
  issueKey: z.string().describe('Jira issue key (e.g., CMPI-1234)'),
  includeComments: z.boolean().optional().default(true),
  includeParent: z.boolean().optional().default(true),
  includeEpic: z.boolean().optional().default(true),
  includeLinkedIssues: z.boolean().optional().default(true),
  includeSubtasks: z.boolean().optional().default(true),
  includeEpicSiblings: z.boolean().optional().default(false),
});

// Tool definitions for MCP list_tools
const TOOLS = [
  {
    name: 'jira_get_issue',
    description: 'Fetch a Jira issue by key and return a clean, developer-friendly task brief with description, acceptance criteria, technical notes, comments, and an implementation prompt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        includeComments: { type: 'boolean', description: 'Include comments (default: true)' },
        includeAttachments: { type: 'boolean', description: 'Include attachments (default: true)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'jira_search_my_open_issues',
    description: 'Search for open Jira CMPI issues assigned to the authenticated user.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        maxResults: { type: 'number', description: 'Max results to return (1-50, default: 10)' },
      },
      required: [],
    },
  },
  {
    name: 'jira_prepare_work_prompt',
    description: 'Fetch a Jira issue and return only the implementation prompt suitable for pasting directly into Claude Code or Codex.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'jira_get_issue_context',
    description: 'Fetch a Jira issue and its surrounding context (parent, epic, linked issues, subtasks, comments) to produce a comprehensive developer brief for implementing the full requirement.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        includeComments: { type: 'boolean', description: 'Include analyzed comments (default: true)' },
        includeParent: { type: 'boolean', description: 'Include parent issue context (default: true)' },
        includeEpic: { type: 'boolean', description: 'Include epic context (default: true)' },
        includeLinkedIssues: { type: 'boolean', description: 'Include linked issues (default: true)' },
        includeSubtasks: { type: 'boolean', description: 'Include subtasks (default: true)' },
        includeEpicSiblings: { type: 'boolean', description: 'Include sibling issues under the same epic (default: false — may add noise)' },
        maxLinkedIssues: { type: 'number', description: 'Max linked issues to fetch (1-15, default: 8)' },
        maxSubtasks: { type: 'number', description: 'Max subtasks (1-20, default: 10)' },
        maxCommentsPerIssue: { type: 'number', description: 'Max comments per issue (1-20, default: 10)' },
        contextDepth: { type: 'number', description: 'Context depth (1-2, default: 1)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'jira_prepare_contextual_work_prompt',
    description: 'Fetch a Jira issue with full surrounding context and return only the final implementation prompt suitable for pasting directly into Claude Code or Codex.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        includeComments: { type: 'boolean', description: 'Include comments (default: true)' },
        includeParent: { type: 'boolean', description: 'Include parent context (default: true)' },
        includeEpic: { type: 'boolean', description: 'Include epic context (default: true)' },
        includeLinkedIssues: { type: 'boolean', description: 'Include linked issues (default: true)' },
        includeSubtasks: { type: 'boolean', description: 'Include subtasks (default: true)' },
        includeEpicSiblings: { type: 'boolean', description: 'Include epic siblings (default: false)' },
      },
      required: ['issueKey'],
    },
  },
];

async function main() {
  // Validate env vars at startup — fail fast with clear error
  const config = getConfig();
  const client = new JiraClient(config);

  const server = new Server(
    { name: 'jira-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  // list_tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // call_tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      switch (name) {
        case 'jira_get_issue': {
          const input = GetIssueSchema.parse(args);
          const result = await getIssue(input, client);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'jira_search_my_open_issues': {
          const input = SearchMyIssuesSchema.parse(args);
          const result = await searchMyIssues(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'jira_prepare_work_prompt': {
          const input = PrepareWorkPromptSchema.parse(args);
          const result = await prepareWorkPrompt(input, client);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'jira_get_issue_context': {
          const input = GetIssueContextSchema.parse(args);
          const result = await getIssueContext(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'jira_prepare_contextual_work_prompt': {
          const input = PrepareContextualWorkPromptSchema.parse(args);
          const result = await prepareContextualWorkPrompt(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (err) {
      // Map known errors to user-friendly messages
      const message = formatError(err);
      return {
        content: [{ type: 'text', text: message }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

function formatError(err: unknown): string {
  if (err instanceof JiraAuthError) return `Authentication error: ${err.message}`;
  if (err instanceof JiraNotFoundError) return `Not found: ${err.message}`;
  if (err instanceof JiraRateLimitError) return `Rate limited: ${err.message}`;
  if (err instanceof JiraServerError) return `Jira server error: ${err.message}`;
  if (err instanceof JiraNetworkError) return `Network error: ${err.message}`;
  if (err instanceof z.ZodError) {
    const issues = err.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return `Invalid input: ${issues}`;
  }
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Unexpected error: ${String(err)}`;
}

main().catch((err) => {
  console.error('Fatal error starting Jira MCP server:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
