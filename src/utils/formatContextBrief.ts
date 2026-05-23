import { IssueContext } from '../jira/issueContextService.js';
import { adfToMarkdown } from './adfToMarkdown.js';

import {
  rankAuthority,
  formatAuthoritySection,
  AuthorityRanking,
} from './authorityRanker.js';

import {
  scoreLinkedIssues,
  formatRelevanceSection,
  RelevanceScoringResult,
} from './relevanceScorer.js';

import {
  evaluateReadiness,
  ReadinessResult,
} from './readinessEvaluator.js';

import {
  generateClarificationQuestions,
  formatClarificationSection,
} from './clarificationQuestionGenerator.js';

import {
  generateRepoInspectionHints,
  formatRepoInspectionSection,
} from './repoInspectionHintGenerator.js';

import {
  scoreContextQuality,
  formatQualitySection,
} from './contextQualityScorer.js';

import {
  detectConflicts,
  formatConflicts,
  ConflictResult,
} from './conflictDetector.js';

import {
  isUsefulComment,
  extractRequirementSignals,
  summarizeUsefulComments,
  JiraCommentInput,
} from './commentAnalyzer.js';

import {
  extractRequirements,
  RequirementSignals,
} from './requirementExtractor.js';

// ── Internal helpers ───────────────────────────────────────────────────────────

function buildTechnicalSignalsSection(
  mainReqs: RequirementSignals,
  epicReqs: RequirementSignals | null,
): string {
  const signals = [...new Set([
    ...mainReqs.technicalSignals.slice(0, 8),
    ...(epicReqs?.technicalSignals.slice(0, 3) ?? []),
  ])];
  const rules = mainReqs.businessRules.slice(0, 3);
  const roles = mainReqs.userRoles;

  if (signals.length === 0 && rules.length === 0 && roles.length === 0) {
    return '## Technical Signals\nNo specific technical signals found.';
  }
  const lines = ['## Technical Signals'];
  if (signals.length > 0) lines.push(`**Files/APIs/Components:** ${signals.join(', ')}`);
  if (rules.length > 0) lines.push(`**Business rules:** ${rules.join(' | ')}`);
  if (roles.length > 0) lines.push(`**User roles:** ${roles.join(', ')}`);
  return lines.join('\n\n');
}

function buildFinalPrompt(
  key: string,
  summary: string,
  mainDesc: string,
  mainReqs: RequirementSignals,
  authorityRanking: AuthorityRanking,
  readiness: ReadinessResult,
  usefulCommentsSummary: string,
  conflictResult: ConflictResult,
  relevanceResult: RelevanceScoringResult,
): string {
  const goal = mainDesc.length > 0 ? mainDesc.slice(0, 400) : summary;
  const acLines = mainReqs.acceptanceCriteria.slice(0, 5);
  const primarySources = authorityRanking.primarySources.map(s => `- ${s.label}`).join('\n');
  const techContext = [
    ...mainReqs.technicalSignals.slice(0, 5),
    ...mainReqs.businessRules.slice(0, 2),
  ].join('; ');

  const contextCount = 1 +
    (relevanceResult.high.length > 0 ? 1 : 0) +
    (relevanceResult.medium.length > 0 ? 1 : 0);

  const conflictWarning = conflictResult.hasConflicts
    ? `\n**⚠️ Conflicts detected:** ${conflictResult.conflicts.length} conflict(s) found. Treat the most recent useful Jira comment as authoritative when sources disagree.\n`
    : '';

  return `## Final Implementation Prompt

**Task:** ${key} — ${summary}
**Readiness:** ${readiness.status}
**Context assembled from:** ${contextCount} Jira source(s).

**Goal:**
${goal}

**Acceptance Criteria:**
${acLines.length > 0 ? acLines.join('\n') : 'Derive from description. Do not invent missing criteria.'}

**Highest-authority sources:**
${primarySources || '- Task description'}

**Important recent comments:**
${usefulCommentsSummary.slice(0, 300)}

**Key technical context:**
${techContext || 'See description above.'}
${conflictWarning}
**Before implementing:**
1. Inspect the repository structure before making changes.
2. Find files/modules related to: ${mainReqs.technicalSignals.slice(0, 3).join(', ') || 'the feature described'}.
3. Do not guess missing business rules — use existing project conventions or ask.
4. Follow existing code patterns and naming conventions in the repository.
5. Prefer a minimal, safe change over a broad refactor.
6. Add or update tests for any changed behavior.
7. If you find unresolved ambiguities not answerable by inspecting the repo, mention them before implementing.
8. Treat the most recent useful Jira comments as higher authority than the original description only when they clearly clarify or change the requirement.
9. After implementation, summarize the changed files and explain your key decisions.
10. Do not implement requirements from low-relevance linked tickets unless directly needed.`;
}

