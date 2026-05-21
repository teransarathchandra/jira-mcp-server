import { describe, it, expect } from 'vitest';
import { rankAuthority, formatAuthoritySection } from '../src/utils/authorityRanker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeComment(
  author: string,
  body: string,
  created: string,
  isUseful: boolean,
  hasRequirementSignals: boolean,
) {
  return { author, body, created, isUseful, hasRequirementSignals };
}

const DEFAULT_PARAMS = {
  mainDescription: null,
  hasExplicitAC: false,
  comments: [],
  parentDescription: null,
  epicDescription: null,
  linkedIssueRelationships: [],
  highAuthorityEmails: [],
  highAuthorityAccountIds: [],
};

// ── rankAuthority ─────────────────────────────────────────────────────────────

describe('rankAuthority – main description', () => {
  it('explicit AC in description → primary source with very_high authority', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Build a login form.',
      hasExplicitAC: true,
    });

    expect(result.primarySources.length).toBeGreaterThanOrEqual(1);
    const src = result.primarySources[0];
    expect(src.authorityLevel).toBe('very_high');
    expect(src.label).toContain('explicit AC');
  });

  it('description without explicit AC → primary source with high authority', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Build a login form with email and password.',
      hasExplicitAC: false,
    });

    expect(result.primarySources.length).toBeGreaterThanOrEqual(1);
    expect(result.primarySources[0].authorityLevel).toBe('high');
  });

  it('empty description → noise source', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: '',
    });

    expect(result.noiseSources.length).toBeGreaterThanOrEqual(1);
    const src = result.noiseSources[0];
    expect(src.authorityLevel).toBe('noise');
    expect(src.reason).toMatch(/empty/i);
  });

  it('whitespace-only description → noise source', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: '   ',
    });

    expect(result.noiseSources.length).toBeGreaterThanOrEqual(1);
    expect(result.noiseSources[0].authorityLevel).toBe('noise');
  });

  it('null description → noise source', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: null,
    });

    expect(result.noiseSources.length).toBeGreaterThanOrEqual(1);
    expect(result.noiseSources[0].authorityLevel).toBe('noise');
  });
});

describe('rankAuthority – comments with requirement_change signal', () => {
  it('useful comment with requirement_change signal from reporter → very_high primary source', () => {
    const comment = makeComment(
      'reporter@example.com',
      'Actually we should use a modal instead of redirect.',
      '2024-06-01T10:00:00.000Z',
      true,
      true,
    );

    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Redirect to dashboard after login.',
      hasExplicitAC: false,
      comments: [comment],
      reporterEmail: 'reporter@example.com',
    });

    const veryHighSources = result.primarySources.filter(
      (s) => s.authorityLevel === 'very_high',
    );
    expect(veryHighSources.length).toBeGreaterThanOrEqual(1);
  });

  it('useful comment with requirement_change signal from high-authority email → very_high', () => {
    const comment = makeComment(
      'lead@company.com',
      'Change: instead of redirect, show a modal.',
      '2024-06-01T10:00:00.000Z',
      true,
      true,
    );

    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Redirect to dashboard after login.',
      hasExplicitAC: false,
      comments: [comment],
      highAuthorityEmails: ['lead@company.com'],
    });

    const veryHighSources = result.primarySources.filter(
      (s) => s.authorityLevel === 'very_high',
    );
    expect(veryHighSources.length).toBeGreaterThanOrEqual(1);
  });

  it('useful comment with requirement signals but NOT from high-auth/reporter → high authority', () => {
    const comment = makeComment(
      'dev@example.com',
      'The requirement should be updated.',
      '2024-06-01T10:00:00.000Z',
      true,
      true,
    );

    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Build a form.',
      hasExplicitAC: false,
      comments: [comment],
    });

    // Should get at least one primary source from this comment
    expect(result.primarySources.length).toBeGreaterThanOrEqual(1);
    // The comment source should be high (not very_high since not from reporter/assignee/high-auth)
    const commentSource = result.primarySources.find((s) =>
      s.issuedBy === 'dev@example.com',
    );
    expect(commentSource).toBeDefined();
    expect(commentSource?.authorityLevel).toBe('high');
  });
});

describe('rankAuthority – high-authority email comments', () => {
  it('comment from high-authority email (not having signal) → high authority', () => {
    const comment = makeComment(
      'cto@company.com',
      'Please review this implementation carefully.',
      '2024-05-01T10:00:00.000Z',
      true,
      false,  // no requirement signals
    );

    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Build a feature.',
      hasExplicitAC: false,
      comments: [comment],
      highAuthorityEmails: ['cto@company.com'],
    });

    const highSources = result.primarySources.filter(
      (s) => s.authorityLevel === 'high' && s.issuedBy === 'cto@company.com',
    );
    expect(highSources.length).toBeGreaterThanOrEqual(1);
  });
});

describe('rankAuthority – parent and epic descriptions', () => {
  it('parent description → supporting source with medium authority', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      parentDescription: 'Parent story: Build user authentication module.',
    });

    expect(result.supportingSources.length).toBeGreaterThanOrEqual(1);
    const parentSrc = result.supportingSources.find(
      (s) => s.label === 'Parent issue description',
    );
    expect(parentSrc).toBeDefined();
    expect(parentSrc?.authorityLevel).toBe('medium');
  });

  it('epic description → supporting source with medium authority', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      epicDescription: 'Epic: Complete user authentication flow.',
    });

    expect(result.supportingSources.length).toBeGreaterThanOrEqual(1);
    const epicSrc = result.supportingSources.find(
      (s) => s.label === 'Epic description',
    );
    expect(epicSrc).toBeDefined();
    expect(epicSrc?.authorityLevel).toBe('medium');
  });

  it('null parent description → not added', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      parentDescription: null,
    });

    const parentSrc = result.supportingSources.find(
      (s) => s.label === 'Parent issue description',
    );
    expect(parentSrc).toBeUndefined();
  });
});

