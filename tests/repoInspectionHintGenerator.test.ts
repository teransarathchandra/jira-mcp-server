import { describe, it, expect } from 'vitest';
import {
  generateRepoInspectionHints,
  formatRepoInspectionSection,
} from '../src/utils/repoInspectionHintGenerator.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const DEFAULT_PARAMS = {
  technicalSignals: [],
  components: [],
  labels: [],
  userRoles: [],
  linkedIssueSummaries: [],
  mainDescription: '',
  summary: '',
};

// ── generateRepoInspectionHints ───────────────────────────────────────────────

describe('generateRepoInspectionHints – file hints', () => {
  it('file signal (filename with extension) → file hint generated', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['AuthController.ts'],
    });

    const fileHints = result.hints.filter((h) => h.category === 'file');
    expect(fileHints.length).toBeGreaterThanOrEqual(1);
    expect(fileHints[0].instruction).toContain('AuthController.ts');
  });

  it('multiple file signals → multiple file hints', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['LoginForm.tsx', 'authService.ts'],
    });

    const fileHints = result.hints.filter((h) => h.category === 'file');
    expect(fileHints.length).toBeGreaterThanOrEqual(2);
  });

  it('file hint instruction says "Look for existing file"', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['userModel.js'],
    });

    const fileHints = result.hints.filter((h) => h.category === 'file');
    expect(fileHints.length).toBeGreaterThanOrEqual(1);
    expect(fileHints[0].instruction).toMatch(/Look for existing file/i);
  });

  it('hasSpecificHints = true when file hints are present', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['auth.ts'],
    });

    expect(result.hasSpecificHints).toBe(true);
  });
});

describe('generateRepoInspectionHints – API hints', () => {
  it('API path signal → API hint generated', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['/api/auth/login'],
    });

    const apiHints = result.hints.filter((h) => h.category === 'api');
    expect(apiHints.length).toBeGreaterThanOrEqual(1);
    expect(apiHints[0].instruction).toContain('/api/auth/login');
  });

  it('REST API path signal → API hint generated', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['/rest/v2/users'],
    });

    const apiHints = result.hints.filter((h) => h.category === 'api');
    expect(apiHints.length).toBeGreaterThanOrEqual(1);
  });

  it('API hint instruction says "Find the API route/controller for"', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['/api/products'],
    });

    const apiHints = result.hints.filter((h) => h.category === 'api');
    expect(apiHints.length).toBeGreaterThanOrEqual(1);
    expect(apiHints[0].instruction).toMatch(/Find the API route\/controller for/i);
  });
});

describe('generateRepoInspectionHints – component hints', () => {
  it('Jira components → component hints generated', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      components: ['Authentication', 'UserManagement'],
    });

    const componentHints = result.hints.filter((h) => h.category === 'component');
    expect(componentHints.length).toBeGreaterThanOrEqual(2);
  });

  it('component hint instruction says "Search for existing ... component or module"', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      components: ['PaymentGateway'],
    });

    const componentHints = result.hints.filter((h) => h.category === 'component');
    expect(componentHints.length).toBeGreaterThanOrEqual(1);
    expect(componentHints[0].instruction).toContain('PaymentGateway');
    expect(componentHints[0].instruction).toMatch(/Search for existing/i);
  });

  it('PascalCase signal → component hint generated', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['UserAuthService'],  // PascalCase, not a filename or API
    });

    const componentHints = result.hints.filter((h) => h.category === 'component');
    expect(componentHints.length).toBeGreaterThanOrEqual(1);
    expect(componentHints[0].instruction).toContain('UserAuthService');
  });
});

describe('generateRepoInspectionHints – validation hints', () => {
  it('validation keyword in description → validation hint generated', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      mainDescription: 'The form should use the existing validator for required fields.',
    });

    const validationHints = result.hints.filter((h) => h.category === 'validation');
    expect(validationHints.length).toBeGreaterThanOrEqual(1);
    expect(validationHints[0].instruction).toMatch(/validation utilities/i);
  });

  it('"validate" keyword in description → validation hint', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      mainDescription: 'We need to validate the user input before saving.',
    });

    const validationHints = result.hints.filter((h) => h.category === 'validation');
    expect(validationHints.length).toBeGreaterThanOrEqual(1);
  });

  it('no validation keyword → no validation hint', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      mainDescription: 'Build a simple form to collect user data.',
    });

    const validationHints = result.hints.filter((h) => h.category === 'validation');
    expect(validationHints.length).toBe(0);
  });
});

describe('generateRepoInspectionHints – general hints always included', () => {
  it('always includes at least 2 general hints', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
    });

    const generalHints = result.hints.filter((h) => h.category === 'general');
    expect(generalHints.length).toBeGreaterThanOrEqual(2);
  });

  it('general hints present even with no signals', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
    });

    expect(result.hints.length).toBeGreaterThanOrEqual(2);
    const generalHints = result.hints.filter((h) => h.category === 'general');
    expect(generalHints.length).toBeGreaterThanOrEqual(1);
  });

  it('general hint mentions project structure', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
    });

    const structureHint = result.hints.find((h) =>
      h.instruction.toLowerCase().includes('project structure'),
    );
    expect(structureHint).toBeDefined();
  });
});

describe('generateRepoInspectionHints – max 10 hints', () => {
  it('many signals → max 10 hints returned', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: [
        'auth.ts',
        'user.ts',
        'admin.ts',
        '/api/auth',
        '/api/users',
        '/rest/admin',
        'UserService',
        'AdminController',
      ],
      components: ['Authentication', 'UserManagement', 'Reporting'],
      mainDescription: 'We need to validate all required fields.',
      linkedIssueSummaries: ['Fix login bug', 'Update user profile'],
    });

    expect(result.hints.length).toBeLessThanOrEqual(10);
  });
});

// ── formatRepoInspectionSection ───────────────────────────────────────────────

describe('formatRepoInspectionSection', () => {
  it('section contains "Before making changes, Claude Code should:"', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['auth.ts'],
    });

    const formatted = formatRepoInspectionSection(result);
    expect(formatted).toContain('Before making changes, Claude Code should:');
  });

  it('section contains ## Suggested Repo Inspection Targets heading', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
    });

    const formatted = formatRepoInspectionSection(result);
    expect(formatted).toContain('## Suggested Repo Inspection Targets');
  });

  it('all hints appear in formatted output', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      components: ['PaymentModule'],
    });

    const formatted = formatRepoInspectionSection(result);
    for (const hint of result.hints) {
      expect(formatted).toContain(hint.instruction);
    }
  });

  it('each hint formatted as "- <instruction>" bullet', () => {
    const result = generateRepoInspectionHints({
      ...DEFAULT_PARAMS,
      technicalSignals: ['report.py'],
    });

    const formatted = formatRepoInspectionSection(result);
    const lines = formatted.split('\n');
    const bulletLines = lines.filter((l) => l.startsWith('- '));
    expect(bulletLines.length).toBeGreaterThanOrEqual(1);
  });
});
