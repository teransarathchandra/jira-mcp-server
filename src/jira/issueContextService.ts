import { Config } from "../config.js";
import {
  JiraClient,
  JiraIssue,
  JiraMinimalIssue,
  JiraIssueLink,
  JiraNotFoundError,
  JiraAuthError,
  JiraForbiddenError,
} from "../jiraClient.js";
import { adfToMarkdown } from "../utils/adfToMarkdown.js";
import { validateIssueKey } from "../utils/issueKey.js";
import { safeJqlProjectKey, safeJqlIssueKey, quoteJqlString } from "../utils/jql.js";
import { logger } from "../logging/logger.js";
import { isInboundBlocker } from "./linkUtils.js";

// ── Output types ──────────────────────────────────────────────────────────────

export interface LinkedIssueContext {
  key: string;
  relationship: string; // e.g. "blocks", "is blocked by", "relates to"
  direction: 'inward' | 'outward'; // inward: the linked issue acts on this one ("is blocked by")
  linkTypeName: string; // e.g. "Blocks", "Relates"
  summary: string;
  status: string;
  statusCategory: StatusCategory;
  type: string;
  access: 'observed' | 'denied'; // denied: could not read the issue itself; link data only
  descriptionSnippet: string | null; // first 400 chars of description
}

export type StatusCategory = 'new' | 'indeterminate' | 'done' | 'unknown';

/**
 * How a context source was fetched. Only `observed` and `observed_empty`
 * can support a negative statement such as "there are no blockers".
 */
export type EvidenceState =
  | 'observed'
  | 'observed_empty'
  | 'not_requested'
  | 'not_configured'
  | 'denied_or_missing'
  | 'truncated'
  | 'fetch_error';

export type ContextEvidence = Record<
  'comments' | 'linkedIssues' | 'subtasks' | 'parent' | 'epic' | 'acceptanceCriteriaField',
  EvidenceState
>;

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
  evidence: ContextEvidence;
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
function getLinkRelationship(link: JiraIssueLink): Omit<LinkedIssueContext, 'access' | 'descriptionSnippet'> | null {
  const side = link.outwardIssue
    ? { issue: link.outwardIssue, direction: 'outward' as const, relationship: link.type.outward }
    : link.inwardIssue
      ? { issue: link.inwardIssue, direction: 'inward' as const, relationship: link.type.inward }
      : null;
  if (!side) return null;
  return {
    key: side.issue.key,
    relationship: side.relationship,
    direction: side.direction,
    linkTypeName: link.type.name,
    summary: side.issue.fields.summary,
    status: side.issue.fields.status.name,
    statusCategory: toStatusCategory(side.issue.fields.status.statusCategory?.key),
    type: side.issue.fields.issuetype.name,
  };
}

export function toStatusCategory(key: string | undefined): StatusCategory {
  return key === 'new' || key === 'indeterminate' || key === 'done' ? key : 'unknown';
}

