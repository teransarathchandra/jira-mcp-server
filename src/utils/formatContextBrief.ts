import { IssueContext } from '../jira/issueContextService.js';
import { adfToMarkdown } from './adfToMarkdown.js';
import { summarizeUsefulComments, JiraCommentInput } from './commentAnalyzer.js';
import { extractRequirements } from './requirementExtractor.js';
import { detectConflicts, formatConflicts } from './conflictDetector.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Format ISO date string to YYYY-MM-DD.
 */
function formatDate(iso: string | null | undefined): string {
  if (!iso || iso.length < 10) return 'N/A';
  return iso.slice(0, 10);
}

/**
 * Convert JiraComment array (ADF bodies) into JiraCommentInput array.
 */
function toCommentInputs(
  comments: Array<{ id: string; author: { displayName: string }; body: unknown; created: string; updated: string }>
): JiraCommentInput[] {
  return comments.map((c) => ({
    id: c.id,
    author: c.author?.displayName ?? 'Unknown',
    body: adfToMarkdown(c.body),
    created: c.created,
    updated: c.updated,
  }));
}

/**
 * Extract acceptance criteria from a markdown string.
 * Combines extracted AC lines into a single formatted string.
 */
function extractAcText(markdown: string): string {
  const { acceptanceCriteria } = extractRequirements(markdown);
  if (acceptanceCriteria.length === 0) return '';
  return acceptanceCriteria.join('\n');
}

/**
 * Count total number of unique Jira issues referenced in the context.
 */
function countIssuesSeen(context: IssueContext): number {
  let count = 1; // main issue
  if (context.parentIssue) count++;
  if (context.epicIssue) count++;
  count += context.linkedIssues.length;
  count += context.subtasks.length;
  return count;
}

// ── Main formatter ────────────────────────────────────────────────────────────

/**
 * Format a full IssueContext into a structured Markdown context brief,
 * including an implementation prompt section at the end.
 */
