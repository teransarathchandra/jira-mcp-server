import { JiraIssue } from "../jiraClient.js";
import { adfToMarkdown } from "./adfToMarkdown.js";

// ── Constants ──────────────────────────────────────────────────────────────────

const RECENT_COMMENTS_LIMIT = 5;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface JiraSearchIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority: { name: string } | null;
    updated: string;
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Slice the first 10 characters of an ISO date string to get YYYY-MM-DD.
 * Returns "N/A" if the value is null/undefined/empty or too short.
 */
function formatDate(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return "N/A";
  return iso.slice(0, 10);
}

/**
 * Extract acceptance criteria from a Markdown string.
 * Looks for a heading or inline marker followed by bullet/numbered content.
 */
function extractAcceptanceCriteria(markdown: string): string {
  if (!markdown) return "No explicit acceptance criteria found.";

  // Patterns that introduce an AC section (case-insensitive)
  const headingPatterns = [
    /^#{1,6}\s*acceptance criteria\s*$/im,
    /^#{1,6}\s*definition of done\s*$/im,
    /^\*\*acceptance criteria\*\*\s*:?\s*$/im,
    /^acceptance criteria\s*:\s*$/im,
    /^ac\s*:\s*$/im,
  ];

  const lines = markdown.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Check if this line matches an AC heading
    const isAcHeading = headingPatterns.some((p) => p.test(line));

    // Also handle inline "AC:" or "Acceptance Criteria:" at the start of a line
    const inlineAc = /^(?:acceptance criteria|ac)\s*:/i.test(line);

    if (isAcHeading) {
      // Collect lines until the next heading or end
      const extracted: string[] = [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        // Stop at the next Markdown heading
        if (/^#{1,6}\s/.test(nextLine) || /^\*\*[^*]+\*\*\s*:?\s*$/.test(nextLine)) {
          break;
        }
        extracted.push(nextLine);
      }
      const content = extracted.join("\n").trim();
      return content || "No explicit acceptance criteria found.";
    }

    if (inlineAc) {
      // Everything after "AC:" on this line plus subsequent bullets
      const afterColon = line.replace(/^(?:acceptance criteria|ac)\s*:\s*/i, "").trim();
      const extracted: string[] = afterColon ? [afterColon] : [];
      for (let j = i + 1; j < lines.length; j++) {
        const nextLine = lines[j];
        if (/^#{1,6}\s/.test(nextLine) || /^\*\*[^*]+\*\*\s*:?\s*$/.test(nextLine)) {
          break;
        }
        extracted.push(nextLine);
      }
      const content = extracted.join("\n").trim();
      return content || "No explicit acceptance criteria found.";
    }
  }

  return "No explicit acceptance criteria found.";
}

/**
 * Extract technical notes from a Markdown string.
 * Returns bullet-list lines for each unique hint found, or a fallback message.
 */
function extractTechnicalNotes(markdown: string): string {
  if (!markdown) return "No specific technical notes found in the ticket.";

  const hints: string[] = [];
  const seen = new Set<string>();

  const addHint = (hint: string) => {
    const key = hint.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      hints.push(hint);
    }
  };

  // File mentions (.ts, .tsx, .js, .jsx, .cs, .py, .go, .rs, .java, .rb, etc.)
  const fileMatches = markdown.matchAll(/\b[\w./\-]+\.(?:tsx?|jsx?|cs|py|go|rs|java|rb|php|sh|json|yaml|yml|env|sql|md)\b/g);
  for (const m of fileMatches) {
    addHint(`File: \`${m[0]}\``);
  }

  // API endpoint mentions
  const apiMatches = markdown.matchAll(/\/api\/[\w/\-{}.:?=&%]+/g);
  for (const m of apiMatches) {
    addHint(`API endpoint: \`${m[0]}\``);
  }

  // REST/endpoint keyword mentions (sentence-level)
  if (/\bREST\b/.test(markdown)) addHint("REST API mentioned");
  if (/\bendpoint\b/i.test(markdown)) addHint("Endpoint(s) mentioned");

  // URLs
  const urlMatches = markdown.matchAll(/https?:\/\/[^\s)>\]"']+/g);
  for (const m of urlMatches) {
    addHint(`URL: ${m[0]}`);
  }

  // PascalCase component/module names (2+ words joined, not all-caps acronyms)
  const pascalMatches = markdown.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g);
  for (const m of pascalMatches) {
    addHint(`Component/Module: \`${m[1]}\``);
  }

  // User roles
  const roles = ["admin", "administrator", "user", "manager", "moderator", "editor", "viewer", "owner", "guest"];
  for (const role of roles) {
    if (new RegExp(`\\b${role}\\b`, "i").test(markdown)) {
      addHint(`User role mentioned: ${role}`);
    }
  }

  // Environment names
  const envs = ["staging", "production", "prod", "development", "dev", "qa", "sandbox", "testing"];
  for (const env of envs) {
    if (new RegExp(`\\b${env}\\b`, "i").test(markdown)) {
      addHint(`Environment mentioned: ${env}`);
    }
  }

  if (hints.length === 0) {
    return "No specific technical notes found in the ticket.";
  }

  return hints.map((h) => `- ${h}`).join("\n");
}

