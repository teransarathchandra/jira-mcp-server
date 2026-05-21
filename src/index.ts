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
import { reviewPrAlignment } from './tools/reviewPrAlignment.js';
import { preparePrReviewPrompt } from './tools/preparePrReviewPrompt.js';
import { confluenceSearchRelatedPages } from './tools/confluenceSearchRelatedPages.js';
import { confluenceGetPageSummary } from './tools/confluenceGetPageSummary.js';
import { jiraGetIssueWithConfluenceContext } from './tools/jiraGetIssueWithConfluenceContext.js';
import { jiraPrepareConfluenceEnrichedWorkPrompt } from './tools/jiraPrepareConfluenceEnrichedWorkPrompt.js';
import {
  JiraAuthError,
  JiraNotFoundError,
  JiraRateLimitError,
  JiraServerError,
  JiraNetworkError,
} from './jiraClient.js';
import {
  ConfluenceAuthError,
  ConfluenceNotFoundError,
  ConfluenceRateLimitError,
  ConfluenceServerError,
  ConfluenceNetworkError,
  ConfluenceNotConfiguredError,
} from './confluence/confluenceConfig.js';

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

const ReviewPrAlignmentSchema = z.object({
  issueKey: z.string().describe('Jira issue key (e.g., CMPI-1234)'),
  mode: z.enum(['local_diff', 'github_pr']).optional().default('local_diff').describe('Diff mode: local_diff (default) or github_pr'),
  baseBranch: z.string().optional().default('origin/main').describe('Base branch to diff against (default: origin/main)'),
  compareRef: z.string().optional().default('HEAD').describe('Compare ref (branch name or commit SHA, default: HEAD)'),
  prNumber: z.number().int().positive().optional().nullable().default(null).describe('GitHub PR number (only for github_pr mode)'),
  repoPath: z.string().optional().default('.').describe('Path to the git repository (default: current directory)'),
  maxDiffChars: z.number().int().min(1000).max(200000).optional().default(50000).describe('Maximum diff characters to analyze (default: 50000)'),
});

const PreparePrReviewPromptSchema = z.object({
  issueKey: z.string().describe('Jira issue key (e.g., CMPI-1234)'),
  baseBranch: z.string().optional().default('origin/main').describe('Base branch to diff against (default: origin/main)'),
  compareRef: z.string().optional().default('HEAD').describe('Compare ref (default: HEAD)'),
  repoPath: z.string().optional().default('.').describe('Path to the git repository (default: current directory)'),
});

const ConfluenceSearchRelatedPagesSchema = z.object({
  issueKey: z.string().describe('Jira issue key (e.g., CMPI-1234)'),
  maxResults: z.number().int().min(1).max(50).optional().default(10).describe('Maximum number of search results (1-50, default: 10)'),
  spaceKeys: z.array(z.string()).optional().default([]).describe('Confluence space keys to restrict search to (default: all configured spaces)'),
  includeLowRelevance: z.boolean().optional().default(false).describe('Include low-relevance pages in results (default: false)'),
});

const ConfluenceGetPageSummarySchema = z.object({
  pageId: z.string().describe('Confluence page ID'),
  maxChars: z.number().int().min(1000).max(50000).optional().default(12000).describe('Maximum characters of page body to include (1000-50000, default: 12000)'),
});

const JiraGetIssueWithConfluenceContextSchema = z.object({
  issueKey: z.string().describe('Jira issue key (e.g., CMPI-1234)'),
  includeJiraComments: z.boolean().optional().default(true).describe('Include Jira comments (default: true)'),
  includeParent: z.boolean().optional().default(true).describe('Include parent issue context (default: true)'),
  includeEpic: z.boolean().optional().default(true).describe('Include epic context (default: true)'),
  includeLinkedIssues: z.boolean().optional().default(true).describe('Include linked issues (default: true)'),
  includeSubtasks: z.boolean().optional().default(true).describe('Include subtasks (default: true)'),
  includeConfluence: z.boolean().optional().default(true).describe('Include Confluence context (default: true)'),
  confluenceMaxSearchResults: z.number().int().min(1).max(50).optional().describe('Max Confluence search results'),
  confluenceMaxPagesToRead: z.number().int().min(1).max(20).optional().describe('Max Confluence pages to read'),
  includeMediumRelevancePages: z.boolean().optional().default(true).describe('Include medium-relevance Confluence pages (default: true)'),
  includeLowRelevancePages: z.boolean().optional().default(false).describe('Include low-relevance Confluence pages (default: false)'),
  maxConfluenceChars: z.number().int().min(1000).optional().describe('Max characters per Confluence page'),
});

