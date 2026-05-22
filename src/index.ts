#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
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
import { deliveryGetTraceabilityMatrix } from './tools/deliveryGetTraceabilityMatrix.js';
import { deliveryVerifyDefinitionOfDone } from './tools/deliveryVerifyDefinitionOfDone.js';
import { deliveryAnalyzeImplementationImpact } from './tools/deliveryAnalyzeImplementationImpact.js';
import { deliveryGenerateTestStrategy } from './tools/deliveryGenerateTestStrategy.js';
import { deliveryGenerateReviewerReport } from './tools/deliveryGenerateReviewerReport.js';
import { deliveryGenerateQaHandoff } from './tools/deliveryGenerateQaHandoff.js';
import { deliveryGenerateReleaseNotes } from './tools/deliveryGenerateReleaseNotes.js';
import { deliveryGenerateClaudeWorkflowPack } from './tools/deliveryGenerateClaudeWorkflowPack.js';
import {
  deliveryScanProjectPatterns,
  deliveryGetProjectPatterns,
  deliveryClearProjectPatterns,
} from './tools/deliveryScanProjectPatterns.js';
import { deliveryExportTaskReport } from './tools/deliveryExportTaskReport.js';
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

const DeliveryGetTraceabilityMatrixSchema = z.object({
  issueKey: z.string(),
  baseBranch: z.string().optional().default('origin/main'),
  compareRef: z.string().optional().default('HEAD'),
  repoPath: z.string().optional().default('.'),
  includeConfluence: z.boolean().optional().default(true),
  includePrDiff: z.boolean().optional().default(true),
});

const DeliveryVerifyDefinitionOfDoneSchema = z.object({
  issueKey: z.string(),
  baseBranch: z.string().optional().default('origin/main'),
  compareRef: z.string().optional().default('HEAD'),
  repoPath: z.string().optional().default('.'),
  includeConfluence: z.boolean().optional().default(true),
});

const DeliveryAnalyzeImplementationImpactSchema = z.object({
  issueKey: z.string(),
  includeConfluence: z.boolean().optional().default(true),
});

const DeliveryGenerateTestStrategySchema = z.object({
  issueKey: z.string(),
  includeConfluence: z.boolean().optional().default(true),
  includePrDiff: z.boolean().optional().default(false),
  baseBranch: z.string().optional().default('origin/main'),
  compareRef: z.string().optional().default('HEAD'),
  repoPath: z.string().optional().default('.'),
});

const DeliveryGenerateReviewerReportSchema = z.object({
  issueKey: z.string(),
  persona: z.enum(['product_reviewer', 'frontend_reviewer', 'backend_reviewer', 'qa_reviewer', 'security_reviewer', 'release_reviewer']),
  baseBranch: z.string().optional().default('origin/main'),
  compareRef: z.string().optional().default('HEAD'),
  repoPath: z.string().optional().default('.'),
  includeConfluence: z.boolean().optional().default(true),
});

const DeliveryGenerateQaHandoffSchema = z.object({
  issueKey: z.string(),
  baseBranch: z.string().optional().default('origin/main'),
  compareRef: z.string().optional().default('HEAD'),
  repoPath: z.string().optional().default('.'),
  includeConfluence: z.boolean().optional().default(true),
});

const DeliveryGenerateReleaseNotesSchema = z.object({
  issueKey: z.string(),
  audience: z.enum(['internal', 'qa', 'product', 'customer_safe']).optional().default('internal'),
  baseBranch: z.string().optional().default('origin/main'),
  compareRef: z.string().optional().default('HEAD'),
  repoPath: z.string().optional().default('.'),
  includeConfluence: z.boolean().optional().default(true),
});

const DeliveryGenerateClaudeWorkflowPackSchema = z.object({
  repoPath: z.string().optional().default('.'),
  overwrite: z.boolean().optional().default(false),
});

const DeliveryScanProjectPatternsSchema = z.object({
  repoPath: z.string().optional().default('.'),
});

const DeliveryGetProjectPatternsSchema = z.object({
  repoPath: z.string().optional().default('.'),
});

const DeliveryClearProjectPatternsSchema = z.object({
  repoPath: z.string().optional().default('.'),
});

const DeliveryExportTaskReportSchema = z.object({
  issueKey: z.string(),
  baseBranch: z.string().optional().default('origin/main'),
  compareRef: z.string().optional().default('HEAD'),
  repoPath: z.string().optional().default('.'),
  includeConfluence: z.boolean().optional().default(true),
  sections: z.array(z.string()).optional().default(['context', 'impact', 'traceability', 'definition_of_done', 'test_strategy', 'qa_handoff']),
  outputPath: z.string().optional(),
  overwrite: z.boolean().optional().default(false),
});