/**
 * Determine whether a comment body (plain text) is a status-transition noise comment.
 */
function isStatusTransitionComment(text: string): boolean {
  if (text.length < 30) {
    const lower = text.toLowerCase();
    if (
      lower.includes("status changed") ||
      lower.includes("moved to") ||
      lower.includes("transitioned")
    ) {
      return true;
    }
  }
  return false;
}

// ── Main formatter ────────────────────────────────────────────────────────────

/**
 * Convert a JiraIssue into a clean, developer-friendly Markdown brief.
 */
export function formatIssueBrief(issue: JiraIssue): string {
  const { key, fields } = issue;

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = `# Jira Task: ${key} - ${fields.summary}`;

  // ── Status section ──────────────────────────────────────────────────────────
  const statusLines: string[] = [
    `- **Type:** ${fields.issuetype?.name ?? "N/A"}`,
    `- **Status:** ${fields.status?.name ?? "N/A"}`,
    `- **Priority:** ${fields.priority?.name ?? "N/A"}`,
    `- **Assignee:** ${fields.assignee?.displayName ?? "N/A"}`,
    `- **Reporter:** ${fields.reporter?.displayName ?? "N/A"}`,
  ];

  if (fields.labels && fields.labels.length > 0) {
    statusLines.push(`- **Labels:** ${fields.labels.join(", ")}`);
  }
  if (fields.components && fields.components.length > 0) {
    statusLines.push(`- **Components:** ${fields.components.map((c) => c.name).join(", ")}`);
  }
  if (fields.fixVersions && fields.fixVersions.length > 0) {
    statusLines.push(`- **Fix Versions:** ${fields.fixVersions.map((v) => v.name).join(", ")}`);
  }

  statusLines.push(`- **Created:** ${formatDate(fields.created)}`);
  statusLines.push(`- **Updated:** ${formatDate(fields.updated)}`);

  const statusSection = `## Status\n${statusLines.join("\n")}`;

  // ── Description ─────────────────────────────────────────────────────────────
  const descMarkdown = adfToMarkdown(fields.description);
  const descriptionContent = descMarkdown.trim() ? descMarkdown.trim() : "No description provided.";
  const descriptionSection = `## Description\n${descriptionContent}`;

  // ── Acceptance Criteria ─────────────────────────────────────────────────────
  const acContent = extractAcceptanceCriteria(descMarkdown);
  const acSection = `## Acceptance Criteria\n${acContent}`;

  // ── Technical Notes ─────────────────────────────────────────────────────────
  const techContent = extractTechnicalNotes(descMarkdown);
  const techSection = `## Technical Notes\n${techContent}`;

  // ── Comments ─────────────────────────────────────────────────────────────────
  const allComments = fields.comment?.comments ?? [];
  // Take the most recent comments
  const recentComments = allComments.slice(-RECENT_COMMENTS_LIMIT);

  const usefulComments = recentComments.filter((c) => {
    const bodyText = adfToMarkdown(c.body).trim();
    return !isStatusTransitionComment(bodyText);
  });

  let commentsContent: string;
  if (usefulComments.length === 0) {
    commentsContent = "No comments.";
  } else {
    commentsContent = usefulComments
      .map((c) => {
        const author = c.author?.displayName ?? "Unknown";
        const date = formatDate(c.created);
        const body = adfToMarkdown(c.body).trim();
        return `**${author}** (${date}):\n${body}`;
      })
      .join("\n\n");
  }
  const commentsSection = `## Comments\n${commentsContent}`;

  // ── Attachments ──────────────────────────────────────────────────────────────
  const attachments = fields.attachment ?? [];
  let attachmentsContent: string;
  if (attachments.length === 0) {
    attachmentsContent = "No attachments.";
  } else {
    attachmentsContent = attachments
      .map((a) => {
        const safeFilename = a.filename.replace(/([[\]])/g, '\\$1');
        return `- [${safeFilename}](${a.content})`;
      })
      .join("\n");
  }
  const attachmentsSection = `## Attachments\n${attachmentsContent}`;

  // ── Subtasks / Linked Context ─────────────────────────────────────────────
  const subtasks = fields.subtasks ?? [];
  const parent = fields.parent;
  const linkedLines: string[] = [];

  if (parent) {
    linkedLines.push(`**Parent:** ${parent.key} - ${parent.fields?.summary ?? "N/A"}`);
  }
  for (const st of subtasks) {
    linkedLines.push(`- ${st.key}: ${st.fields.summary} (${st.fields.status?.name ?? "N/A"})`);
  }

  const linkedContent = linkedLines.length > 0
    ? linkedLines.join("\n")
    : "No subtasks or parent issue.";
  const linkedSection = `## Subtasks / Linked Context\n${linkedContent}`;

  // ── Implementation Prompt ───────────────────────────────────────────────────
  const goal = `${fields.summary}. ${descriptionContent.split("\n")[0]}`.trim();
  const acForPrompt = acContent === "No explicit acceptance criteria found."
    ? "Acceptance criteria should be derived from the description above."
    : acContent;
  const techForPrompt = techContent === "No specific technical notes found in the ticket."
    ? "See description above."
    : techContent;

  // Extract file/module references for "Find files related to" line
  const fileRefs = (descMarkdown.match(/\b[\w./\-]+\.(?:tsx?|jsx?|cs|py|go|rs|java|rb|php|sh|json|yaml|yml|env|sql|md)\b/g) ?? []);
  const pascalRefs = (descMarkdown.match(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g) ?? []);
  const allRefs = [...new Set([...fileRefs, ...pascalRefs])];
  const relatedFiles = allRefs.length > 0
    ? allRefs.slice(0, 5).join(", ")
    : "the feature described above";

  const implementationPrompt = `## Implementation Prompt for Claude Code

**Goal:** ${goal}

**Acceptance Criteria:**
${acForPrompt}

**Before implementing:**
1. Inspect the repository structure to understand the codebase.
2. Find files related to: ${relatedFiles}.
3. Do not guess business rules that are missing from this ticket.
4. Ask for clarification only if required details are missing from this Jira ticket.

**Key technical context:** ${techForPrompt}`;

  // ── Assemble ─────────────────────────────────────────────────────────────────
  return [
    header,
    statusSection,
    descriptionSection,
    acSection,
    techSection,
    commentsSection,
    attachmentsSection,
    linkedSection,
    implementationPrompt,
  ].join("\n\n");
}

// ── Search results formatter ──────────────────────────────────────────────────

/**
 * Format a list of Jira search result issues as a Markdown table.
 */
export function formatSearchResult(issues: JiraSearchIssue[], projectKey: string = 'CMPI'): string {
  const header = `## My Open ${projectKey} Issues`;
  const tableHeader = "| Key | Summary | Status | Priority | Updated |";
  const separator = "|-----|---------|--------|----------|---------|";

  if (issues.length === 0) {
    return `${header}\n\nNo issues found.`;
  }

  const rows = issues.map((issue) => {
    const key = issue.key;
    const summary = issue.fields.summary;
    const status = issue.fields.status?.name ?? "N/A";
    const priority = issue.fields.priority?.name ?? "N/A";
    const updated = formatDate(issue.fields.updated);
    return `| ${key} | ${summary} | ${status} | ${priority} | ${updated} |`;
  });

  return [header, tableHeader, separator, ...rows].join("\n");
}
