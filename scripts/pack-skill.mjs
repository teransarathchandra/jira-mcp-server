// Packs plugin/skills/jira-delivery as a standalone Agent Skill zip
// (jira-delivery/SKILL.md + references/), the format Agensi and other skill
// directories take. The same folder ships inside the Claude Code plugin.
// Usage: node scripts/pack-skill.mjs [outDir]   (default skill-dist/)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL_DIR = fileURLToPath(new URL('../plugin/skills/jira-delivery/', import.meta.url)).replace(/\/$/, '');

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_BODY_LINES = 500;

/** Flat `key: value` frontmatter (quotes optional); nested YAML is not used by this skill. */
export function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match) return {};
  const fields = {};
  for (const line of match[1].split('\n')) {
    const kv = /^([a-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return fields;
}

/** Agent Skills rules this package must meet; returns the problems found. */
export function validateSkill(dir, text = readFileSync(join(dir, 'SKILL.md'), 'utf8')) {
  const errors = [];
  if (!text.startsWith('---\n')) errors.push('SKILL.md must start with YAML frontmatter');
  const meta = parseFrontmatter(text);
  const name = meta.name ?? '';
  if (!NAME.test(name) || name.length > 64) errors.push(`name "${name}" must be 1-64 lowercase letters, digits and single hyphens`);
  if (name !== basename(dir)) errors.push(`name "${name}" must match the folder name "${basename(dir)}"`);
  const description = meta.description ?? '';
  if (description.length === 0 || description.length > 1024) errors.push('description must be 1-1024 characters');
  if ((meta.compatibility ?? '').length > 500) errors.push('compatibility must be at most 500 characters');
  const bodyLines = text.replace(/^---\n[\s\S]*?\n---\n/, '').split('\n').length;
  if (bodyLines > MAX_BODY_LINES) errors.push(`SKILL.md body has ${bodyLines} lines; keep it under ${MAX_BODY_LINES} and move detail to references/`);
  return errors;
}

/** Writes <outDir>/jira-delivery-skill-<version>.zip and returns its path. */
export function packSkill({ outDir, version }) {
  const errors = validateSkill(SKILL_DIR);
  if (errors.length > 0) throw new Error(`skill is invalid:\n- ${errors.join('\n- ')}`);
  mkdirSync(outDir, { recursive: true });
  const zip = join(resolve(outDir), `jira-delivery-skill-${version}.zip`);
  rmSync(zip, { force: true });
  execFileSync('zip', ['-r', '-X', '-q', zip, basename(SKILL_DIR), '-x', '*.DS_Store'], { cwd: dirname(SKILL_DIR) });
  return zip;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(packSkill({ outDir: process.argv[2] ?? 'skill-dist', version }));
}