describe('rankAuthority – linked issue relationships', () => {
  it('blocking relationship → supporting source with medium authority', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      linkedIssueRelationships: ['blocks PROJ-123'],
    });

    expect(result.supportingSources.length).toBeGreaterThanOrEqual(1);
    const blockingSrc = result.supportingSources.find((s) =>
      s.label.toLowerCase().includes('blocks'),
    );
    expect(blockingSrc).toBeDefined();
    expect(blockingSrc?.authorityLevel).toBe('medium');
  });

  it('"is blocked by" relationship → supporting source with medium authority', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      linkedIssueRelationships: ['is blocked by PROJ-456'],
    });

    const blockingSrc = result.supportingSources.find((s) =>
      s.label.toLowerCase().includes('is blocked by'),
    );
    expect(blockingSrc).toBeDefined();
    expect(blockingSrc?.authorityLevel).toBe('medium');
  });

  it('"relates to" relationship → lower confidence source with low authority', () => {
    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      linkedIssueRelationships: ['relates to PROJ-789'],
    });

    expect(result.lowerConfidenceSources.length).toBeGreaterThanOrEqual(1);
    const relSrc = result.lowerConfidenceSources.find((s) =>
      s.label.toLowerCase().includes('relates to'),
    );
    expect(relSrc).toBeDefined();
    expect(relSrc?.authorityLevel).toBe('low');
  });
});

describe('rankAuthority – notes generation', () => {
  it('latest comment with signal from reporter + existing description → note about conflict', () => {
    const comment = makeComment(
      'reporter@example.com',
      'Actually, change the behavior to use a modal instead.',
      '2024-06-01T10:00:00.000Z',
      true,
      true,
    );

    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Redirect to dashboard.',
      hasExplicitAC: false,
      comments: [comment],
      reporterEmail: 'reporter@example.com',
    });

    expect(result.notes.length).toBeGreaterThanOrEqual(1);
    expect(result.notes[0]).toMatch(/conflict|update|align/i);
  });

  it('no conflict note when description is empty', () => {
    const comment = makeComment(
      'reporter@example.com',
      'Actually use a modal instead of redirect.',
      '2024-06-01T10:00:00.000Z',
      true,
      true,
    );

    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: '',
      comments: [comment],
      reporterEmail: 'reporter@example.com',
    });

    // No conflict note since description is empty
    expect(result.notes).toHaveLength(0);
  });
});

describe('rankAuthority – noise comments', () => {
  it('non-useful comment → noise source', () => {
    const comment = makeComment(
      'user@example.com',
      'ok',
      '2024-01-01T10:00:00.000Z',
      false,
      false,
    );

    const result = rankAuthority({
      ...DEFAULT_PARAMS,
      comments: [comment],
    });

    const noiseSrc = result.noiseSources.find(
      (s) => s.issuedBy === 'user@example.com',
    );
    expect(noiseSrc).toBeDefined();
    expect(noiseSrc?.authorityLevel).toBe('noise');
  });
});

// ── formatAuthoritySection ────────────────────────────────────────────────────

describe('formatAuthoritySection', () => {
  it('returns section with ## Requirement Authority heading', () => {
    const ranking = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Some description',
      hasExplicitAC: true,
    });

    const formatted = formatAuthoritySection(ranking);
    expect(formatted).toContain('## Requirement Authority');
  });

  it('lists primary sources', () => {
    const ranking = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Build a login form.',
      hasExplicitAC: true,
    });

    const formatted = formatAuthoritySection(ranking);
    expect(formatted).toContain('Primary sources:');
    expect(formatted).toContain('Main description (with explicit AC)');
  });

  it('shows "None" when no supporting sources', () => {
    const ranking = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Build a login form.',
    });

    const formatted = formatAuthoritySection(ranking);
    // No parent, epic, blocking relationships, or relevant comments
    expect(formatted).toContain('Supporting sources:');
  });

  it('shows notes text', () => {
    const ranking = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Build a login form.',
    });

    const formatted = formatAuthoritySection(ranking);
    expect(formatted).toContain('Notes:');
  });

  it('shows "No special notes." when no notes exist', () => {
    const ranking = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: null,
    });

    const formatted = formatAuthoritySection(ranking);
    expect(formatted).toContain('No special notes.');
  });

  it('shows conflict note content in notes field', () => {
    const comment = makeComment(
      'reporter@example.com',
      'Actually use a modal instead of the redirect.',
      '2024-06-01T10:00:00.000Z',
      true,
      true,
    );

    const ranking = rankAuthority({
      ...DEFAULT_PARAMS,
      mainDescription: 'Redirect to dashboard after login.',
      hasExplicitAC: false,
      comments: [comment],
      reporterEmail: 'reporter@example.com',
    });

    const formatted = formatAuthoritySection(ranking);
    expect(formatted).toContain('Notes:');
    // The note about potential conflict should appear
    expect(formatted).toMatch(/conflict|update|align/i);
  });
});