/** Permission-limited reads: Jira answers 403, or 404 for issues the account cannot browse. */
function isAccessDenied(err: unknown): boolean {
  return err instanceof JiraForbiddenError || err instanceof JiraNotFoundError;
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

  // 2a. Comments: keep the newest `cap` comments (Jira pages oldest-first),
  // then analyse them in chronological order.
  let commentsEvidence: EvidenceState = 'not_requested';
  if (options.includeComments) {
    const commentField = mainIssue.fields.comment;
    const cap = Math.min(options.maxCommentsPerIssue, 20);
    commentsEvidence = commentField.total === 0 ? 'observed_empty' : 'observed';

    if (commentField.total > commentField.comments.length || commentField.comments.length > cap) {
      try {
        const page = await client.getIssueComments(issueKey, 0, cap, '-created');
        const newest = page.comments.length > 0 ? page.comments.slice(0, cap) : commentField.comments.slice(-cap);
        mainIssue.fields.comment.comments = [...newest].sort((a, b) => a.created.localeCompare(b.created));
      } catch (err) {
        if (err instanceof JiraAuthError && !(err instanceof JiraForbiddenError)) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(`[issueContext] Failed to fetch newest comments for ${issueKey}: ${message}`, { issueKey });
        truncationWarnings.push(`Newest comments could not be fetched: ${message}`);
        mainIssue.fields.comment.comments = commentField.comments.slice(-cap);
        commentsEvidence = 'fetch_error';
      }
    }

    const finalCount = mainIssue.fields.comment.comments.length;
    if (finalCount < mainIssue.fields.comment.total) {
      if (commentsEvidence === 'observed') commentsEvidence = 'truncated';
      truncationWarnings.push(
        `Comments truncated: showing the newest ${finalCount} of ${mainIssue.fields.comment.total} comments (maxCommentsPerIssue cap=${cap}).`
      );
    }
  }

  // 3. Fetch parent
  let parentIssue: JiraMinimalIssue | null = null;
  let parentDescription: string | null = null;
  let parentEvidence: EvidenceState = options.includeParent ? 'observed_empty' : 'not_requested';

  if (options.includeParent && mainIssue.fields.parent?.key) {
    const parentKey = mainIssue.fields.parent.key;
    if (!visited.has(parentKey)) {
      visited.add(parentKey);
      try {
        parentIssue = await client.getIssueMinimal(parentKey);
        parentDescription = parentIssue.fields.description
          ? adfToMarkdown(parentIssue.fields.description)
          : null;
        parentEvidence = 'observed';
      } catch (err) {
        parentEvidence = relatedFetchFailed(err, `Parent issue ${parentKey}`, truncationWarnings);
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
  let epicEvidence: EvidenceState = options.includeEpic ? 'observed_empty' : 'not_requested';

  if (options.includeEpic && epicKey && !visited.has(epicKey)) {
    visited.add(epicKey);
    try {
      epicIssue = await client.getIssueMinimal(epicKey);
      epicDescription = epicIssue.fields.description
        ? adfToMarkdown(epicIssue.fields.description)
        : null;
      epicEvidence = 'observed';
    } catch (err) {
      epicEvidence = relatedFetchFailed(err, `Epic issue ${epicKey}`, truncationWarnings);
    }
  }

  // 6. Collect linked issues. Summary, status and type come from the link
  // entry on the main issue, so a linked issue the account cannot read is
  // still listed (access: 'denied') instead of disappearing.
  const linkedIssues: LinkedIssueContext[] = [];
  let linksEvidence: EvidenceState = options.includeLinkedIssues ? 'observed_empty' : 'not_requested';

  if (options.includeLinkedIssues && mainIssue.fields.issuelinks && mainIssue.fields.issuelinks.length > 0) {
    const limit = Math.min(options.maxLinkedIssues, 15);
    const eligibleLinks = mainIssue.fields.issuelinks
      .map(getLinkRelationship)
      .filter((l): l is NonNullable<typeof l> => l !== null && !visited.has(l.key));
    // Inbound blockers go first so the limit below can never hide one.
    eligibleLinks.sort((x, y) => Number(isInboundBlocker(y)) - Number(isInboundBlocker(x)));

    const outcomes = new Set<EvidenceState>();
    if (eligibleLinks.length > limit) {
      outcomes.add('truncated');
      truncationWarnings.push(
        `Linked issues truncated: showing ${limit} of ${eligibleLinks.length} links.`
      );
    }

    for (const link of eligibleLinks.slice(0, limit)) {
      if (visited.has(link.key)) continue;
      visited.add(link.key);
      try {
        const minimal = await client.getIssueMinimal(link.key);
        linkedIssues.push({ ...link, access: 'observed', descriptionSnippet: descriptionSnippet(minimal) });
      } catch (err) {
        outcomes.add(relatedFetchFailed(err, `Linked issue ${link.key}`, truncationWarnings));
        linkedIssues.push({ ...link, access: 'denied', descriptionSnippet: null });
      }
    }

    linksEvidence = outcomes.has('denied_or_missing')
      ? 'denied_or_missing'
      : outcomes.has('fetch_error')
        ? 'fetch_error'
        : outcomes.has('truncated')
          ? 'truncated'
          : linkedIssues.length > 0 ? 'observed' : 'observed_empty';
  }

  // 7. Collect subtasks
  const subtasks: SubtaskContext[] = [];
  let subtasksEvidence: EvidenceState = options.includeSubtasks ? 'observed_empty' : 'not_requested';

  if (options.includeSubtasks && mainIssue.fields.subtasks && mainIssue.fields.subtasks.length > 0) {
    const allSubtasks = mainIssue.fields.subtasks;
    const limit = Math.min(options.maxSubtasks, 20);
    subtasksEvidence = 'observed';

    if (allSubtasks.length > limit) {
      subtasksEvidence = 'truncated';
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
          `Epic siblings truncated: showing ${SIBLING_LIMIT} of more than ${SIBLING_LIMIT} siblings in epic ${epicKey}.`
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
    evidence: {
      comments: commentsEvidence,
      linkedIssues: linksEvidence,
      subtasks: subtasksEvidence,
      parent: parentEvidence,
      epic: epicEvidence,
      acceptanceCriteriaField: acceptanceCriteriaFieldEvidence(mainIssue, config),
    },
  };
}

/**
 * Records a failed fetch of a parent, epic or linked issue. Bad credentials
 * (401) still fail the whole request; permission limits and other errors
 * become evidence so the brief can say what it could not see.
 */
function relatedFetchFailed(err: unknown, subject: string, warnings: string[]): EvidenceState {
  if (err instanceof JiraAuthError && !(err instanceof JiraForbiddenError)) throw err;
  const message = err instanceof Error ? err.message : String(err);
  if (isAccessDenied(err)) {
    warnings.push(`${subject} is not visible to this account.`);
    return 'denied_or_missing';
  }
  logger.warn(`[issueContext] Failed to fetch ${subject}: ${message}`, { subject });
  warnings.push(`${subject} could not be fetched: ${message}`);
  return 'fetch_error';
}

function acceptanceCriteriaFieldEvidence(issue: JiraIssue, config: Config): EvidenceState {
  if (!config.acceptanceCriteriaFieldId) return 'not_configured';
  const value = (issue.fields as unknown as Record<string, unknown>)[config.acceptanceCriteriaFieldId];
  if (value === null || value === undefined) return 'observed_empty';
  if (typeof value === 'string') return value.trim() ? 'observed' : 'observed_empty';
  return adfToMarkdown(value).trim() ? 'observed' : 'observed_empty';
}
