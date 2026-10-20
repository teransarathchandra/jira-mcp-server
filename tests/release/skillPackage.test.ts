import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packSkill, parseFrontmatter, validateSkill, SKILL_DIR } from '../../scripts/pack-skill.mjs';
import { getPackageSpec } from '../../src/version.js';

// The jira-delivery skill ships in the Claude Code plugin and, zipped, as a
// standalone Agent Skill (Agensi and any agent that reads SKILL.md folders).

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const read = (rel: string) => readFileSync(join(SKILL_DIR, rel), 'utf8');
const markdownFiles = (dir = SKILL_DIR, prefix = ''): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? markdownFiles(join(dir, e.name), `${prefix}${e.name}/`) : e.name.endsWith('.md') ? [`${prefix}${e.name}`] : [],
  );

describe('jira-delivery skill', () => {
  const skill = read('SKILL.md');
  const meta = parseFrontmatter(skill);

  it('passes the Agent Skills checks', () => {
    expect(validateSkill(SKILL_DIR)).toEqual([]);
  });

  it('has a name matching its folder and a description within 1024 characters', () => {
    expect(meta.name).toBe('jira-delivery');
    expect(String(meta.description).length).toBeGreaterThan(50);
    expect(String(meta.description).length).toBeLessThanOrEqual(1024);
    expect(meta.license).toBe('MIT');
    expect(String(meta.compatibility)).toContain('jira-delivery-mcp');
  });

  it('links only to files that exist in the skill folder', () => {
    const links = [...skill.matchAll(/\]\((?!https?:)([^)#\s]+)/g)].map((m) => m[1]);
    expect(links).toContain('references/setup.md');
    for (const link of links) expect(existsSync(join(SKILL_DIR, link)), link).toBe(true);
  });

  it('discloses where it connects and that writes are off by default', () => {
    expect(skill).toMatch(/no scripts/i);
    expect(skill).toMatch(/only to the user's own Jira/i);
    expect(skill).toContain('JIRA_ENABLE_WRITES');
  });

  it('tells the agent what to do when the tools are missing', () => {
    expect(skill).toMatch(/tools are(?:n't| not) available/i);
  });

  it('covers every supported client in the setup reference', () => {
    const setup = read('references/setup.md');
    for (const client of ['Claude Code', 'Cursor', 'VS Code', 'Codex CLI', 'Windsurf', 'Claude Desktop']) expect(setup).toContain(client);
    expect(setup).toContain('.vscode/mcp.json');
    expect(setup).toContain('"servers"');
  });

  it('installs the server from the same release line in every file', () => {
    // `npx jira-delivery-mcp@…` commands and `"jira-delivery-mcp@…"` JSON/TOML args.
    const pattern = /npx(?: -y)?\s+(jira-delivery-mcp[@\w.-]*)|"(jira-delivery-mcp@[\w.-]+)"/g;
    const specs = markdownFiles().flatMap((f) => [...read(f).matchAll(pattern)].map((m) => m[1] ?? m[2]));
    expect(specs.length).toBeGreaterThan(2);
    expect(new Set(specs)).toEqual(new Set([getPackageSpec(pkg.version)]));
  });
});

describe('validateSkill()', () => {
  it('reports a bad name and a missing description', () => {
    const errors = validateSkill(SKILL_DIR, '---\nname: Jira_Delivery\n---\nbody');
    expect(errors.join('\n')).toMatch(/name/);
    expect(errors.join('\n')).toMatch(/description/);
  });
});

describe('packSkill()', () => {
  it('zips the skill folder as jira-delivery/ with only its own files', () => {
    const out = mkdtempSync(join(tmpdir(), 'skill-pack-'));
    const zip = packSkill({ outDir: out, version: '9.9.9' });
    expect(zip).toBe(join(out, 'jira-delivery-skill-9.9.9.zip'));
    const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).trim().split('\n').sort();
    expect(listing).toEqual(['jira-delivery/', 'jira-delivery/SKILL.md', 'jira-delivery/references/', 'jira-delivery/references/setup.md']);
  });
});
