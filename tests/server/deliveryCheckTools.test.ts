import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect } from './harness.js';
import { ConfluenceAuthError } from '../../src/confluence/confluenceConfig.js';

const order: string[] = [];

const diff = { baseBranch: 'origin/main', compareRef: 'HEAD', filesChanged: 2, truncated: false };

vi.mock('../../src/tools/reviewPrAlignment.js', () => ({
  DiffUnavailableError: class DiffUnavailableError extends Error {},
  computeAlignment: vi.fn(async () => {
    order.push('alignment');
    return {
      markdown: 'ALIGNMENT',
      diff,
      data: {
        status: 'MOSTLY_ALIGNED', score: 80, confidence: 'High',
        criteria: [{ text: 'c', status: 'covered', files: ['src/a.ts'] }],
        unrelatedChanges: [], testSignal: 'tests_added',
      },
    };
  }),
}));
vi.mock('../../src/tools/deliveryVerifyDefinitionOfDone.js', () => ({
  computeDefinitionOfDone: vi.fn(async () => {
    order.push('dod');
    return {
      markdown: 'DOD',
      diffRead: true,
      data: { status: 'READY_FOR_REVIEW', score: 90, confidence: 'High', failed: [], warnings: [], requiredFixes: [] },
    };
  }),
}));
vi.mock('../../src/tools/deliveryAnalyzeImplementationImpact.js', () => ({
  computeImpact: vi.fn(async () => {
    order.push('impact');
    return { markdown: 'IMPACT', data: { likelyAffectedAreas: ['auth'], riskyDownstreamFlows: [], unknowns: [] } };
  }),
}));
vi.mock('../../src/tools/deliveryGetTraceabilityMatrix.js', () => ({
  deliveryGetTraceabilityMatrix: vi.fn(async () => 'MATRIX'),
}));

const alignment = vi.mocked((await import('../../src/tools/reviewPrAlignment.js')).computeAlignment);
const dod = vi.mocked((await import('../../src/tools/deliveryVerifyDefinitionOfDone.js')).computeDefinitionOfDone);
const impact = vi.mocked(
  (await import('../../src/tools/deliveryAnalyzeImplementationImpact.js')).computeImpact,
);
const matrix = vi.mocked((await import('../../src/tools/deliveryGetTraceabilityMatrix.js')).deliveryGetTraceabilityMatrix);

type Envelope = { markdown: string; warnings: string[]; data: { verdict: string; failedChecks: string[]; alignment?: unknown; impact?: unknown } };

describe('delivery check tools', () => {
  let session: Awaited<ReturnType<typeof connect>>;
  const check = (args: Record<string, unknown>) =>
    session.client.callTool({ name: 'delivery_check_changes', arguments: { issueKey: 'ABC-1', ...args } });

  beforeEach(async () => {
    vi.clearAllMocks();
    order.length = 0;
    session = await connect();
  });
  afterEach(async () => {
    await session.close();
  });

  it('runs alignment, dod and impact in order by default', async () => {
    const r = await check({});
    expect(order).toEqual(['alignment', 'dod', 'impact']);
    expect((r.structuredContent as Envelope).markdown).toBe('ALIGNMENT\n\n---\n\nDOD\n\n---\n\nIMPACT');
  });

  it('passes local-diff mode and v1 git defaults to the alignment check', async () => {
    await check({ checks: ['alignment'] });
    expect(alignment.mock.calls[0][0]).toEqual({
      issueKey: 'ABC-1',
      mode: 'local_diff',
      baseBranch: 'origin/main',
      compareRef: 'HEAD',
      repoPath: '.',
      maxDiffChars: 50000,
    });
  });

  it('passes v1 defaults to the dod and impact checks', async () => {
    await check({ checks: ['dod', 'impact'] });
    expect(dod.mock.calls[0][0]).toEqual({
      issueKey: 'ABC-1',
      baseBranch: 'origin/main',
      compareRef: 'HEAD',
      repoPath: '.',
      includeConfluence: true,
    });
    expect(impact.mock.calls[0][0]).toEqual({ issueKey: 'ABC-1', includeConfluence: true });
  });

  it('an impact-only run returns the not_applicable verdict through the output schema', async () => {
    const r = await check({ checks: ['impact'] });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as Envelope).data.verdict).toBe('not_applicable');
  });

  it('the tool description lists every verdict', async () => {
    const { tools } = await session.client.listTools();
    const description = tools.find((t) => t.name === 'delivery_check_changes')?.description ?? '';
    for (const v of ['ready_for_pr', 'needs_work', 'insufficient_evidence', 'not_applicable']) expect(description).toContain(v);
  });

  it('runs only the requested checks', async () => {
    await check({ checks: ['dod'] });
    expect(dod).toHaveBeenCalledTimes(1);
    expect(alignment).not.toHaveBeenCalled();
    expect(impact).not.toHaveBeenCalled();
  });

  it('keeps the other check results when one check fails', async () => {
    dod.mockRejectedValueOnce(new ConfluenceAuthError('401'));
    const r = await check({});
    expect(r.isError).toBeFalsy();
    const env = r.structuredContent as Envelope;
    expect(env.markdown).toContain('ALIGNMENT');
    expect(env.markdown).toContain('IMPACT');
    expect(env.markdown).toContain('dod check failed');
    expect(env.markdown).toContain('Confluence authentication error: 401');
    expect(env.warnings).toEqual(['dod check failed']);
    expect(env.data.failedChecks).toEqual(['dod']);
    expect(env.data.alignment).toBeDefined();
    expect(env.data.impact).toBeDefined();
  });

  it('is an error when every selected check fails', async () => {
    alignment.mockRejectedValueOnce(new Error('a'));
    dod.mockRejectedValueOnce(new Error('b'));
    impact.mockRejectedValueOnce(new Error('c'));
    const r = await check({});
    expect(r.isError).toBe(true);
  });

  it('rejects an empty checks list without running anything', async () => {
    const r = await check({ checks: [] });
    expect(r.isError).toBe(true);
    expect(order).toEqual([]);
  });

  it('delivery_traceability_matrix forwards the v1 defaults', async () => {
    const r = await session.client.callTool({ name: 'delivery_traceability_matrix', arguments: { issueKey: 'ABC-1' } });
    expect(matrix.mock.calls[0][0]).toEqual({
      issueKey: 'ABC-1',
      baseBranch: 'origin/main',
      compareRef: 'HEAD',
      repoPath: '.',
      includeConfluence: true,
      includePrDiff: true,
    });
    expect((r.structuredContent as Envelope).markdown).toBe('MATRIX');
  });
});
