import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { connect, testDeps, type ConnectOptions } from './harness.js';
import { installJiraFixture, fixtureClient, fixtureConfig } from '../helpers/jiraFixtures.js';
import type { WorkBriefData } from '../../src/delivery/workBriefTypes.js';

type Question = WorkBriefData['clarifyingQuestions'][number] & { answer?: string };

describe('jira_prepare_work_brief elicitation', () => {
  let fixture: ReturnType<typeof installJiraFixture>;
  let session: Awaited<ReturnType<typeof connect>> | undefined;

  async function brief(args: Record<string, unknown>, options: ConnectOptions = {}): Promise<Question[]> {
    const config = fixtureConfig();
    session = await connect(testDeps({ config, jiraClient: fixtureClient(config) }), options);
    const result = await session.client.callTool({ name: 'jira_prepare_work_brief', arguments: { issueKey: 'ABC-1', ...args } });
    expect(result.isError).toBeFalsy();
    return (result.structuredContent as { data: { clarifyingQuestions: Question[] } }).data.clarifyingQuestions;
  }

  beforeEach(() => {
    process.env.MCP_CACHE_ENABLED = 'false';
    fixture = installJiraFixture('no-ac'); // produces q-acceptance-criteria
  });
  afterEach(async () => {
    await session?.close();
    fixture.restore();
    session = undefined;
  });

  it('adds accepted answers to the matching question', async () => {
    const onElicit = vi.fn(async () => ({ action: 'accept', content: { q0: 'yes' } }));
    const questions = await brief({ allowElicitation: true }, { onElicit });
    expect(onElicit).toHaveBeenCalledOnce();
    expect(questions[0].answer).toBe('yes');
  });

  it('returns the questions unanswered when the user declines', async () => {
    const questions = await brief({ allowElicitation: true }, { onElicit: async () => ({ action: 'decline' }) });
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((q) => q.answer === undefined)).toBe(true);
  });

  it('never asks unless allowElicitation is true', async () => {
    const onElicit = vi.fn(async () => ({ action: 'accept', content: { q0: 'yes' } }));
    await brief({}, { onElicit });
    expect(onElicit).not.toHaveBeenCalled();
  });

  it('does not ask a client without elicitation support', async () => {
    const questions = await brief({ allowElicitation: true });
    expect(questions.every((q) => q.answer === undefined)).toBe(true);
  });

  it('drops answers with control characters', async () => {
    const questions = await brief({ allowElicitation: true }, { onElicit: async () => ({ action: 'accept', content: { q0: 'ye\u0007s' } }) });
    expect(questions[0].answer).toBeUndefined();
  });
});
