import type { AlignmentData, Check, CheckChangesData, DiffInfo, DodData } from './checkChangesTypes.js';

// Verdict rules for delivery_check_changes (R2 design §6.2). Only the
// diff-based checks (alignment, dod) decide the verdict; impact is advisory.

const DOD_FAILED: ReadonlySet<DodData['status']> = new Set(['NEEDS_SMALL_FIXES', 'NEEDS_MAJOR_FIXES', 'BLOCKED_BY_REQUIREMENT_GAP']);

export function deriveVerdict(parts: {
  selected: readonly Check[];
  alignment?: AlignmentData;
  dod?: DodData;
  diff?: DiffInfo;
  failedChecks: readonly Check[];
  /** True when the local diff could not be read, so DoD results graded an empty diff. */
  diffUnreadable?: boolean;
  baseBranch?: string;
}): Pick<CheckChangesData, 'verdict' | 'summary'> {
  const insufficient = (reason: string) => ({ verdict: 'insufficient_evidence' as const, summary: `Not enough evidence: ${reason}.` });

  const diffBased = parts.selected.filter((c) => c === 'alignment' || c === 'dod');
  if (diffBased.length === 0) return insufficient('no diff-based checks were run');
  if (parts.diffUnreadable) {
    return insufficient(`the diff against ${parts.baseBranch ?? parts.diff?.baseBranch ?? 'the base branch'} could not be read`);
  }
  if (parts.diff && parts.diff.filesChanged === 0) return insufficient(`no changes against ${parts.diff.baseBranch}`);

  const failed = new Set(parts.failedChecks);
  if (diffBased.every((c) => failed.has(c))) return insufficient('checks failed');
  // A crashed diff-based check leaves the verdict unproven, never ready.
  const crashed = diffBased.find((c) => failed.has(c));
  if (crashed) return insufficient(`the ${crashed} check failed`);

  if (parts.alignment?.status === 'NOT_ENOUGH_EVIDENCE') return insufficient('alignment could not find evidence');
  if (!parts.alignment && parts.dod?.status === 'NOT_ENOUGH_EVIDENCE') {
    return insufficient('the Definition of Done check could not find evidence');
  }

  const criteria = parts.alignment?.criteria ?? [];
  const count = (status: AlignmentData['criteria'][number]['status']) => criteria.filter((c) => c.status === status).length;
  const missing = count('missing');
  const partial = count('partial');
  const noEvidence = count('not_enough_evidence');
  const requiredFixes = parts.dod?.requiredFixes.length ?? 0;
  const dodFailed = parts.dod !== undefined && DOD_FAILED.has(parts.dod.status);
  if (missing > 0 || partial > 0 || requiredFixes > 0 || dodFailed) {
    return {
      verdict: 'needs_work',
      summary: `Needs work: ${missing} missing, ${partial} partial criteria, ${requiredFixes} required fixes.`,
    };
  }
  if (noEvidence > 0) return insufficient(`${noEvidence} of ${criteria.length} criteria have no evidence`);

  const summary = parts.alignment
    ? `Ready for PR: all ${criteria.length} criteria covered.`
    : 'Ready for PR: Definition of Done passed.';
  return { verdict: 'ready_for_pr', summary };
}
