import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { connect, testDeps } from './harness.js';
import { fixtureConfig } from '../helpers/jiraFixtures.js';
import { getServerVersion } from '../../src/version.js';

const V2_TOOLS = [
  'confluence_get_page',
  'confluence_search',
  'delivery_check_changes',
  'delivery_generate',
  'delivery_generate_agent_pack',
  'delivery_project_patterns',
  'delivery_traceability_matrix',
  'jira_get_issue',
  'jira_prepare_work_brief',
  'jira_search_issues',
];

describe('v2 server surface', () => {
  let session: Awaited<ReturnType<typeof connect>>;

  beforeEach(async () => {
    session = await connect();
  });
  afterEach(async () => {
    await session.close();
  });

  it('exposes exactly the ten v2 tools', async () => {
    const { tools } = await session.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(V2_TOOLS);
  });

  it('gives every tool an output schema, annotations and an object-root input schema', async () => {
    const { tools } = await session.client.listTools();
    for (const tool of tools) {
      expect(tool.outputSchema, tool.name).toBeDefined();
      expect(tool.annotations, tool.name).toBeDefined();
      expect(tool.inputSchema.type, tool.name).toBe('object');
      expect(tool.inputSchema, tool.name).not.toHaveProperty('oneOf');
      expect(tool.inputSchema, tool.name).not.toHaveProperty('anyOf');
    }
  });

  it('tells agents the impact check works before any code exists', async () => {
    const { tools } = await session.client.listTools();
    const description = tools.find((t) => t.name === 'delivery_check_changes')?.description ?? '';
    expect(description).toMatch(/impact[^.]*before (any )?cod/i);
  });

  it('tells agents how to enable project pattern memory', async () => {
    const { tools } = await session.client.listTools();
    const description = tools.find((t) => t.name === 'delivery_project_patterns')?.description ?? '';
    expect(description).toContain('DELIVERY_PATTERN_MEMORY_ENABLED');
  });

  it('adds exactly the two write tools when JIRA_ENABLE_WRITES is on', async () => {
    const writer = await connect(testDeps({ config: fixtureConfig({ enableWrites: true }) }));
    const { tools } = await writer.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...V2_TOOLS, 'jira_add_comment', 'jira_update_issue'].sort());
    await writer.close();
  });

  it('offers to post the QA handoff when write tools exist', async () => {
    const r = await session.client.getPrompt({ name: 'jira_qa_handoff_prompt', arguments: { issueKey: 'ABC-1' } });
    expect((r.messages[0].content as { text: string }).text).toContain('jira_add_comment');
  });

  it('keeps the five slash-command prompts', async () => {
    const { prompts } = await session.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual([
      'jira_definition_of_done_prompt',
      'jira_implementation_prompt',
      'jira_pr_review_prompt',
      'jira_qa_handoff_prompt',
      'jira_release_note_prompt',
    ]);
  });

  it('points prompts at v2 tool names', async () => {
    const r = await session.client.getPrompt({ name: 'jira_pr_review_prompt', arguments: { issueKey: 'ABC-1' } });
    const content = r.messages[0].content as { type: string; text: string };
    expect(content.text).toContain('delivery_check_changes');
    expect(content.text).toContain('ABC-1');
  });

  it('exposes the configured-projects resource', async () => {
    const { resources } = await session.client.listResources();
    expect(resources.map((r) => r.uri)).toContain('jira-delivery://config/projects');
  });

  it('reports the package.json version', () => {
    expect(session.client.getServerVersion()?.version).toBe(getServerVersion());
  });
});