export function formatContextBrief(context: IssueContext): string {
  const { mainIssue, mainIssueDescription } = context;
  const { key, fields } = mainIssue;

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = `# Jira Context Brief: ${key} - ${fields.summary}`;

  // ── Main Task section ───────────────────────────────────────────────────────
  const parentLine = context.parentIssue
    ? `${context.parentIssue.key} - ${context.parentIssue.fields.summary}`
    : (fields.parent ? `${fields.parent.key} - ${fields.parent.fields?.summary ?? ''}` : 'None');

  const epicLine = context.epicIssue
    ? `${context.epicIssue.key} - ${context.epicIssue.fields.summary}`
    : 'None';

  const mainTaskLines = [
    `- **Key:** ${key}`,
    `- **Type:** ${fields.issuetype?.name ?? 'N/A'}`,
    `- **Status:** ${fields.status?.name ?? 'N/A'}`,
    `- **Priority:** ${fields.priority?.name ?? 'N/A'}`,
    `- **Assignee:** ${fields.assignee?.displayName ?? 'Unassigned'}`,
    `- **Reporter:** ${fields.reporter?.displayName ?? 'N/A'}`,
    `- **Parent:** ${parentLine}`,
    `- **Epic:** ${epicLine}`,
    `- **Updated:** ${formatDate(fields.updated)}`,
  ];

  const truncationBlock = context.truncationWarnings.length > 0
    ? '\n' + context.truncationWarnings.map((w) => `⚠️ ${w}`).join('\n')
    : '';

  const mainTaskSection = `## Main Task\n${mainTaskLines.join('\n')}${truncationBlock}`;

  // ── Core Requirement ─────────────────────────────────────────────────────────
  const coreReqContent = mainIssueDescription
    ? mainIssueDescription.slice(0, 600)
    : 'No description provided.';
  const coreRequirementSection = `## Core Requirement\n${coreReqContent}`;

  // ── Acceptance Criteria ──────────────────────────────────────────────────────
  // Try main description first, then combine with epic description if available
  const combinedForAc = [mainIssueDescription, context.epicDescription ?? '']
    .filter(Boolean)
    .join('\n');
  const acText = extractAcText(combinedForAc);
  const acContent = acText || 'No explicit acceptance criteria found.';
  const acSection = `## Acceptance Criteria\n${acContent}`;

  // ── Requirement Clarifications from Comments ─────────────────────────────────
  const rawComments = fields.comment?.comments ?? [];
  const commentInputs = toCommentInputs(rawComments);
  const commentSummary = summarizeUsefulComments(commentInputs);
  const commentsSection = `## Requirement Clarifications from Comments\n${commentSummary}`;

  // ── Parent / Epic Context ────────────────────────────────────────────────────
  const parentEpicLines: string[] = [];

  if (context.parentIssue) {
    const parentDesc = context.parentDescription
      ? context.parentDescription.slice(0, 400)
      : context.parentIssue.fields.summary;
    parentEpicLines.push(`**Parent (${context.parentIssue.key}):** ${parentDesc}`);
  }

  if (context.epicIssue) {
    const epicDesc = context.epicDescription
      ? context.epicDescription.slice(0, 400)
      : context.epicIssue.fields.summary;
    parentEpicLines.push(`**Epic (${context.epicIssue.key}):** ${epicDesc}`);
  }

  const parentEpicContent = parentEpicLines.length > 0
    ? parentEpicLines.join('\n\n')
    : 'No parent or epic context available.';
  const parentEpicSection = `## Parent / Epic Context\n${parentEpicContent}`;

  // ── Related Issues ───────────────────────────────────────────────────────────
  let relatedIssuesContent: string;
  if (context.linkedIssues.length === 0) {
    relatedIssuesContent = 'No linked issues.';
  } else {
    relatedIssuesContent = context.linkedIssues.map((li) => {
      let line = `- **${li.key}** (${li.relationship}): ${li.summary} — Status: ${li.status} | Type: ${li.type}`;
      if (li.descriptionSnippet) {
        const snippet = li.descriptionSnippet.slice(0, 200);
        line += `\n  ${snippet}`;
      }
      return line;
    }).join('\n');
  }
  const relatedIssuesSection = `## Related Issues\n${relatedIssuesContent}`;

  // ── Subtasks ──────────────────────────────────────────────────────────────────
  let subtasksContent: string;
  if (context.subtasks.length === 0) {
    subtasksContent = 'No subtasks.';
  } else {
    subtasksContent = context.subtasks
      .map((st) => `- **${st.key}**: ${st.summary} — ${st.status}`)
      .join('\n');
  }
  const subtasksSection = `## Subtasks\n${subtasksContent}`;

  // ── Possible Dependencies / Blockers ─────────────────────────────────────────
  const BLOCKER_KEYWORDS = ['block', 'depend', 'prerequisite', 'must be done before'];

  const blockerLines: string[] = [];

  // Scan linked issue relationship types
  for (const li of context.linkedIssues) {
    const relLower = li.relationship.toLowerCase();
    if (BLOCKER_KEYWORDS.some((kw) => relLower.includes(kw))) {
      blockerLines.push(`- **${li.key}** (${li.relationship}): ${li.summary}`);
    }
  }

  // Scan comments for blocker signals
  for (const ci of commentInputs) {
    const bodyLower = ci.body.toLowerCase();
    if (
      bodyLower.includes('block') ||
      bodyLower.includes('depend') ||
      bodyLower.includes('prerequisite') ||
      bodyLower.includes('must be done before')
    ) {
      const preview = ci.body.trim().slice(0, 150);
      blockerLines.push(`- **Comment by ${ci.author}** (${formatDate(ci.created)}): ${preview}`);
    }
  }

  const blockersContent = blockerLines.length > 0
    ? blockerLines.join('\n')
    : 'No explicit blockers or dependencies found.';
  const blockersSection = `## Possible Dependencies / Blockers\n${blockersContent}`;

  // ── Technical Signals ─────────────────────────────────────────────────────────
  const combinedForSignals = [mainIssueDescription, context.epicDescription ?? '']
    .filter(Boolean)
    .join('\n');

  const reqSignals = extractRequirements(combinedForSignals);
  const techSignalLines: string[] = [];

  if (reqSignals.technicalSignals.length > 0) {
    techSignalLines.push(`**Files/APIs/Components:** ${reqSignals.technicalSignals.slice(0, 5).join(', ')}`);
  }
  if (reqSignals.businessRules.length > 0) {
    techSignalLines.push(`**Business Rules:**`);
    reqSignals.businessRules.slice(0, 5).forEach((r) => techSignalLines.push(`- ${r}`));
  }
  if (reqSignals.userRoles.length > 0) {
    techSignalLines.push(`**User Roles:** ${reqSignals.userRoles.join(', ')}`);
  }

  const techSignalsContent = techSignalLines.length > 0
    ? techSignalLines.join('\n')
    : 'No specific technical signals found.';
  const techSignalsSection = `## Technical Signals\n${techSignalsContent}`;

  // ── Risk / Ambiguity ──────────────────────────────────────────────────────────
  const riskLines: string[] = [];

  // Ambiguities from main description + epic
  if (reqSignals.ambiguities.length > 0) {
    riskLines.push('**Ambiguities detected:**');
    reqSignals.ambiguities.forEach((a) => riskLines.push(`- ${a}`));
  }

  // Build sources for conflict detection
  type ConflictSource = { label: string; text: string; date?: string };
  const conflictSources: ConflictSource[] = [
    { label: 'main description', text: mainIssueDescription },
  ];
  for (const ci of commentInputs) {
    conflictSources.push({ label: `comment by ${ci.author}`, text: ci.body, date: ci.created });
  }
  if (context.parentDescription) {
    conflictSources.push({ label: 'parent description', text: context.parentDescription });
  }
  if (context.epicDescription) {
    conflictSources.push({ label: 'epic description', text: context.epicDescription });
  }

  const conflictResult = detectConflicts(conflictSources);
  const conflictsText = formatConflicts(conflictResult);
  if (conflictsText) {
    riskLines.push(conflictsText);
  }

  const riskContent = riskLines.length > 0
    ? riskLines.join('\n')
    : 'No ambiguities or conflicts detected.';
  const riskSection = `## Risk / Ambiguity\n${riskContent}`;

  // ── Final Implementation Prompt ───────────────────────────────────────────────
  const totalIssues = countIssuesSeen(context);

  const goalText = mainIssueDescription
    ? mainIssueDescription.slice(0, 300)
    : fields.summary;

  const acForPrompt = acText || 'Derive from description above.';

  const technicalSignalsStr = reqSignals.technicalSignals.slice(0, 5).join(', ') || null;
  const relatedFilesStr = technicalSignalsStr ?? 'the feature described above';

  // Key technical context: business rules + technical signals, first 400 chars
  const keyTechLines = [
    ...reqSignals.businessRules.slice(0, 5),
    ...reqSignals.technicalSignals.slice(0, 5),
  ].join('; ');
  const keyTechContext = keyTechLines.slice(0, 400) || 'See description above.';

  const conflictWarning = conflictsText
    ? `\n${conflictsText}`
    : '';

  const implementationPrompt = `## Final Implementation Prompt for Claude Code

Implement Jira task ${key}: ${fields.summary}

**Context source:** This brief was assembled from ${totalIssues} Jira issues.

**Goal:**
${goalText}

**Acceptance Criteria:**
${acForPrompt}

**Before implementing:**
1. Inspect the repository structure to understand the codebase.
2. Find files related to: ${relatedFilesStr}.
3. Treat the latest useful comments as authoritative if they conflict with the original description.
4. Do not infer missing business rules — ask for clarification if required details are absent.
5. Add or update tests for any changed behavior.
6. After implementation, summarize the changed files.

**Key technical context:**
${keyTechContext}
${conflictWarning}`;

  // ── Assemble ──────────────────────────────────────────────────────────────────
  return [
    header,
    mainTaskSection,
    coreRequirementSection,
    acSection,
    commentsSection,
    parentEpicSection,
    relatedIssuesSection,
    subtasksSection,
    blockersSection,
    techSignalsSection,
    riskSection,
    implementationPrompt,
  ].join('\n\n');
}

/**
 * Extracts just the "## Final Implementation Prompt for Claude Code" section
 * from a context brief produced by formatContextBrief.
 */
export function extractContextImplementationPrompt(brief: string): string {
  const SECTION_HEADING = '## Final Implementation Prompt for Claude Code';
  const sectionStart = brief.indexOf(SECTION_HEADING);
  if (sectionStart === -1) {
    // Fallback: return the entire brief
    return brief.trim();
  }
  return brief.slice(sectionStart).trim();
}
