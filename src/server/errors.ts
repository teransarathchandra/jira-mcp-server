import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import {
  JiraAuthError,
  JiraNotFoundError,
  JiraRateLimitError,
  JiraServerError,
  JiraNetworkError,
  JiraRequestError,
} from '../jiraClient.js';
import {
  ConfluenceAuthError,
  ConfluenceNotFoundError,
  ConfluenceRateLimitError,
  ConfluenceServerError,
  ConfluenceNetworkError,
  ConfluenceNotConfiguredError,
} from '../confluence/confluenceConfig.js';

export function formatError(err: unknown): string {
  if (err instanceof JiraAuthError) return `Authentication error: ${err.message}`;
  if (err instanceof JiraNotFoundError) return `Not found: ${err.message}`;
  if (err instanceof JiraRateLimitError) return `Rate limited: ${err.message}`;
  if (err instanceof JiraServerError) return `Jira server error: ${err.message}`;
  if (err instanceof JiraNetworkError) return `Network error: ${err.message}`;
  if (err instanceof JiraRequestError) return err.message;
  if (err instanceof ConfluenceNotConfiguredError) return `Confluence not configured: ${err.message}`;
  if (err instanceof ConfluenceAuthError) return `Confluence authentication error: ${err.message}`;
  if (err instanceof ConfluenceNotFoundError) return `Confluence not found: ${err.message}`;
  if (err instanceof ConfluenceRateLimitError) return `Confluence rate limited: ${err.message}`;
  if (err instanceof ConfluenceServerError) return `Confluence server error: ${err.message}`;
  if (err instanceof ConfluenceNetworkError) return `Confluence network error: ${err.message}`;
  if (err instanceof z.ZodError) {
    const issues = err.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ');
    return `Invalid input: ${issues}`;
  }
  if (err instanceof Error) return `Error: ${err.message}`;
  return `Unexpected error: ${String(err)}`;
}

export function errorResult(err: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: formatError(err) }],
    isError: true,
  };
}