// ── Main formatter ─────────────────────────────────────────────────────────────

/**
 * Format a full IssueContext into a structured Markdown context brief,
 * including an implementation prompt section at the end.
 */
export function formatContextBrief(context: IssueContext): string {
  // ── Step 1: Extract basic fields ──────────────────────────────────────────────
  const { key, fields } = context.mainIssue;
  const mainDesc = context.mainIssueDescription;

  // ── Step 2: Build JiraCommentInput array ──────────────────────────────────────
  const commentInputs: JiraCommentInput[] = fields.comment.comments.map(c => ({
    id: c.id,
    author: c.author.displayName,
    body: adfToMarkdown(c.body),
    created: c.created,
    updated: c.updated,
  }));

  // ── Step 3: Call all intelligence utilities ───────────────────────────────────
  const mainReqs = extractRequirements(mainDesc);
  const epicReqs = context.epicDescription ? extractRequirements(context.epicDescription) : null;

  const conflictSources = [
    { label: 'task description', text: mainDesc, date: fields.created },
    ...commentInputs.filter(c => isUsefulComment(c.body)).map(c => ({
      label: `comment by ${c.author}`,
      text: c.body,
      date: c.created,
    })),
    ...(context.parentDescription ? [{ label: 'parent issue', text: context.parentDescription }] : []),
    ...(context.epicDescription ? [{ label: 'epic', text: context.epicDescription }] : []),
  ];
  const conflictResult = detectConflicts(conflictSources);

  const hasBlockingIssues = context.linkedIssues.some(l =>
    l.relationship.toLowerCase().includes('block'),
  );

  const authorityRanking = rankAuthority({
    mainDescription: mainDesc,
    hasExplicitAC: mainReqs.acceptanceCriteria.length > 0,
    comments: commentInputs.map(c => ({
      author: c.author,
      body: c.body,
      created: c.created,
      isUseful: isUsefulComment(c.body),
      hasRequirementSignals: extractRequirementSignals(c.body).length > 0,
    })),
    parentDescription: context.parentDescription,
    epicDescription: context.epicDescription,
    linkedIssueRelationships: context.linkedIssues.map(l => l.relationship),
    highAuthorityEmails: [],
    highAuthorityAccountIds: [],
  });

  const relevanceResult = scoreLinkedIssues({
    linkedIssues: context.linkedIssues,
    mainSummary: fields.summary,
    mainDescription: mainDesc,
    mainComponents: fields.components.map(c => c.name),
    mainLabels: fields.labels,
    mainTechnicalSignals: mainReqs.technicalSignals,
  });

  const qualityResult = scoreContextQuality({
    mainDescription: mainDesc,
    hasAcceptanceCriteria: mainReqs.acceptanceCriteria.length > 0,
    acceptanceCriteriaCount: mainReqs.acceptanceCriteria.length,
    usefulCommentCount: commentInputs.filter(c => isUsefulComment(c.body)).length,
    technicalSignalCount: mainReqs.technicalSignals.length,
    hasParentContext: context.parentIssue !== null,
    hasEpicContext: context.epicIssue !== null,
    linkedHighRelevanceCount: relevanceResult.high.length,
    conflictCount: conflictResult.conflicts.length,
    ambiguityCount: mainReqs.ambiguities.length,
    hasBlockingIssues,
  });

  const readinessResult = evaluateReadiness({
    mainDescription: mainDesc,
    hasAcceptanceCriteria: mainReqs.acceptanceCriteria.length > 0,
    acceptanceCriteria: mainReqs.acceptanceCriteria,
    technicalSignals: mainReqs.technicalSignals,
    ambiguities: mainReqs.ambiguities,
    conflictCount: conflictResult.conflicts.length,
    hasBlockingIssues,
    blockerDescriptions: context.linkedIssues
      .filter(l => l.relationship.toLowerCase().includes('block'))
      .map(l => `${l.key}: ${l.summary}`),
    usefulCommentCount: commentInputs.filter(c => isUsefulComment(c.body)).length,
    hasRequirementChangingComment: commentInputs.some(c =>
      extractRequirementSignals(c.body).some(s => s.type === 'requirement_change'),
    ),
    latestCommentIntroducesQuestion: false,
    businessRules: mainReqs.businessRules,
    validationRules: mainReqs.validationRules,
  });

  const clarificationResult = generateClarificationQuestions({
    readinessStatus: readinessResult.status,
    ambiguities: mainReqs.ambiguities,
    conflictDescriptions: conflictResult.conflicts.map(c => c.description),
    hasBlockingIssues,
    blockerDescriptions: context.linkedIssues
      .filter(l => l.relationship.toLowerCase().includes('block'))
      .map(l => l.summary),
    mainDescription: mainDesc,
    acceptanceCriteria: mainReqs.acceptanceCriteria,
    technicalSignals: mainReqs.technicalSignals,
    userRoles: mainReqs.userRoles,
    validationRules: mainReqs.validationRules,
    businessRules: mainReqs.businessRules,
    latestCommentIntroducesQuestion: false,
    latestCommentBody: commentInputs.length > 0 ? commentInputs[commentInputs.length - 1].body : '',
  });

  const repoHints = generateRepoInspectionHints({
    technicalSignals: [
      ...mainReqs.technicalSignals,
      ...(epicReqs?.technicalSignals ?? []),
    ],
    components: fields.components.map(c => c.name),
    labels: fields.labels,
    userRoles: mainReqs.userRoles,
    linkedIssueSummaries: [...relevanceResult.high, ...relevanceResult.medium].map(i => i.summary),
    mainDescription: mainDesc,
    summary: fields.summary,
  });

  const usefulCommentsSummary = summarizeUsefulComments(commentInputs);

  // ── Step 4: Assemble the brief ────────────────────────────────────────────────

  // Header
  const header = `# Jira Context Brief: ${key} - ${fields.summary}`;

  // Main Task section
  const epicIssue = context.epicIssue;
  const epicLine = epicIssue
    ? `${epicIssue.key} - ${epicIssue.fields.summary}`
    : 'None';

  const parentLine = fields.parent
    ? `${fields.parent.key} - ${fields.parent.fields?.summary ?? ''}`
    : 'None';

  const mainTaskLines = [
    `- **Key:** ${key}`,
    `- **Type:** ${fields.issuetype.name}`,
    `- **Status:** ${fields.status.name}`,
    `- **Priority:** ${fields.priority?.name ?? 'N/A'}`,
    `- **Assignee:** ${fields.assignee?.displayName ?? 'Unassigned'}`,
    `- **Reporter:** ${fields.reporter?.displayName ?? 'N/A'}`,
    `- **Parent:** ${parentLine}`,
    `- **Epic:** ${epicLine}`,
    `- **Updated:** ${fields.updated.slice(0, 10)}`,
  ];

  const truncationBlock = context.truncationWarnings.length > 0
    ? '\n' + context.truncationWarnings.map(w => `⚠️ ${w}`).join('\n')
    : '';

  const mainTaskSection = `## Main Task\n${mainTaskLines.join('\n')}${truncationBlock}`;

  // Context Quality
  const qualitySection = formatQualitySection(qualityResult);

  // Requirement Authority
  const authoritySection = formatAuthoritySection(authorityRanking);

  // Implementation Readiness
  const readinessSection = [
    '## Implementation Readiness',
    `**Status:** ${readinessResult.status}`,
    '',
    '**Reasons:**',
    readinessResult.reasons.map(r => `- ${r}`).join('\n'),
    '',
    `**Recommended action:** ${readinessResult.recommendedAction}`,
  ].join('\n');

  // Core Requirement
  const coreRequirementSection = `## Core Requirement\n${mainDesc.length > 0 ? mainDesc.slice(0, 600) : 'No description provided.'}`;

  // Acceptance Criteria
  const acContent = mainReqs.acceptanceCriteria.length > 0
    ? mainReqs.acceptanceCriteria.join('\n')
    : 'No explicit acceptance criteria found.';
  const acSection = `## Acceptance Criteria\n${acContent}`;

  // Requirement Clarifications from Comments
  const commentsSection = `## Requirement Clarifications from Comments\n${usefulCommentsSummary}`;

  // Parent / Epic Context
  const parentEpicLines: string[] = [];
  if (context.parentIssue) {
    const parentDesc = context.parentDescription
      ? context.parentDescription.slice(0, 400)
      : context.parentIssue.fields.summary;
    parentEpicLines.push(`**Parent (${context.parentIssue.key}):** ${parentDesc}`);
  }
  if (epicIssue) {
    const epicDesc = context.epicDescription
      ? context.epicDescription.slice(0, 400)
      : epicIssue.fields.summary;
    parentEpicLines.push(`**Epic (${epicIssue.key}):** ${epicDesc}`);
  }
  const parentEpicContent = parentEpicLines.length > 0
    ? parentEpicLines.join('\n\n')
    : 'No parent or epic context available.';
  const parentEpicSection = `## Parent / Epic Context\n${parentEpicContent}`;

  // Relevant Jira Context (relevance-scored linked issues)
  const relevanceSection = formatRelevanceSection(relevanceResult);

  // Subtasks
  const subtasksContent = context.subtasks.length > 0
    ? context.subtasks.map(st => `- **${st.key}**: ${st.summary} — ${st.status}`).join('\n')
    : 'No subtasks.';
  const subtasksSection = `## Subtasks\n${subtasksContent}`;

  // Dependencies / Blockers
  const blockerIssues = context.linkedIssues.filter(l =>
    l.relationship.toLowerCase().includes('block'),
  );
  const blockersContent = blockerIssues.length > 0
    ? blockerIssues.map(l => `- **${l.key}** (${l.relationship}): ${l.summary}`).join('\n')
    : 'No explicit blockers or dependencies found.';
  const blockersSection = `## Dependencies / Blockers\n${blockersContent}`;

  // Technical Signals
  const techSignalsSection = buildTechnicalSignalsSection(mainReqs, epicReqs);

  // Repo Inspection Hints
  const repoSection = formatRepoInspectionSection(repoHints);

  // Conflicts
  const conflictsText = formatConflicts(conflictResult);
  const conflictsContent = conflictResult.hasConflicts
    ? conflictsText
    : 'No conflicts detected.';
  const conflictsSection = `## Conflicts\n${conflictsContent}`;

  // Risk / Ambiguity
  const riskContent = mainReqs.ambiguities.length > 0
    ? mainReqs.ambiguities.map(a => `- ${a}`).join('\n')
    : 'No ambiguities detected.';
  const riskSection = `## Risk / Ambiguity\n${riskContent}`;

  // Clarification section (only rendered when shouldAsk is true)
  const clarificationSection = formatClarificationSection(clarificationResult);

  // Final Implementation Prompt
  const finalPrompt = buildFinalPrompt(
    key,
    fields.summary,
    mainDesc,
    mainReqs,
    authorityRanking,
    readinessResult,
    usefulCommentsSummary,
    conflictResult,
    relevanceResult,
  );

  // ── Assemble ──────────────────────────────────────────────────────────────────
  const sections: string[] = [
    header,
    mainTaskSection,
    qualitySection,
    authoritySection,
    readinessSection,
    coreRequirementSection,
    acSection,
    commentsSection,
    parentEpicSection,
    relevanceSection,
    subtasksSection,
    blockersSection,
    techSignalsSection,
    repoSection,
    conflictsSection,
    riskSection,
  ];

  // Only add clarification section when there are questions to ask
  if (clarificationSection) {
    sections.push(clarificationSection);
  }

  sections.push(finalPrompt);

  return sections.join('\n\n');
}

/**
 * Extracts just the "## Final Implementation Prompt" section
 * from a context brief produced by formatContextBrief.
 */
export function extractContextImplementationPrompt(brief: string): string {
  const sectionStart = brief.indexOf('## Final Implementation Prompt');
  if (sectionStart === -1) return brief;
  return brief.slice(sectionStart).trim();
}
