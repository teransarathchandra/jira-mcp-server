import { Config } from "../config.js";
import {
  JiraClient,
  JiraIssue,
  JiraMinimalIssue,
  JiraIssueLink,
  JiraNotFoundError,
  JiraAuthError,
} from "../jiraClient.js";
import { adfToMarkdown } from "../utils/adfToMarkdown.js";
import { validateIssueKey } from "../utils/issueKey.js";
import { safeJqlProjectKey, safeJqlIssueKey, quoteJqlString } from "../utils/jql.js";
import { logger } from "../logging/logger.js";

// ── Output types ──────────────────────────────────────────────────────────────

export interface LinkedIssueContext {
  key: string;
  relationship: string; // e.g. "blocks", "is blocked by", "relates to"
  summary: string;
  status: string;
  type: string;
  descriptionSnippet: string | null; // first 400 chars of description
}

export interface SubtaskContext {
  key: string;
  summary: string;
  status: string;
}

export interface EpicSiblingContext {
  key: string;
  summary: string;
  status: string;
  type: string;
}

export interface IssueContext {
  mainIssue: JiraIssue;
  mainIssueDescription: string; // ADF converted to Markdown
  parentIssue: JiraMinimalIssue | null;
  parentDescription: string | null;
  epicIssue: JiraMinimalIssue | null;
  epicDescription: string | null;
  linkedIssues: LinkedIssueContext[];
  subtasks: SubtaskContext[];
  epicSiblings: EpicSiblingContext[];
  truncationWarnings: string[]; // any budget warnings
}

// ── Input config type ─────────────────────────────────────────────────────────

export interface ContextFetchOptions {
  includeComments: boolean;
  includeParent: boolean;
  includeEpic: boolean;
  includeLinkedIssues: boolean;
  includeSubtasks: boolean;
  includeEpicSiblings: boolean;
  maxLinkedIssues: number; // max 15
  maxSubtasks: number; // max 20
  maxCommentsPerIssue: number; // max 20
  contextDepth: number; // max 2, but use 1 for related-issue fetching
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Determines the key and relationship label for a link.
 * Returns null if neither inwardIssue nor outwardIssue is present.
 */
function getLinkRelationship(
  link: JiraIssueLink
): { key: string; relationship: string } | null {
  if (link.outwardIssue) {
    return { key: link.outwardIssue.key, relationship: link.type.outward };
  }
  if (link.inwardIssue) {
    return { key: link.inwardIssue.key, relationship: link.type.inward };
  }
  return null;
}

/**
 * Returns the first 400 characters of the ADF-converted description,
 * or null if the issue has no description.
 */
function descriptionSnippet(minimal: JiraMinimalIssue): string | null {
  if (!minimal.fields.description) return null;
  const md = adfToMarkdown(minimal.fields.description);
  if (!md) return null;
  return md.slice(0, 400);
}

// ── Main exported function ────────────────────────────────────────────────────

export async function fetchIssueContext(
  issueKey: string,
  options: ContextFetchOptions,
  client: JiraClient,
  config: Config
): Promise<IssueContext> {
  // 1. Validate issue key
  validateIssueKey(issueKey);

  // 2. Fetch main issue
  const mainIssue = await client.getIssue(issueKey);
  const mainIssueDescription = adfToMarkdown(mainIssue.fields.description);

  // Track visited keys to prevent duplicate fetches
  const visited = new Set<string>([issueKey]);
  const truncationWarnings: string[] = [];

  // 2a. Paginate comments if the API returned fewer than total
  if (options.includeComments) {
    const commentField = mainIssue.fields.comment;
    const cap = Math.min(options.maxCommentsPerIssue, 20);

    // Trim the initial set if Jira returned more inline than our cap allows
    if (commentField.comments.length > cap) {
      mainIssue.fields.comment.comments = commentField.comments.slice(0, cap);
    }

    if (commentField.total > commentField.comments.length && commentField.comments.length < cap) {
      const allComments = [...commentField.comments];
      let startAt = commentField.comments.length;

      while (allComments.length < cap && startAt < commentField.total) {
        const remaining = cap - allComments.length;
        const page = await client.getIssueComments(issueKey, startAt, Math.min(remaining, 50));
        allComments.push(...page.comments.slice(0, cap - allComments.length)); // FIX 1: prevent overshoot
        startAt += page.comments.length;
        if (page.comments.length === 0) break; // safety: stop on empty page
      }

      // Replace in-place so all downstream consumers see the full list
      mainIssue.fields.comment.comments = allComments;
    }

    // FIX 2: emit truncation warning whenever we have fewer comments than total
    // (regardless of whether we paginated or the initial fetch already hit the cap)
    const finalCount = mainIssue.fields.comment.comments.length;
    if (finalCount < mainIssue.fields.comment.total) {
      truncationWarnings.push(
        `Comments truncated: showing ${finalCount} of ${mainIssue.fields.comment.total} comments (maxCommentsPerIssue cap=${cap}).`
      );
    }
  }

  // 3. Fetch parent
  let parentIssue: JiraMinimalIssue | null = null;
  let parentDescription: string | null = null;

  if (options.includeParent && mainIssue.fields.parent?.key) {
    const parentKey = mainIssue.fields.parent.key;
    if (!visited.has(parentKey)) {
      visited.add(parentKey);
      try {
        parentIssue = await client.getIssueMinimal(parentKey);
        parentDescription = parentIssue.fields.description
          ? adfToMarkdown(parentIssue.fields.description)
          : null;
      } catch (err) {
        if (err instanceof JiraNotFoundError) {
          // Skip silently — parent no longer exists
        } else if (err instanceof JiraAuthError) {
          throw err;
        } else {
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`[issueContext] Failed to fetch parent issue ${parentKey}: ${message}`, { parentKey });
          truncationWarnings.push(`Parent issue ${parentKey} could not be fetched: ${message}`);
        }
      }
    }
  }

