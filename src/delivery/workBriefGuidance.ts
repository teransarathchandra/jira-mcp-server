// Work-brief guidance engine (R2 design §4). Pure: turns an IssueContext into
// readiness, recommended actions, clarifying questions and a branch name.
//
// Jira text is untrusted. It may decide WHICH template applies, but it is
// never copied into action or question text; only keys, counts, status names
// and the slugged branch name are interpolated.

import type { Config } from '../config.js';
import type { EvidenceState, IssueContext, LinkedIssueContext } from '../jira/issueContextService.js';
import { toStatusCategory } from '../jira/issueContextService.js';
import { isInboundBlocker } from '../jira/linkUtils.js';
import { adfToMarkdown } from '../utils/adfToMarkdown.js';
import { extractRequirements } from '../utils/requirementExtractor.js';
import { detectConflicts } from '../utils/conflictDetector.js';
import { evaluateReadiness } from '../utils/readinessEvaluator.js';
import { isUsefulComment, extractRequirementSignals } from '../utils/commentAnalyzer.js';
import { DEFAULT_BRANCH_PATTERN, suggestBranchName } from './branchName.js';
import type { WorkBriefData } from './workBriefTypes.js';

type Action = WorkBriefData['recommendedActions'][number];
type Question = WorkBriefData['clarifyingQuestions'][number];
type Gap = WorkBriefData['readiness']['gaps'][number];
type Confidence = WorkBriefData['readiness']['confidence'];

const MAX_ACTIONS = 4;
const MAX_QUESTIONS = 3;
const WEAK_EVIDENCE: ReadonlySet<EvidenceState> = new Set(['denied_or_missing', 'truncated', 'fetch_error']);
const CONFIDENCE_STEPS: Confidence[] = ['high', 'medium', 'low'];

const LIST_MARKER = /^\s*(?:[-*•]|\d+[.)])\s+/;

function cleanCriterion(text: string): string {
  return text.replace(LIST_MARKER, '').trim();
}

function acceptanceCriteriaFieldText(context: IssueContext, config: Config): string {
  if (!config.acceptanceCriteriaFieldId) return '';
  const value = (context.mainIssue.fields as unknown as Record<string, unknown>)[config.acceptanceCriteriaFieldId];
  if (value === null || value === undefined) return '';
  return typeof value === 'string' ? value : adfToMarkdown(value);
}

function readAcceptanceCriteria(
  context: IssueContext,
  config: Config,
  descriptionCriteria: string[],
): WorkBriefData['acceptanceCriteria'] {
  if (context.evidence.acceptanceCriteriaField === 'observed') {
    const fieldText = acceptanceCriteriaFieldText(context, config);
    const extracted = extractRequirements(fieldText).acceptanceCriteria;
    const lines = extracted.length > 0 ? extracted : fieldText.split('\n');
    const criteria = lines.map(cleanCriterion).filter(Boolean);
    if (criteria.length > 0) return criteria.map((text) => ({ text, source: 'field' as const }));
  }
  return descriptionCriteria.map(cleanCriterion).filter(Boolean).map((text) => ({ text, source: 'description' as const }));
}

function lowerConfidence(confidence: Confidence): Confidence {
  return CONFIDENCE_STEPS[Math.min(CONFIDENCE_STEPS.indexOf(confidence) + 1, CONFIDENCE_STEPS.length - 1)];
}

const EVIDENCE_LABEL: Record<keyof IssueContext['evidence'], string> = {
  comments: 'Comments',
  linkedIssues: 'Linked issues',
  subtasks: 'Subtasks',
  parent: 'The parent issue',
  epic: 'The epic',
  acceptanceCriteriaField: 'The acceptance-criteria field',
};

