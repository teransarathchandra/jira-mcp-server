import { describe, it, expect } from 'vitest';
import { extractRequirements, extractAmbiguities } from '../src/utils/requirementExtractor.js';

// ── Acceptance Criteria ───────────────────────────────────────────────────────

describe('extractRequirements – acceptanceCriteria', () => {
  it('extracts AC lines from "## Acceptance Criteria" heading', () => {
    const text = `## Acceptance Criteria
User can log in with valid credentials.
User sees an error for invalid credentials.`;
    const result = extractRequirements(text);
    expect(result.acceptanceCriteria).toContain('User can log in with valid credentials.');
    expect(result.acceptanceCriteria).toContain('User sees an error for invalid credentials.');
  });

  it('extracts AC from "AC:" heading with items on subsequent lines', () => {
    // "AC:" acts as a section heading — content is collected from following lines,
    // not from the same line (the heading line is consumed by `continue`).
    const text = `AC:\nUser must be able to reset their password.\nUser must see a success message.`;
    const result = extractRequirements(text);
    expect(result.acceptanceCriteria).toContain('User must be able to reset their password.');
    expect(result.acceptanceCriteria).toContain('User must see a success message.');
  });

  it('extracts unchecked checklist items "- [ ]"', () => {
    const text = `- [ ] User can upload a profile picture
- [ ] Upload is limited to 5 MB`;
    const result = extractRequirements(text);
    expect(result.acceptanceCriteria.some(ac => ac.includes('profile picture'))).toBe(true);
    expect(result.acceptanceCriteria.some(ac => ac.includes('5 MB'))).toBe(true);
  });

  it('extracts checked checklist items "- [x]"', () => {
    const text = `- [x] Login page is implemented`;
    const result = extractRequirements(text);
    expect(result.acceptanceCriteria.some(ac => ac.includes('Login page is implemented'))).toBe(true);
  });

  it('stops collecting AC items at the next markdown heading', () => {
    const text = `## Acceptance Criteria
Only this line is AC.
## Technical Notes
This should NOT be in AC.`;
    const result = extractRequirements(text);
    expect(result.acceptanceCriteria).toContain('Only this line is AC.');
    expect(result.acceptanceCriteria).not.toContain('This should NOT be in AC.');
  });

  it('returns empty array when no AC is present', () => {
    const text = 'This is a plain description with no acceptance criteria.';
    const result = extractRequirements(text);
    expect(result.acceptanceCriteria).toHaveLength(0);
  });
});

// ── Technical Signals ─────────────────────────────────────────────────────────

describe('extractRequirements – technicalSignals', () => {
  it('extracts TypeScript file names (.ts, .tsx)', () => {
    const text = 'Update the logic in userService.ts and UserForm.tsx.';
    const result = extractRequirements(text);
    expect(result.technicalSignals.some(s => s.includes('userService.ts'))).toBe(true);
    expect(result.technicalSignals.some(s => s.includes('UserForm.tsx'))).toBe(true);
  });

  it('extracts API paths starting with /api/', () => {
    const text = 'Call the endpoint at /api/users/profile to fetch data.';
    const result = extractRequirements(text);
    expect(result.technicalSignals.some(s => s.startsWith('/api/'))).toBe(true);
  });

  it('extracts full URLs', () => {
    const text = 'See the docs at https://example.com/api/reference for details.';
    const result = extractRequirements(text);
    expect(result.technicalSignals.some(s => s.startsWith('https://'))).toBe(true);
  });

  it('returns empty technicalSignals for plain text without any patterns', () => {
    const text = 'Just a simple sentence with no technical references at all.';
    const result = extractRequirements(text);
    expect(result.technicalSignals).toHaveLength(0);
  });
});

// ── Business Rules ─────────────────────────────────────────────────────────────

describe('extractRequirements – businessRules', () => {
  it('extracts lines containing "must"', () => {
    const text = 'Users must verify their email before accessing the dashboard.';
    const result = extractRequirements(text);
    expect(result.businessRules.some(r => r.includes('must'))).toBe(true);
  });

  it('extracts lines containing "should"', () => {
    const text = 'The system should send a confirmation email after registration.';
    const result = extractRequirements(text);
    expect(result.businessRules.some(r => r.includes('should'))).toBe(true);
  });

  it('extracts lines containing "only"', () => {
    const text = 'Only admins can delete records.';
    const result = extractRequirements(text);
    expect(result.businessRules.some(r => r.includes('only') || r.includes('Only'))).toBe(true);
  });

  it('returns empty businessRules for text with no rule keywords', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const result = extractRequirements(text);
    expect(result.businessRules).toHaveLength(0);
  });
});