const McpClearCacheSchema = z.object({
  scope: z.literal('all').optional().default('all'),
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
  {
    name: 'delivery_get_traceability_matrix',
    description: 'Generate a requirement-to-code traceability matrix for a Jira task. Maps each acceptance criterion and business rule to implementation evidence in the PR diff.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref (default: HEAD)' },
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
        includePrDiff: { type: 'boolean', description: 'Include PR diff analysis (default: true)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'delivery_verify_definition_of_done',
    description: 'Verify Definition of Done for a Jira task. Runs 14 checks and returns a merge-readiness verdict with score and required fixes.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref (default: HEAD)' },
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'delivery_analyze_implementation_impact',
    description: 'Analyze the likely implementation impact of a Jira task before coding begins. Predicts affected frontend, backend, API, database, auth, and validation areas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'delivery_generate_test_strategy',
    description: 'Generate a practical test strategy for a Jira task. Produces unit, integration, E2E, manual QA, and negative test scenarios specific to the requirement.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
        includePrDiff: { type: 'boolean', description: 'Include PR diff analysis (default: false)' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref (default: HEAD)' },
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'delivery_generate_reviewer_report',
    description: 'Generate a role-specific review report for a Jira task. Personas: product_reviewer, frontend_reviewer, backend_reviewer, qa_reviewer, security_reviewer, release_reviewer.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        persona: { type: 'string', enum: ['product_reviewer', 'frontend_reviewer', 'backend_reviewer', 'qa_reviewer', 'security_reviewer', 'release_reviewer'], description: 'Reviewer persona' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref (default: HEAD)' },
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
      },
      required: ['issueKey', 'persona'],
    },
  },
  {
    name: 'delivery_generate_qa_handoff',
    description: 'Generate a QA handoff document from a Jira task and current branch. Includes what to test, what not to test, test data, happy path, negative cases, and regression areas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref (default: HEAD)' },
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'delivery_generate_release_notes',
    description: 'Generate release notes for a Jira task. Audience: internal, qa, product, customer_safe.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        audience: { type: 'string', enum: ['internal', 'qa', 'product', 'customer_safe'], description: 'Release notes audience (default: internal)' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref (default: HEAD)' },
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'delivery_generate_claude_workflow_pack',
    description: 'Generate Claude Code workflow assets (.claude/skills/ and .claude/commands/) for Jira delivery workflows. Safe — will not overwrite existing files unless overwrite=true.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
        overwrite: { type: 'boolean', description: 'Overwrite existing files (default: false)' },
      },
      required: [],
    },
  },
  {
    name: 'delivery_scan_project_patterns',
    description: 'Scan the local repository for technical patterns (module names, test locations, tech stack, naming conventions). Optionally persists to local pattern memory if DELIVERY_PATTERN_MEMORY_ENABLED=true.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
      },
      required: [],
    },
  },
  {
    name: 'delivery_get_project_patterns',
    description: 'Get previously saved project patterns from local pattern memory. Returns null if pattern memory is disabled.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
      },
      required: [],
    },
  },
  {
    name: 'delivery_clear_project_patterns',
    description: 'Clear local project pattern memory file.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
      },
      required: [],
    },
  },
  {
    name: 'delivery_export_task_report',
    description: 'Export a complete delivery report for a Jira task combining multiple analysis sections into a single markdown document.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        issueKey: { type: 'string', description: 'Jira issue key (e.g., CMPI-1234)' },
        baseBranch: { type: 'string', description: 'Base branch to diff against (default: origin/main)' },
        compareRef: { type: 'string', description: 'Compare ref (default: HEAD)' },
        repoPath: { type: 'string', description: 'Path to git repository (default: .)' },
        includeConfluence: { type: 'boolean', description: 'Include Confluence context (default: true)' },
        sections: { type: 'array', items: { type: 'string' }, description: 'Sections to include (default: context, impact, traceability, definition_of_done, test_strategy, qa_handoff)' },
        outputPath: { type: 'string', description: 'Path to write the report file (optional)' },
        overwrite: { type: 'boolean', description: 'Overwrite existing file (default: false)' },
      },
      required: ['issueKey'],
    },
  },
  {
    name: 'mcp_clear_cache',
    description: 'Clear all in-memory caches (Jira issues, Jira search, Confluence pages, Confluence search). Use this to force fresh data on the next request.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        scope: { type: 'string', enum: ['all'], description: 'Cache scope to clear (default: all)' },
      },
      required: [],
    },
  },
];

