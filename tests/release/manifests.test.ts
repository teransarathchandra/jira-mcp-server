import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getPackageSpec } from '../../src/version.js';

// The npm package, the Claude Code plugin and the MCP Registry entry are
// released together; these checks keep their versions and names in step.

const json = (path: string) => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const pkg = json('package.json');
const plugin = json('plugin/.claude-plugin/plugin.json');
const server = json('server.json');

describe('release manifests', () => {
  it('share one version', () => {
    expect(plugin.version).toBe(pkg.version);
    expect(server.version).toBe(pkg.version);
    expect(server.packages[0].version).toBe(pkg.version);
  });

  it('pin the plugin to its own version, so plugin users get the release they installed', () => {
    expect(plugin.mcpServers['jira-delivery-mcp'].args).toEqual(['-y', `jira-delivery-mcp@${pkg.version}`]);
  });

  it('give the skill a setup command from the same release line', () => {
    const skill = readFileSync(new URL('../../plugin/skills/jira-delivery/SKILL.md', import.meta.url), 'utf8');
    const specs = [...skill.matchAll(/npx(?: -y)?\s+(jira-delivery-mcp[@\w.-]*)/g)].map((m) => m[1]);
    expect(specs.length).toBeGreaterThan(0);
    expect(new Set(specs)).toEqual(new Set([getPackageSpec(pkg.version)]));
  });

  it('name the registry entry and the npm package consistently', () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.name).toMatch(/^io\.github\.teransarathchandra\//);
    expect(server.packages[0]).toMatchObject({ registryType: 'npm', identifier: pkg.name, transport: { type: 'stdio' } });
  });

  it('keep the registry description within its 100-character limit', () => {
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it('declare every environment variable the plugin passes, with the token marked secret', () => {
    const declared = new Map<string, { isSecret?: boolean; isRequired?: boolean }>(
      server.packages[0].environmentVariables.map((v: { name: string }) => [v.name, v]),
    );
    for (const name of Object.keys(plugin.mcpServers['jira-delivery-mcp'].env)) expect(declared.has(name), name).toBe(true);
    expect(declared.get('JIRA_API_TOKEN')).toMatchObject({ isSecret: true, isRequired: true });
  });
});