// ── User Roles ────────────────────────────────────────────────────────────────

describe('extractRequirements – userRoles', () => {
  it('extracts "admin" role', () => {
    const text = 'Only an admin can access this page.';
    const result = extractRequirements(text);
    expect(result.userRoles).toContain('admin');
  });

  it('extracts "user" role', () => {
    const text = 'A user can view their profile.';
    const result = extractRequirements(text);
    expect(result.userRoles).toContain('user');
  });

  it('extracts "manager" role', () => {
    const text = 'The manager approves the expense reports.';
    const result = extractRequirements(text);
    expect(result.userRoles).toContain('manager');
  });

  it('returns empty userRoles when no role keywords are present', () => {
    const text = 'The button is blue and sits in the header.';
    const result = extractRequirements(text);
    expect(result.userRoles).toHaveLength(0);
  });
});

// ── Validation Rules ──────────────────────────────────────────────────────────

describe('extractRequirements – validationRules', () => {
  it('extracts lines containing "required"', () => {
    const text = 'Email is a required field.';
    const result = extractRequirements(text);
    expect(result.validationRules.some(r => r.includes('required'))).toBe(true);
  });

  it('extracts lines containing "minimum"', () => {
    const text = 'Password must have a minimum of 8 characters.';
    const result = extractRequirements(text);
    expect(result.validationRules.some(r => r.includes('minimum') || r.includes('min'))).toBe(true);
  });

  it('extracts lines containing "valid"', () => {
    const text = 'Phone number must be in a valid format.';
    const result = extractRequirements(text);
    expect(result.validationRules.some(r => r.toLowerCase().includes('valid'))).toBe(true);
  });

  it('returns empty validationRules for text with no validation keywords', () => {
    const text = 'The quick brown fox jumps over the lazy dog.';
    const result = extractRequirements(text);
    expect(result.validationRules).toHaveLength(0);
  });
});

// ── Ambiguities ───────────────────────────────────────────────────────────────

describe('extractRequirements – ambiguities', () => {
  it('detects "TBD" marker', () => {
    const text = 'The deadline is TBD.';
    const result = extractRequirements(text);
    expect(result.ambiguities.some(a => a.includes('TBD'))).toBe(true);
  });

  it('detects "TODO" marker (case-insensitive)', () => {
    const text = 'TODO: define the error message format.';
    const result = extractRequirements(text);
    expect(result.ambiguities.some(a => a.toLowerCase().includes('todo'))).toBe(true);
  });

  it('detects "unclear" marker', () => {
    const text = 'The requirements for this feature are unclear.';
    const result = extractRequirements(text);
    expect(result.ambiguities.some(a => a.includes('unclear'))).toBe(true);
  });

  it('returns empty ambiguities for clear, definitive text', () => {
    const text = 'The button label is "Submit". The form has three fields: name, email, password.';
    const result = extractRequirements(text);
    expect(result.ambiguities).toHaveLength(0);
  });
});

// ── extractAmbiguities standalone ─────────────────────────────────────────────

describe('extractAmbiguities (standalone)', () => {
  it('returns the same results as extractRequirements().ambiguities', () => {
    const text = 'The scope is TBD.\nThis line is unclear.\nEverything else is fine.';
    const fromFull = extractRequirements(text).ambiguities;
    const fromStandalone = extractAmbiguities(text);
    expect(fromStandalone).toEqual(fromFull);
  });

  it('detects "TBC" marker', () => {
    const text = 'The release date is TBC.';
    expect(extractAmbiguities(text).some(a => a.includes('TBC'))).toBe(true);
  });

  it('detects "not sure" marker', () => {
    const text = 'I am not sure what the correct behavior should be here.';
    expect(extractAmbiguities(text).some(a => a.includes('not sure'))).toBe(true);
  });

  it('returns empty array for unambiguous text', () => {
    expect(extractAmbiguities('Clear and complete specification.')).toHaveLength(0);
  });
});

// ── Clean text returns all empty arrays ───────────────────────────────────────

describe('extractRequirements – clean text', () => {
  it('returns all empty arrays for a clean sentence with no signals', () => {
    const text = 'The component renders a list of items in alphabetical order.';
    const result = extractRequirements(text);
    expect(result.acceptanceCriteria).toHaveLength(0);
    expect(result.technicalSignals).toHaveLength(0);
    expect(result.businessRules).toHaveLength(0);
    expect(result.userRoles).toHaveLength(0);
    expect(result.validationRules).toHaveLength(0);
    expect(result.ambiguities).toHaveLength(0);
  });
});
