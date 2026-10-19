import { z } from 'zod';

// Typed `data` returned by jira_prepare_work_brief (R2 design §4.2).

export const EvidenceStateSchema = z.enum([
  'observed',
  'observed_empty',
  'not_requested',
  'not_configured',
  'denied_or_missing',
  'truncated',
  'fetch_error',
]);

const ReferencedItem = {
  id: z.string(),
  text: z.string(),
  evidence: z.array(z.string()).min(1),
};

export const WorkBriefDataSchema = z.object({
  issue: z.object({
    key: z.string(),
    summary: z.string(),
    type: z.string(),
    status: z.string(),
    statusCategory: z.enum(['new', 'indeterminate', 'done', 'unknown']),
    priority: z.string().nullable(),
    assignee: z.string().nullable(),
  }),
  readiness: z.object({
    status: z.enum(['READY', 'MOSTLY_READY', 'NEEDS_CLARIFICATION', 'BLOCKED']),
    score: z.number().int().min(0).max(100),
    confidence: z.enum(['high', 'medium', 'low']),
    gaps: z.array(z.object({ id: z.string(), text: z.string() })),
  }),
  acceptanceCriteria: z.array(z.object({ text: z.string(), source: z.enum(['field', 'description']) })),
  blockers: z.array(z.object({ key: z.string(), status: z.string(), direction: z.literal('inward') })),
  recommendedActions: z.array(z.object(ReferencedItem)).min(2).max(4),
  clarifyingQuestions: z.array(z.object({ ...ReferencedItem, reason: z.string() })).max(3),
  branchName: z.string(),
  evidence: z.object({
    comments: EvidenceStateSchema,
    linkedIssues: EvidenceStateSchema,
    subtasks: EvidenceStateSchema,
    parent: EvidenceStateSchema,
    epic: EvidenceStateSchema,
    acceptanceCriteriaField: EvidenceStateSchema,
    confluence: EvidenceStateSchema,
  }),
});

export type WorkBriefData = z.infer<typeof WorkBriefDataSchema>;