  // 4. Determine epic key
  let epicKey: string | null = null;

  if (mainIssue.fields.epic?.key) {
    epicKey = mainIssue.fields.epic.key;
  } else if (config.epicFieldId) {
    const customValue = (mainIssue.fields as unknown as Record<string, unknown>)[
      config.epicFieldId
    ];
    if (
      customValue !== null &&
      customValue !== undefined &&
      typeof customValue === "object" &&
      "key" in customValue &&
      typeof (customValue as { key: unknown }).key === "string"
    ) {
      epicKey = (customValue as { key: string }).key;
    }
  }

  // 5. Fetch epic
  let epicIssue: JiraMinimalIssue | null = null;
  let epicDescription: string | null = null;

  if (options.includeEpic && epicKey && !visited.has(epicKey)) {
    visited.add(epicKey);
    try {
      epicIssue = await client.getIssueMinimal(epicKey);
      epicDescription = epicIssue.fields.description
        ? adfToMarkdown(epicIssue.fields.description)
        : null;
    } catch (err) {
      if (err instanceof JiraNotFoundError) {
        // Skip silently
      } else if (err instanceof JiraAuthError) {
        throw err;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[issueContext] Failed to fetch epic issue ${epicKey}: ${message}`, { epicKey });
        truncationWarnings.push(`Epic issue ${epicKey} could not be fetched: ${message}`);
      }
    }
  }

  // 6. Collect linked issues
  const linkedIssues: LinkedIssueContext[] = [];

  if (options.includeLinkedIssues && mainIssue.fields.issuelinks) {
    const allLinks = mainIssue.fields.issuelinks;
    const limit = Math.min(options.maxLinkedIssues, 15);

    // Filter to links that have a resolvable key not already visited
    const eligibleLinks: Array<{ key: string; relationship: string }> = [];
    for (const link of allLinks) {
      const resolved = getLinkRelationship(link);
      if (resolved && !visited.has(resolved.key)) {
        eligibleLinks.push(resolved);
      }
    }

    if (eligibleLinks.length > limit) {
      truncationWarnings.push(
        `Linked issues truncated: showing ${limit} of ${eligibleLinks.length} links.`
      );
    }

    const toFetch = eligibleLinks.slice(0, limit);

    for (const { key, relationship } of toFetch) {
      if (visited.has(key)) continue;
      visited.add(key);

      try {
        const minimal = await client.getIssueMinimal(key);
        linkedIssues.push({
          key,
          relationship,
          summary: minimal.fields.summary,
          status: minimal.fields.status.name,
          type: minimal.fields.issuetype.name,
          descriptionSnippet: descriptionSnippet(minimal),
        });
      } catch (err) {
        if (err instanceof JiraNotFoundError) {
          // Skip silently — linked issue may have been deleted
        } else if (err instanceof JiraAuthError) {
          // Auth errors should propagate — don't swallow them
          throw err;
        } else {
          // Network errors, server errors, etc. — log and continue
          const message = err instanceof Error ? err.message : String(err);
          logger.warn(`[issueContext] Failed to fetch linked issue ${key}: ${message}`, { key });
          truncationWarnings.push(`Linked issue ${key} could not be fetched: ${message}`);
        }
      }
    }
  }

  // 7. Collect subtasks
  const subtasks: SubtaskContext[] = [];

  if (options.includeSubtasks && mainIssue.fields.subtasks) {
    const allSubtasks = mainIssue.fields.subtasks;
    const limit = Math.min(options.maxSubtasks, 20);

    if (allSubtasks.length > limit) {
      truncationWarnings.push(
        `Subtasks truncated: showing ${limit} of ${allSubtasks.length} subtasks.`
      );
    }

    for (const subtask of allSubtasks.slice(0, limit)) {
      subtasks.push({
        key: subtask.key,
        summary: subtask.fields.summary,
        status: subtask.fields.status.name,
      });
    }
  }

  // 8. Fetch epic siblings
  const epicSiblings: EpicSiblingContext[] = [];

  if (options.includeEpicSiblings && epicKey) {
    const SIBLING_LIMIT = 10;
    const projectKey = config.projectConfig.defaultProjectKey ?? issueKey.split('-')[0];
    const jql = `project = "${safeJqlProjectKey(projectKey)}" AND "Epic Link" = ${quoteJqlString(safeJqlIssueKey(epicKey))} AND key != "${safeJqlIssueKey(issueKey)}" ORDER BY updated DESC`;

    try {
      const result = await client.searchIssues(
        jql,
        ["summary", "status", "issuetype"],
        SIBLING_LIMIT + 1 // fetch one extra to detect truncation
      );

      const issues = result.issues;

      if (issues.length > SIBLING_LIMIT) {
        truncationWarnings.push(
          `Epic siblings truncated: showing ${SIBLING_LIMIT} of ${result.total} siblings in epic ${epicKey}.`
        );
      }

      for (const issue of issues.slice(0, SIBLING_LIMIT)) {
        epicSiblings.push({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status.name,
          type: (issue.fields as unknown as { issuetype: { name: string } })
            .issuetype.name,
        });
      }
    } catch (err) {
      if (err instanceof JiraNotFoundError) {
        // No siblings found — skip silently
      } else if (err instanceof JiraAuthError) {
        throw err;
      } else {
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[issueContext] Failed to fetch epic siblings for ${epicKey}: ${message}`, { epicKey });
        truncationWarnings.push(`Epic siblings for ${epicKey} could not be fetched: ${message}`);
      }
    }
  }

  // 9. Return the complete context bundle
  return {
    mainIssue,
    mainIssueDescription,
    parentIssue,
    parentDescription,
    epicIssue,
    epicDescription,
    linkedIssues,
    subtasks,
    epicSiblings,
    truncationWarnings,
  };
}