const JiraPrepareConfluenceEnrichedWorkPromptSchema = z.object({
  issueKey: z.string().describe('Jira issue key (e.g., CMPI-1234)'),
  includeConfluence: z.boolean().optional().default(true).describe('Include Confluence context enrichment (default: true)'),
  confluenceMaxPagesToRead: z.number().int().min(1).max(20).optional().default(5).describe('Max Confluence pages to read (1-20, default: 5)'),
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
  {
    name: 'jira_review_pr_alignment',
    description: 'Review a PR or local branch against a Jira task requirement. Compares the Jira requirement, acceptance criteria, and technical signals against changed files and diff to produce an evidence-based alignment report with score, matched requirements, missing requirements, unrelated changes, and review comments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        mode: { type: 'string', enum: ['local_diff', 'github_pr'], description: 'Diff mode (default: local_diff)' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref — branch name or commit SHA (default: HEAD)' },
        prNumber: { type: 'number', description: 'GitHub PR number — only for github_pr mode' },
        repoPath: { type: 'string', description: 'Path to the git repository (default: current directory)' },
        maxDiffChars: { type: 'number', description: 'Max diff characters to analyze (1000-200000, default: 50000)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'jira_prepare_pr_review_prompt',
    description: 'Prepare a focused Claude Code review prompt for reviewing a PR against a Jira task requirement. The prompt includes the Jira requirement summary, acceptance criteria, changed files, and review instructions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref (default: HEAD)' },
        repoPath: { type: 'string', description: 'Path to the git repository (default: current directory)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'confluence_search_related_pages',
    description: 'Search Confluence for pages related to a Jira issue. Scores and ranks pages by relevance to help understand the full requirement context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        maxResults: { type: 'number', description: 'Maximum number of search results (1-50, default: 10)' },
        spaceKeys: { type: 'array', items: { type: 'string' }, description: 'Confluence space keys to restrict search to (default: all configured spaces)' },
        includeLowRelevance: { type: 'boolean', description: 'Include low-relevance pages in results (default: false)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'confluence_get_page_summary',
    description: 'Fetch a Confluence page by ID and return a coding-agent-friendly summary with metadata, key sections, and extracted requirement signals.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pageId: { type: 'string', description: 'Confluence page ID' },
        maxChars: { type: 'number', description: 'Maximum characters of page body to include (1000-50000, default: 12000)' },
      },
      required: ['pageId'],
    },
  },
  {
    name: 'jira_get_issue_with_confluence_context',
    description: 'Fetch a Jira issue with full surrounding context enriched by relevant Confluence documentation. Produces a comprehensive brief with Jira requirements, Confluence insights, conflicts, and a final implementation prompt.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        includeJiraComments: { type: 'boolean', description: 'Include Jira comments (default: true)' },
        includeParent: { type: 'boolean', description: 'Include parent issue context (default: true)' },
        includeEpic: { type: 'boolean', description: 'Include epic context (default: true)' },
        includeLinkedIssues: { type: 'boolean', description: 'Include linked issues (default: true)' },
        includeSubtasks: { type: 'boolean', description: 'Include subtasks (default: true)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
        confluenceMaxSearchResults: { type: 'number', description: 'Max Confluence search results' },
        confluenceMaxPagesToRead: { type: 'number', description: 'Max Confluence pages to read' },
        includeMediumRelevancePages: { type: 'boolean', description: 'Include medium-relevance Confluence pages (default: true)' },
        includeLowRelevancePages: { type: 'boolean', description: 'Include low-relevance Confluence pages (default: false)' },
        maxConfluenceChars: { type: 'number', description: 'Max characters per Confluence page' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'jira_prepare_confluence_enriched_work_prompt',
    description: 'Fetch a Jira issue with Confluence context and return only the final implementation prompt enriched with Confluence documentation insights.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context enrichment (default: true)' },
        confluenceMaxPagesToRead: { type: 'number', description: 'Max Confluence pages to read (1-20, default: 5)' },
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

        case 'jira_review_pr_alignment': {
          const input = ReviewPrAlignmentSchema.parse(args);
          const result = await reviewPrAlignment(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'jira_prepare_pr_review_prompt': {
          const input = PreparePrReviewPromptSchema.parse(args);
          const result = await preparePrReviewPrompt(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'confluence_search_related_pages': {
          const input = ConfluenceSearchRelatedPagesSchema.parse(args);
          const result = await confluenceSearchRelatedPages(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'confluence_get_page_summary': {
          const input = ConfluenceGetPageSummarySchema.parse(args);
          const result = await confluenceGetPageSummary(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'jira_get_issue_with_confluence_context': {
          const input = JiraGetIssueWithConfluenceContextSchema.parse(args);
          const result = await jiraGetIssueWithConfluenceContext(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'jira_prepare_confluence_enriched_work_prompt': {
          const input = JiraPrepareConfluenceEnrichedWorkPromptSchema.parse(args);
          const result = await jiraPrepareConfluenceEnrichedWorkPrompt(input, client, config);
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
  if (err instanceof ConfluenceNotConfiguredError) return `Confluence not configured: ${err.message}`;
  if (err instanceof ConfluenceAuthError) return `Confluence authentication error: ${err.message}`;
  if (err instanceof ConfluenceNotFoundError) return `Confluence not found: ${err.message}`;
  if (err instanceof ConfluenceRateLimitError) return `Confluence rate limited: ${err.message}`;
  if (err instanceof ConfluenceServerError) return `Confluence server error: ${err.message}`;
  if (err instanceof ConfluenceNetworkError) return `Confluence network error: ${err.message}`;
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
