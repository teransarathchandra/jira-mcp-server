import { describe, it, expect } from 'vitest';
import { formatMatrix } from '../src/tools/deliveryGetTraceabilityMatrix.js';
import { formatTestStrategy } from '../src/tools/deliveryGenerateTestStrategy.js';
import { markdownToAdf, type AdfNode } from '../src/utils/markdownToAdf.js';
import type { TraceabilityMatrix, TestStrategy } from '../src/delivery/deliveryTypes.js';

// Ticket text with a pipe or a newline must stay inside its table cell, both in
// the Markdown and in the Jira table jira_add_comment posts.

const tables = (md: string): AdfNode[] => markdownToAdf(md).content.filter((n) => n.type === 'table');
const cellCounts = (table: AdfNode) => (table.content ?? []).map((row) => row.content?.length);

describe('generated tables escape cell text', () => {
  it('traceability matrix: a requirement with | and a newline keeps 7 cells', () => {
    const matrix: TraceabilityMatrix = {
      issueKey: 'ABC-1', issueSummary: 's', generatedAt: '2026-10-20',
      items: [{
        requirementId: 'R1', requirementText: 'Show A | B\nside by side', source: 'acceptance_criteria', sourceAuthority: 'high',
        expectedImplementationArea: '', matchedFiles: ['src/a|b.ts'], matchedDiffEvidence: [], matchedTests: [],
        coverageStatus: 'covered', confidence: 'high', notes: '',
      }],
      totalRequirements: 1, covered: 1, partial: 0, missing: 0, notEnoughEvidence: 0, notApplicable: 0,
    } as TraceabilityMatrix;
    const [table] = tables(formatMatrix(matrix));
    expect(cellCounts(table)).toEqual([7, 7]);
    const reqCell = table.content![1].content![1].content![0].content!.map((t) => t.text).join('');
    expect(reqCell).toBe('Show A | B side by side');
  });

  it('test strategy: a description with | keeps 2 cells', () => {
    const strategy = {
      issueKey: 'ABC-1', issueSummary: 's', requirementSummary: 'r', testScope: 't',
      testCases: [{ category: 'unit', description: 'Parses "a|b"', priority: 'high' }],
      missingTestEvidence: [], suggestedTestData: [], regressionAreas: [],
    } as unknown as TestStrategy;
    const [table] = tables(formatTestStrategy(strategy, false));
    expect(cellCounts(table)).toEqual([2, 2]);
  });
});
