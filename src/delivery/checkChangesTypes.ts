import { z } from 'zod';

// Typed `data` returned by delivery_check_changes (R2 design §6.1). Enum values
// mirror the existing analyzer types (AlignmentResult, MatchResult, DoDResult).

export const CHECKS = ['alignment', 'dod', 'impact'] as const;
export type Check = (typeof CHECKS)[number];

const Confidence = z.enum(['High', 'Medium', 'Low']);
const CheckItem = z.object({ id: z.string(), name: z.string(), detail: z.string() });

export const AlignmentDataSchema = z.object({
  status: z.enum(['STRONGLY_ALIGNED', 'MOSTLY_ALIGNED', 'PARTIALLY_ALIGNED', 'WEAKLY_ALIGNED', 'NOT_ENOUGH_EVIDENCE']),
  score: z.number(),
  confidence: Confidence,
  criteria: z.array(
    z.object({
      text: z.string(),
      status: z.enum(['covered', 'partial', 'missing', 'not_enough_evidence']),
      files: z.array(z.string()),
    }),
  ),
  unrelatedChanges: z.array(z.object({ path: z.string(), reason: z.string() })),
  testSignal: z.enum(['tests_added', 'tests_modified', 'no_test_changes', 'only_snapshots_changed', 'tests_in_unrelated_areas']),
});

export const DodDataSchema = z.object({
  status: z.enum(['READY_FOR_REVIEW', 'NEEDS_SMALL_FIXES', 'NEEDS_MAJOR_FIXES', 'BLOCKED_BY_REQUIREMENT_GAP', 'NOT_ENOUGH_EVIDENCE']),
  score: z.number(),
  confidence: Confidence,
  failed: z.array(CheckItem),
  warnings: z.array(CheckItem),
  requiredFixes: z.array(z.string()),
});

export const ImpactDataSchema = z.object({
  likelyAffectedAreas: z.array(z.string()),
  riskyDownstreamFlows: z.array(z.string()),
  unknowns: z.array(z.string()),
});

export const DiffInfoSchema = z.object({
  baseBranch: z.string(),
  compareRef: z.string(),
  filesChanged: z.number().int().min(0),
  truncated: z.boolean(),
});

export const CheckChangesDataSchema = z.object({
  verdict: z.enum(['ready_for_pr', 'needs_work', 'insufficient_evidence']),
  summary: z.string(),
  alignment: AlignmentDataSchema.optional(),
  dod: DodDataSchema.optional(),
  impact: ImpactDataSchema.optional(),
  failedChecks: z.array(z.enum(CHECKS)),
  diff: DiffInfoSchema,
});

export type CheckChangesData = z.infer<typeof CheckChangesDataSchema>;
export type AlignmentData = z.infer<typeof AlignmentDataSchema>;
export type DodData = z.infer<typeof DodDataSchema>;
export type ImpactData = z.infer<typeof ImpactDataSchema>;
export type DiffInfo = z.infer<typeof DiffInfoSchema>;