export function buildWorkBriefData(context: IssueContext, config: Config): WorkBriefData {
  const fields = context.mainIssue.fields;
  const key = context.mainIssue.key;
  const description = context.mainIssueDescription ?? '';
  const descriptionRef = `issue:${key}:description`;

  // ── Signals from Jira ───────────────────────────────────────────────────────
  const comments = fields.comment.comments.map((c) => ({
    id: c.id,
    author: c.author.displayName,
    body: adfToMarkdown(c.body),
    created: c.created,
  }));
  const usefulComments = comments.filter((c) => isUsefulComment(c.body));
  const requirements = extractRequirements(description);
  const acceptanceCriteria = readAcceptanceCriteria(context, config, requirements.acceptanceCriteria);
  const acceptanceRef = acceptanceCriteria[0]?.source === 'field' ? `issue:${key}:acField` : descriptionRef;

  const conflicts = detectConflicts([
    { label: 'task description', text: description, date: fields.created },
    ...usefulComments.map((c) => ({ label: `comment ${c.id}`, text: c.body, date: c.created })),
    ...(context.parentDescription ? [{ label: 'parent issue', text: context.parentDescription }] : []),
    ...(context.epicDescription ? [{ label: 'epic', text: context.epicDescription }] : []),
  ]).conflicts;
  const materialConflicts = conflicts
    .map((conflict, index) => ({ conflict, index }))
    .filter(({ conflict }) => conflict.severity === 'high' || conflict.severity === 'medium');

  const inbound = context.linkedIssues.filter(isInboundBlocker);
  const openBlockers = inbound.filter((l) => l.statusCategory !== 'done' && l.statusCategory !== 'unknown');
  const unknownBlockers = inbound.filter((l) => l.statusCategory === 'unknown');
  const ambiguities = requirements.ambiguities;

  // ── Readiness ───────────────────────────────────────────────────────────────
  const evaluated = evaluateReadiness({
    mainDescription: description,
    hasAcceptanceCriteria: acceptanceCriteria.length > 0,
    acceptanceCriteria: acceptanceCriteria.map((c) => c.text),
    technicalSignals: requirements.technicalSignals,
    ambiguities,
    conflictCount: conflicts.length,
    hasBlockingIssues: openBlockers.length > 0,
    blockerDescriptions: openBlockers.map((l) => l.key),
    usefulCommentCount: usefulComments.length,
    hasRequirementChangingComment: comments.some((c) =>
      extractRequirementSignals(c.body).some((s) => s.type === 'requirement_change'),
    ),
    latestCommentIntroducesQuestion: false,
    businessRules: requirements.businessRules,
    validationRules: requirements.validationRules,
  });

  let status = evaluated.status;
  if (openBlockers.length > 0) status = 'BLOCKED';
  else if (status === 'BLOCKED') status = 'MOSTLY_READY'; // only a verified inbound blocker may block
  if (status !== 'BLOCKED' && acceptanceCriteria.length === 0) status = 'NEEDS_CLARIFICATION';

  const gaps: Gap[] = [];
  for (const blocker of openBlockers) gaps.push({ id: `blocker-${blocker.key}`, text: `Blocked by ${blocker.key} (${blocker.status}).` });
  for (const blocker of unknownBlockers) {
    gaps.push({ id: 'blocker-status-unknown', text: `The status of blocker ${blocker.key} could not be read.` });
  }
  if (acceptanceCriteria.length === 0) gaps.push({ id: 'no-acceptance-criteria', text: 'No acceptance criteria were found.' });
  if (materialConflicts.length > 0) {
    gaps.push({ id: 'conflicts', text: `${materialConflicts.length} conflicting requirement(s) between sources.` });
  }
  if (ambiguities.length > 0) gaps.push({ id: 'ambiguities', text: `${ambiguities.length} ambiguous requirement(s) in the description.` });

  let confidence: Confidence = 'high';
  for (const source of Object.keys(EVIDENCE_LABEL) as Array<keyof IssueContext['evidence']>) {
    const state = context.evidence[source];
    if (WEAK_EVIDENCE.has(state)) {
      confidence = lowerConfidence(confidence);
      gaps.push({ id: `evidence-${source}`, text: `${EVIDENCE_LABEL[source]} could not be fully read (${state}).` });
    }
  }

  // ── Actions and questions ───────────────────────────────────────────────────
  const branchName = suggestBranchName(
    { key, summary: fields.summary, issueType: fields.issuetype.name },
    config.branchPattern || DEFAULT_BRANCH_PATTERN,
  );
  const linkRefs = (links: LinkedIssueContext[]) => links.map((l) => `link:${l.key}`);

  const problems: Action[] = [];
  if (openBlockers.length > 0) {
    problems.push({ id: 'resolve-blocker', text: `Resolve blocker ${openBlockers[0].key} before starting.`, evidence: linkRefs(openBlockers) });
  }
  if (materialConflicts.length > 0) {
    problems.push({
      id: 'resolve-conflict',
      text: `Resolve the conflicting requirement (${materialConflicts.length} conflict(s)) before implementing.`,
      evidence: materialConflicts.map(({ index }) => `conflict:${index}`),
    });
  }
  if (ambiguities.length > 0) {
    problems.push({ id: 'answer-ambiguity', text: `Clarify ${ambiguities.length} ambiguous requirement(s) with the reporter.`, evidence: [descriptionRef] });
  }
  if (acceptanceCriteria.length === 0) {
    problems.push({ id: 'add-acceptance-criteria', text: 'Ask for explicit acceptance criteria; none were found.', evidence: [descriptionRef] });
  }

  const progress: Action[] = [];
  if (openBlockers.length === 0) {
    progress.push({ id: 'create-branch', text: `Create branch ${branchName}.`, evidence: [`issue:${key}:summary`] });
  }
  progress.push({
    id: 'implement-and-verify',
    text:
      acceptanceCriteria.length > 0
        ? `Implement against the ${acceptanceCriteria.length} acceptance criteria, then run delivery_check_changes.`
        : 'Implement once acceptance criteria are agreed, then run delivery_check_changes.',
    evidence: [acceptanceRef],
  });
  const recommendedActions = [...problems.slice(0, MAX_ACTIONS - progress.length), ...progress];

  // A question is material only if answering it could change the top action.
  const materialProblemIds = new Set(
    problems.slice(0, problems[0]?.id === 'resolve-blocker' ? 2 : 1).map((a) => a.id),
  );
  const evidenceOf = (id: string) => problems.find((a) => a.id === id)?.evidence ?? [descriptionRef];
  const candidates: Array<Question & { action: string | null }> = [];
  for (const blocker of unknownBlockers) {
    candidates.push({
      id: 'q-blocker-status',
      action: null,
      text: `Is ${blocker.key} still blocking this work?`,
      reason: 'The blocker status could not be read.',
      evidence: [`link:${blocker.key}`],
    });
  }
  candidates.push(
    {
      id: 'q-conflict',
      action: 'resolve-conflict',
      text: 'Which source is authoritative for the conflicting requirement: the description or the later comment?',
      reason: 'Sources disagree on a requirement.',
      evidence: evidenceOf('resolve-conflict'),
    },
    {
      id: 'q-acceptance-criteria',
      action: 'add-acceptance-criteria',
      text: `What are the acceptance criteria for ${key}?`,
      reason: 'No acceptance criteria were found.',
      evidence: evidenceOf('add-acceptance-criteria'),
    },
    {
      id: 'q-ambiguity',
      action: 'answer-ambiguity',
      text: `Can the ${ambiguities.length} ambiguous requirement(s) be made specific?`,
      reason: 'The description contains ambiguous wording.',
      evidence: evidenceOf('answer-ambiguity'),
    },
  );
  const clarifyingQuestions: Question[] = candidates
    .filter((q) => q.action === null || materialProblemIds.has(q.action))
    .slice(0, MAX_QUESTIONS)
    .map(({ action: _action, ...question }) => question);

  return {
    issue: {
      key,
      summary: fields.summary,
      type: fields.issuetype.name,
      status: fields.status.name,
      statusCategory: toStatusCategory(fields.status.statusCategory?.key),
      priority: fields.priority?.name ?? null,
      assignee: fields.assignee?.displayName ?? null,
    },
    readiness: {
      status,
      score: Math.max(0, Math.min(100, Math.round(evaluated.score))),
      confidence,
      gaps,
    },
    acceptanceCriteria,
    blockers: openBlockers.map((l) => ({ key: l.key, status: l.status, direction: 'inward' as const })),
    recommendedActions,
    clarifyingQuestions,
    branchName,
    evidence: { ...context.evidence, confluence: 'not_requested' },
  };
}
