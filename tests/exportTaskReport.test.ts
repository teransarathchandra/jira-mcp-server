import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  exportTaskReport,
  type ExportTaskReportInput,
} from '../src/delivery/exportTaskReport.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

function baseInput(overrides: Partial<ExportTaskReportInput> = {}): ExportTaskReportInput {
  return {
    issueKey: 'CMPI-9999',
    issueSummary: 'Test issue summary',
    sections: [],
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('exportTaskReport', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'export-report-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('all requested sections appear in output', () => {
    const impactContent = '## Impact\n\nSome impact details.';
    const testStratContent = '## Test Strategy\n\nSome test cases.';

    const result = exportTaskReport(
      baseInput({
        sections: ['impact', 'test_strategy'],
        impactMarkdown: impactContent,
        testStrategyMarkdown: testStratContent,
      }),
    );

    expect(result.content).toContain(impactContent);
    expect(result.content).toContain(testStratContent);
  });

  it('sections are assembled in input order', () => {
    const result = exportTaskReport(
      baseInput({
        sections: ['test_strategy', 'impact'],
        impactMarkdown: 'IMPACT_CONTENT',
        testStrategyMarkdown: 'TEST_CONTENT',
      }),
    );

    const testIdx = result.content.indexOf('TEST_CONTENT');
    const impactIdx = result.content.indexOf('IMPACT_CONTENT');

    expect(testIdx).toBeGreaterThanOrEqual(0);
    expect(impactIdx).toBeGreaterThanOrEqual(0);
    expect(testIdx).toBeLessThan(impactIdx);
  });

  it('header always present with issueKey', () => {
    const result = exportTaskReport(baseInput({ issueKey: 'CMPI-1234', sections: [] }));

    expect(result.content).toContain('# Delivery Report: CMPI-1234');
    expect(result.content).toContain('CMPI-1234');
  });

  it('warning message always present', () => {
    const result = exportTaskReport(baseInput({ sections: [] }));

    expect(result.content).toContain(
      'This report is generated from static analysis. Verify critical findings independently.',
    );
  });

  it('sections not in input.sections are omitted', () => {
    const result = exportTaskReport(
      baseInput({
        sections: ['impact'],
        impactMarkdown: 'IMPACT_ONLY',
        testStrategyMarkdown: 'TEST_STRATEGY_SHOULD_NOT_APPEAR',
        qaHandoffMarkdown: 'QA_HANDOFF_SHOULD_NOT_APPEAR',
      }),
    );

    expect(result.content).toContain('IMPACT_ONLY');
    expect(result.content).not.toContain('TEST_STRATEGY_SHOULD_NOT_APPEAR');
    expect(result.content).not.toContain('QA_HANDOFF_SHOULD_NOT_APPEAR');
  });

  it('outputPath throws if file exists and overwrite=false', () => {
    const outputPath = join(tempDir, 'report.md');

    // Create the file first
    exportTaskReport(
      baseInput({
        sections: [],
        outputPath,
        overwrite: true,
      }),
    );

    expect(existsSync(outputPath)).toBe(true);

    // Now try without overwrite
    expect(() =>
      exportTaskReport(
        baseInput({
          sections: [],
          outputPath,
          overwrite: false,
        }),
      ),
    ).toThrow(`File already exists: ${outputPath}. Set overwrite=true to overwrite.`);
  });

  it('outputPath writes file and returns writtenToFile=true', () => {
    const outputPath = join(tempDir, 'report.md');

    const result = exportTaskReport(
      baseInput({
        sections: ['impact'],
        impactMarkdown: '## Impact Section',
        outputPath,
        overwrite: false,
      }),
    );

    expect(result.writtenToFile).toBe(true);
    expect(result.outputPath).toBe(outputPath);
    expect(existsSync(outputPath)).toBe(true);

    const fileContent = readFileSync(outputPath, 'utf8');
    expect(fileContent).toBe(result.content);
  });

  it('empty sections array produces only header in output', () => {
    const result = exportTaskReport(
      baseInput({
        issueKey: 'CMPI-0',
        issueSummary: 'Empty sections test',
        sections: [],
        impactMarkdown: 'THIS_SHOULD_NOT_APPEAR',
      }),
    );

    expect(result.content).toContain('# Delivery Report: CMPI-0');
    expect(result.content).not.toContain('THIS_SHOULD_NOT_APPEAR');
    expect(result.writtenToFile).toBe(false);
  });
});