async function main() {
  // Validate env vars at startup — fail fast with clear error
  const config = getConfig();
  const client = new JiraClient(config);

  const server = new Server(
    { name: 'jira-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {}, prompts: {}, resources: {} } },
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

        case 'delivery_get_traceability_matrix': {
          const input = DeliveryGetTraceabilityMatrixSchema.parse(args);
          const result = await deliveryGetTraceabilityMatrix(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_verify_definition_of_done': {
          const input = DeliveryVerifyDefinitionOfDoneSchema.parse(args);
          const result = await deliveryVerifyDefinitionOfDone(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_analyze_implementation_impact': {
          const input = DeliveryAnalyzeImplementationImpactSchema.parse(args);
          const result = await deliveryAnalyzeImplementationImpact(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_generate_test_strategy': {
          const input = DeliveryGenerateTestStrategySchema.parse(args);
          const result = await deliveryGenerateTestStrategy(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_generate_reviewer_report': {
          const input = DeliveryGenerateReviewerReportSchema.parse(args);
          const result = await deliveryGenerateReviewerReport(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_generate_qa_handoff': {
          const input = DeliveryGenerateQaHandoffSchema.parse(args);
          const result = await deliveryGenerateQaHandoff(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_generate_release_notes': {
          const input = DeliveryGenerateReleaseNotesSchema.parse(args);
          const result = await deliveryGenerateReleaseNotes(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_generate_claude_workflow_pack': {
          const input = DeliveryGenerateClaudeWorkflowPackSchema.parse(args);
          const result = await deliveryGenerateClaudeWorkflowPack(input);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_scan_project_patterns': {
          const input = DeliveryScanProjectPatternsSchema.parse(args);
          const result = await deliveryScanProjectPatterns(input);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_get_project_patterns': {
          const input = DeliveryGetProjectPatternsSchema.parse(args);
          const result = await deliveryGetProjectPatterns(input);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_clear_project_patterns': {
          const input = DeliveryClearProjectPatternsSchema.parse(args);
          const result = await deliveryClearProjectPatterns(input);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'delivery_export_task_report': {
          const input = DeliveryExportTaskReportSchema.parse(args);
          const result = await deliveryExportTaskReport(input, client, config);
          return { content: [{ type: 'text', text: result }] };
        }

        case 'mcp_clear_cache': {
          McpClearCacheSchema.parse(args);
          client.issueCache.clear();
          client.minimalCache.clear();
          client.searchCache.clear();
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ cleared: true, message: 'Cache cleared.' }),
            }],
          };
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

  // MCP Prompts — list_prompts handler
  const PROMPTS = [
    {
      name: 'jira_implementation_prompt',
      description: 'Generate an implementation prompt for a Jira task',
      arguments: [{ name: 'issueKey', description: 'Jira issue key', required: true }],
    },
    {
      name: 'jira_pr_review_prompt',
      description: 'Generate a PR review prompt for a Jira task',
      arguments: [{ name: 'issueKey', description: 'Jira issue key', required: true }],
    },
    {
      name: 'jira_qa_handoff_prompt',
      description: 'Generate a QA handoff prompt for a Jira task',
      arguments: [{ name: 'issueKey', description: 'Jira issue key', required: true }],
    },
    {
      name: 'jira_definition_of_done_prompt',
      description: 'Generate a Definition of Done verification prompt',
      arguments: [{ name: 'issueKey', description: 'Jira issue key', required: true }],
    },
    {
      name: 'jira_release_note_prompt',
      description: 'Generate a release note prompt for a Jira task',
      arguments: [{ name: 'issueKey', description: 'Jira issue key', required: true }],
    },
  ];

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: PROMPTS,
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: promptArgs } = request.params;
    const issueKey = (promptArgs as Record<string, string> | undefined)?.issueKey ?? '';

    switch (name) {
      case 'jira_implementation_prompt':
        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: `Use the Jira MCP server to fetch ${issueKey} and prepare a full implementation prompt with Confluence context.` },
          }],
        };
      case 'jira_pr_review_prompt':
        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: `Use the Jira MCP server to review the current branch PR alignment for ${issueKey} and verify Definition of Done.` },
          }],
        };
      case 'jira_qa_handoff_prompt':
        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: `Use the Jira MCP server to generate a QA handoff for ${issueKey} based on the current branch.` },
          }],
        };
      case 'jira_definition_of_done_prompt':
        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: `Use the Jira MCP server to verify Definition of Done for ${issueKey} and return a verdict with score.` },
          }],
        };
      case 'jira_release_note_prompt':
        return {
          messages: [{
            role: 'user' as const,
            content: { type: 'text' as const, text: `Use the Jira MCP server to generate release notes for ${issueKey} with internal audience.` },
          }],
        };
      default:
        throw new Error(`Unknown prompt: ${name}`);
    }
  });

  // MCP Resources — list_resources handler
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      {
        uri: 'jira://{issueKey}/context',
        name: 'Jira Issue Context',
        description: 'Full Jira issue context enriched with Confluence documentation. Replace {issueKey} with the issue key.',
        mimeType: 'text/plain',
      },
      {
        uri: 'jira://{issueKey}/traceability',
        name: 'Jira Traceability Matrix',
        description: 'Requirement-to-code traceability matrix for a Jira task. Use the delivery_get_traceability_matrix tool for full analysis.',
        mimeType: 'text/plain',
      },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const uri = request.params.uri;
    const match = uri.match(/^jira:\/\/([^/]+)\/(\w+)$/);
    if (!match) {
      return { contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource URI: ${uri}` }] };
    }
    const [, issueKey, resourceType] = match;
    if (resourceType === 'context') {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `To fetch full context for ${issueKey}, use the jira_get_issue_with_confluence_context tool with issueKey="${issueKey}".`,
        }],
      };
    }
    if (resourceType === 'traceability') {
      return {
        contents: [{
          uri,
          mimeType: 'text/plain',
          text: `To generate the traceability matrix for ${issueKey}, use the delivery_get_traceability_matrix tool with issueKey="${issueKey}".`,
        }],
      };
    }
    return { contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource type: ${resourceType}` }] };
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
