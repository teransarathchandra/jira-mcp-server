import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { installJiraFixture, fixtureClient, fixtureConfig } from '../helpers/jiraFixtures.js';
import { fetchIssueContext } from '../../src/jira/issueContextService.js';
import { buildWorkBriefData } from '../../src/delivery/workBriefGuidance.js';
import { WorkBriefDataSchema, type WorkBriefData } from '../../src/delivery/workBriefTypes.js';
import { generateClarificationQuestions } from '../../src/utils/clarificationQuestionGenerator.js';
import { CONTEXT_FETCH_DEFAULTS } from '../../src/server/tools/jiraIssueInputs.js';
import type { Config } from '../../src/config.js';

const AC_FIELD = fixtureConfig({ acceptanceCriteriaFieldId: 'customfield_10050' });
let fixture: ReturnType<typeof installJiraFixture> | undefined;

async function briefFor(name: string, config: Config = fixtureConfig()): Promise<WorkBriefData> {
  fixture?.restore();
  fixture = installJiraFixture(name);
  const context = await fetchIssueContext('ABC-1', { ...CONTEXT_FETCH_DEFAULTS }, fixtureClient(config), config);
  return buildWorkBriefData(context, config);
}

const actionIds = (d: WorkBriefData) => d.recommendedActions.map((a) => a.id);
const questionIds = (d: WorkBriefData) => d.clarifyingQuestions.map((q) => q.id);

beforeEach(() => {
  process.env.MCP_CACHE_ENABLED = 'false';
});
afterEach(() => {
  fixture?.restore();
  fixture = undefined;
});

describe('buildWorkBriefData()', () => {
  it('reads a ready story: criteria from the description, branch, no questions', async () => {
    const data = await briefFor('ready-story');
    expect(['READY', 'MOSTLY_READY']).toContain(data.readiness.status);
    expect(data.acceptanceCriteria).toEqual([
      { text: 'Lock the account for 15 minutes after 5 failed login attempts', source: 'description' },
      { text: 'Show a lockout message with the remaining lock time', source: 'description' },
    ]);
    expect(actionIds(data)).toEqual(['create-branch', 'implement-and-verify']);
    expect(data.clarifyingQuestions).toEqual([]);
    expect(data.branchName).toBe('feature/ABC-1-add-login-rate-limiting');
    expect(data.issue).toEqual({
      key: 'ABC-1',
      summary: 'Add login rate limiting',
      type: 'Story',
      status: 'To Do',
      statusCategory: 'new',
      priority: 'Medium',
      assignee: null,
    });
    expect(data.evidence.confluence).toBe('not_requested');
  });

  it('prefers the configured acceptance-criteria field', async () => {
    const data = await briefFor('ac-field', AC_FIELD);
    expect(data.acceptanceCriteria).toHaveLength(3);
    expect(data.acceptanceCriteria.every((c) => c.source === 'field')).toBe(true);
  });

  it('falls back to the description when the configured field is empty, without losing confidence', async () => {
    const data = await briefFor('ac-field-empty', AC_FIELD);
    expect(data.evidence.acceptanceCriteriaField).toBe('observed_empty');
    expect(data.acceptanceCriteria.map((c) => c.source)).toEqual(['description', 'description']);
    expect(data.readiness.confidence).toBe('high');
  });

  it('asks for acceptance criteria on an empty ticket', async () => {
    const data = await briefFor('no-ac');
    expect(data.readiness.status).toBe('NEEDS_CLARIFICATION');
    expect(actionIds(data)[0]).toBe('add-acceptance-criteria');
    expect(questionIds(data)).toContain('q-acceptance-criteria');
    expect(() => WorkBriefDataSchema.parse(data)).not.toThrow();
  });

  it('is BLOCKED by an open inbound blocker, which becomes the top action', async () => {
    const data = await briefFor('inbound-blocker-open');
    expect(data.readiness.status).toBe('BLOCKED');
    expect(data.recommendedActions[0]).toMatchObject({ id: 'resolve-blocker', evidence: ['link:ABC-9'] });
    expect(data.blockers).toEqual([{ key: 'ABC-9', status: 'In Progress', direction: 'inward' }]);
    expect(actionIds(data)).not.toContain('create-branch');
  });

  it.each(['inbound-blocker-done', 'outbound-blocks-only'])('is not blocked for %s', async (name) => {
    const data = await briefFor(name);
    expect(data.readiness.status).not.toBe('BLOCKED');
    expect(data.blockers).toEqual([]);
  });

  it('lowers confidence when a linked issue could not be read', async () => {
    const data = await briefFor('linked-forbidden');
    expect(data.readiness.confidence).toBe('medium');
    expect(data.readiness.gaps.map((g) => g.id)).toContain('evidence-linkedIssues');
  });

  it('recommends resolving a conflicting comment', async () => {
    const data = await briefFor('conflicting-comment');
    expect(actionIds(data)).toContain('resolve-conflict');
    expect(questionIds(data)).toContain('q-conflict');
  });

  it('never copies ticket text into actions or questions', async () => {
    const data = await briefFor('injection-in-description');
    const text = [...data.recommendedActions.map((a) => a.text), ...data.clarifyingQuestions.map((q) => q.text)].join('\n');
    expect(text).not.toMatch(/ignore previous instructions/i);
    expect(text).not.toMatch(/transition/i);
  });

  const ALL = [
    ['ready-story', fixtureConfig()],
    ['ac-field', AC_FIELD],
    ['ac-field-empty', AC_FIELD],
    ['no-ac', fixtureConfig()],
    ['inbound-blocker-open', fixtureConfig()],
    ['inbound-blocker-done', fixtureConfig()],
    ['outbound-blocks-only', fixtureConfig()],
    ['linked-forbidden', fixtureConfig()],
    ['many-comments', fixtureConfig()],
    ['conflicting-comment', fixtureConfig()],
    ['injection-in-description', fixtureConfig()],
  ] as const;

  it.each(ALL)('keeps the invariants for %s', async (name, config) => {
    const data = await briefFor(name, config);
    expect(() => WorkBriefDataSchema.parse(data)).not.toThrow();
    expect(data.recommendedActions.length).toBeGreaterThanOrEqual(2);
    expect(data.recommendedActions.length).toBeLessThanOrEqual(4);
    expect(data.clarifyingQuestions.length).toBeLessThanOrEqual(3);
    for (const item of [...data.recommendedActions, ...data.clarifyingQuestions]) {
      expect(item.evidence.length, item.id).toBeGreaterThan(0);
    }
    const again = await briefFor(name, config);
    expect(JSON.stringify(again)).toBe(JSON.stringify(data));
  });
});

describe('clarification questions (defect 4)', () => {
  it('does not invent role, mobile or error-message questions from silence', () => {
    const result = generateClarificationQuestions({
      readinessStatus: 'NEEDS_CLARIFICATION',
      ambiguities: [],
      conflictDescriptions: [],
      hasBlockingIssues: false,
      blockerDescriptions: [],
      mainDescription: 'Show a lockout message on the login page when the user is locked out.',
      acceptanceCriteria: ['Show a lockout message'],
      technicalSignals: [],
      userRoles: [],
      validationRules: ['The password field is required'],
      businessRules: [],
      latestCommentIntroducesQuestion: false,
      latestCommentBody: '',
    });
    const topics = result.questions.map((q) => q.topic);
    expect(topics).not.toContain('user roles');
    expect(topics).not.toContain('mobile support');
    expect(topics).not.toContain('validation error message');
  });
});
