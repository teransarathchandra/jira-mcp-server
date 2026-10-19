import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect, textOf } from './harness.js';

vi.mock('../../src/tools/deliveryGenerateTestStrategy.js', () => ({ deliveryGenerateTestStrategy: vi.fn(async () => 'TEST') }));
vi.mock('../../src/tools/deliveryGenerateReviewerReport.js', () => ({ deliveryGenerateReviewerReport: vi.fn(async () => 'REVIEW') }));
vi.mock('../../src/tools/deliveryGenerateQaHandoff.js', () => ({ deliveryGenerateQaHandoff: vi.fn(async () => 'QA') }));
vi.mock('../../src/tools/deliveryGenerateReleaseNotes.js', () => ({ deliveryGenerateReleaseNotes: vi.fn(async () => 'NOTES') }));
vi.mock('../../src/tools/deliveryExportTaskReport.js', () => ({ deliveryExportTaskReport: vi.fn(async () => 'REPORT') }));
vi.mock('../../src/tools/deliveryGenerateClaudeWorkflowPack.js', () => ({ deliveryGenerateClaudeWorkflowPack: vi.fn(async () => 'CLAUDE') }));
vi.mock('../../src/tools/deliveryGenerateCodexPromptPack.js', () => ({ deliveryGenerateCodexPromptPack: vi.fn(async () => 'CODEX') }));
vi.mock('../../src/tools/deliveryGenerateGenericPromptPack.js', () => ({ deliveryGenerateGenericPromptPack: vi.fn(async () => 'GENERIC') }));
vi.mock('../../src/tools/deliveryScanProjectPatterns.js', () => ({
  deliveryScanProjectPatterns: vi.fn(async () => 'SCAN'),
  deliveryGetProjectPatterns: vi.fn(async () => 'GET'),
  deliveryClearProjectPatterns: vi.fn(async () => 'CLEAR'),
}));

const reviewer = vi.mocked((await import('../../src/tools/deliveryGenerateReviewerReport.js')).deliveryGenerateReviewerReport);
const releaseNotes = vi.mocked((await import('../../src/tools/deliveryGenerateReleaseNotes.js')).deliveryGenerateReleaseNotes);
const exportReport = vi.mocked((await import('../../src/tools/deliveryExportTaskReport.js')).deliveryExportTaskReport);
const testStrategy = vi.mocked((await import('../../src/tools/deliveryGenerateTestStrategy.js')).deliveryGenerateTestStrategy);
const claudePack = vi.mocked((await import('../../src/tools/deliveryGenerateClaudeWorkflowPack.js')).deliveryGenerateClaudeWorkflowPack);
const scan = vi.mocked((await import('../../src/tools/deliveryScanProjectPatterns.js')).deliveryScanProjectPatterns);

const markdownOf = (r: { structuredContent?: unknown }) => (r.structuredContent as { markdown: string }).markdown;

describe('delivery generate tools', () => {
  let session: Awaited<ReturnType<typeof connect>>;
  const call = (name: string, args: Record<string, unknown>) => session.client.callTool({ name, arguments: args });

  beforeEach(async () => {
    vi.clearAllMocks();
    session = await connect();
  });
  afterEach(async () => {
    await session.close();
  });

  describe('delivery_generate', () => {
    it.each([
      ['test_strategy', 'TEST'],
      ['qa_handoff', 'QA'],
      ['release_notes', 'NOTES'],
      ['task_report', 'REPORT'],
    ])('dispatches type %s', async (type, expected) => {
      const r = await call('delivery_generate', { issueKey: 'ABC-1', type });
      expect(markdownOf(r)).toBe(expected);
    });

    it('dispatches reviewer_report with the persona', async () => {
      const r = await call('delivery_generate', { issueKey: 'ABC-1', type: 'reviewer_report', persona: 'qa_reviewer' });
      expect(markdownOf(r)).toBe('REVIEW');
      expect(reviewer.mock.calls[0][0]).toMatchObject({ persona: 'qa_reviewer' });
    });

    it('requires a persona for reviewer_report', async () => {
      const r = await call('delivery_generate', { issueKey: 'ABC-1', type: 'reviewer_report' });
      expect(r.isError).toBe(true);
      expect(textOf(r)).toBe('Invalid input: persona is required when type is reviewer_report');
      expect(reviewer).not.toHaveBeenCalled();
    });

    it('defaults release notes to the internal audience', async () => {
      await call('delivery_generate', { issueKey: 'ABC-1', type: 'release_notes' });
      expect(releaseNotes.mock.calls[0][0]).toMatchObject({ audience: 'internal', includeConfluence: true });
    });

    it('passes v1 defaults to the test strategy', async () => {
      await call('delivery_generate', { issueKey: 'ABC-1', type: 'test_strategy' });
      expect(testStrategy.mock.calls[0][0]).toEqual({
        issueKey: 'ABC-1',
        includeConfluence: true,
        includePrDiff: false,
        baseBranch: 'origin/main',
        compareRef: 'HEAD',
        repoPath: '.',
      });
    });

    it('rejects an unknown task_report section instead of silently dropping it', async () => {
      const r = await call('delivery_generate', { issueKey: 'ABC-1', type: 'task_report', sections: ['contxt'] });
      expect(r.isError).toBe(true);
      expect(exportReport).not.toHaveBeenCalled();
    });

    it('never asks the task report to write a file', async () => {
      await call('delivery_generate', { issueKey: 'ABC-1', type: 'task_report' });
      const input = exportReport.mock.calls[0][0];
      expect(input).not.toHaveProperty('outputPath');
      expect(input.sections).toEqual(['context', 'impact', 'traceability', 'definition_of_done', 'test_strategy', 'qa_handoff']);
    });
  });

  describe('delivery_generate_agent_pack', () => {
    it.each([
      ['claude', 'CLAUDE'],
      ['codex', 'CODEX'],
      ['generic', 'GENERIC'],
    ])('dispatches client %s', async (client, expected) => {
      const r = await call('delivery_generate_agent_pack', { client });
      expect(markdownOf(r)).toBe(expected);
    });

    it('forwards repoPath and overwrite defaults', async () => {
      await call('delivery_generate_agent_pack', { client: 'claude' });
      expect(claudePack.mock.calls[0][0]).toEqual({ repoPath: '.', overwrite: false });
    });

    it('is annotated as destructive', async () => {
      const { tools } = await session.client.listTools();
      const tool = tools.find((t) => t.name === 'delivery_generate_agent_pack');
      expect(tool?.annotations?.destructiveHint).toBe(true);
    });
  });

  describe('delivery_project_patterns', () => {
    it.each([
      ['scan', 'SCAN'],
      ['get', 'GET'],
      ['clear', 'CLEAR'],
    ])('dispatches action %s', async (action, expected) => {
      const r = await call('delivery_project_patterns', { action });
      expect(markdownOf(r)).toBe(expected);
    });

    it('forwards the repoPath default', async () => {
      await call('delivery_project_patterns', { action: 'scan' });
      expect(scan.mock.calls[0][0]).toEqual({ repoPath: '.' });
    });
  });
});
