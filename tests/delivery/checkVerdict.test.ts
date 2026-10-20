import { describe, it, expect } from 'vitest';
import { deriveVerdict } from '../../src/delivery/checkVerdict.js';
import { CheckChangesDataSchema, type CheckChangesData } from '../../src/delivery/checkChangesTypes.js';

type Alignment = NonNullable<CheckChangesData['alignment']>;
type Dod = NonNullable<CheckChangesData['dod']>;

const diff = (filesChanged: number): CheckChangesData['diff'] => ({ baseBranch: 'main', compareRef: 'HEAD', filesChanged, truncated: false });

const alignment = (statuses: Alignment['criteria'][number]['status'][], status: Alignment['status'] = 'MOSTLY_ALIGNED'): Alignment => ({
  status,
  score: 80,
  confidence: 'High',
  criteria: statuses.map((s, i) => ({ text: `criterion ${i}`, status: s, files: [] })),
  unrelatedChanges: [],
  testSignal: 'tests_added',
});

const dod = (status: Dod['status'], requiredFixes: string[] = []): Dod => ({
  status,
  score: 90,
  confidence: 'High',
  failed: [],
  warnings: [],
  requiredFixes,
});

describe('deriveVerdict()', () => {
  it('is insufficient_evidence when the branch has no changes', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], alignment: alignment(['covered']), dod: dod('READY_FOR_REVIEW'), diff: diff(0), failedChecks: [] });
    expect(r).toEqual({ verdict: 'insufficient_evidence', summary: 'Not enough evidence: no changes against main.' });
  });

  it('needs work when a criterion is missing', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], alignment: alignment(['covered', 'missing']), dod: dod('READY_FOR_REVIEW'), diff: diff(3), failedChecks: [] });
    expect(r).toEqual({ verdict: 'needs_work', summary: 'Needs work: 1 missing, 0 partial criteria, 0 required fixes.' });
  });

  it('needs work when the Definition of Done fails', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], alignment: alignment(['covered']), dod: dod('NEEDS_MAJOR_FIXES'), diff: diff(3), failedChecks: [] });
    expect(r.verdict).toBe('needs_work');
  });

  it('needs work when there are required fixes', () => {
    const r = deriveVerdict({ selected: ['dod'], dod: dod('READY_FOR_REVIEW', ['Add tests']), failedChecks: [] });
    expect(r).toEqual({ verdict: 'needs_work', summary: 'Needs work: 0 missing, 0 partial criteria, 1 required fixes.' });
  });

  it('is ready when every criterion is covered and the DoD passes', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], alignment: alignment(['covered', 'covered']), dod: dod('READY_FOR_REVIEW'), diff: diff(3), failedChecks: [] });
    expect(r).toEqual({ verdict: 'ready_for_pr', summary: 'Ready for PR: all 2 criteria covered.' });
  });

  it('is insufficient_evidence when alignment found nothing and the DoD check failed', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], alignment: alignment([], 'NOT_ENOUGH_EVIDENCE'), diff: diff(3), failedChecks: ['dod'] });
    expect(r).toEqual({ verdict: 'insufficient_evidence', summary: 'Not enough evidence: the dod check failed.' });
  });

  it('is insufficient_evidence when every diff-based check failed', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod', 'impact'], failedChecks: ['alignment', 'dod'] });
    expect(r).toEqual({ verdict: 'insufficient_evidence', summary: 'Not enough evidence: checks failed.' });
  });

  it('never lets the impact check change the verdict', () => {
    const base = { selected: ['alignment', 'dod'] as const, alignment: alignment(['covered']), dod: dod('READY_FOR_REVIEW'), diff: diff(2), failedChecks: [] };
    const withImpact = deriveVerdict({ ...base, selected: ['alignment', 'dod', 'impact'] });
    expect(withImpact).toEqual(deriveVerdict({ ...base, selected: [...base.selected] }));
  });

  it('is insufficient_evidence when the diff could not be read, even if the DoD graded an empty diff', () => {
    const r = deriveVerdict({
      selected: ['alignment', 'dod'],
      dod: dod('NEEDS_MAJOR_FIXES', ['Add tests']),
      failedChecks: ['alignment'],
      diffUnreadable: true,
      baseBranch: 'origin/main',
    });
    expect(r).toEqual({ verdict: 'insufficient_evidence', summary: 'Not enough evidence: the diff against origin/main could not be read.' });
  });

  // Review fix 1: "ready" must not claim coverage that is partial or unproven.
  it('needs work when a criterion is only partially covered', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], alignment: alignment(['covered', 'partial']), dod: dod('READY_FOR_REVIEW'), diff: diff(3), failedChecks: [] });
    expect(r).toEqual({ verdict: 'needs_work', summary: 'Needs work: 0 missing, 1 partial criteria, 0 required fixes.' });
  });

  it('is insufficient_evidence when criteria have no evidence, even if the DoD passes', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], alignment: alignment(['covered', 'not_enough_evidence']), dod: dod('READY_FOR_REVIEW'), diff: diff(3), failedChecks: [] });
    expect(r).toEqual({ verdict: 'insufficient_evidence', summary: 'Not enough evidence: 1 of 2 criteria have no evidence.' });
  });

  it('is insufficient_evidence when alignment found no evidence, even if the DoD passes', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], alignment: alignment([], 'NOT_ENOUGH_EVIDENCE'), dod: dod('READY_FOR_REVIEW'), diff: diff(3), failedChecks: [] });
    expect(r).toEqual({ verdict: 'insufficient_evidence', summary: 'Not enough evidence: alignment could not find evidence.' });
  });

  // Review fix 2: a crashed diff-based check never yields ready_for_pr.
  it('is insufficient_evidence when the alignment check crashed but the DoD passed', () => {
    const r = deriveVerdict({ selected: ['alignment', 'dod'], dod: dod('READY_FOR_REVIEW'), failedChecks: ['alignment'] });
    expect(r).toEqual({ verdict: 'insufficient_evidence', summary: 'Not enough evidence: the alignment check failed.' });
  });

  it('is not_applicable when only the impact check was run (planning, no PR verdict)', () => {
    const r = deriveVerdict({ selected: ['impact'], failedChecks: [] });
    expect(r).toEqual({
      verdict: 'not_applicable',
      summary: 'No PR verdict: only the impact check was run. Run alignment or dod once there are changes.',
    });
  });

  it('is not_applicable for impact-only even when the branch has no changes yet', () => {
    const r = deriveVerdict({ selected: ['impact'], diff: diff(0), failedChecks: [] });
    expect(r.verdict).toBe('not_applicable');
  });

  it('the output schema accepts not_applicable', () => {
    const parsed = CheckChangesDataSchema.safeParse({
      verdict: 'not_applicable',
      summary: 's',
      impact: { likelyAffectedAreas: [], riskyDownstreamFlows: [], unknowns: [] },
      failedChecks: [],
      diff: diff(0),
    });
    expect(parsed.success).toBe(true);
  });
});
