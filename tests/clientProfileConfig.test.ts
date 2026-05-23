import { describe, it, expect } from 'vitest';
import {
  parseClientProfile,
  getClientDisplayName,
  getClientSetupInstructions,
  getClientExampleCommands,
  getClientPromptStyle,
} from '../src/clientProfiles/clientProfileConfig.js';

// ── parseClientProfile ────────────────────────────────────────────────────────

describe('parseClientProfile', () => {
  it('returns generic when no value provided', () => {
    expect(parseClientProfile(undefined)).toBe('generic');
    expect(parseClientProfile('')).toBe('generic');
  });

  it('accepts all valid profile values', () => {
    expect(parseClientProfile('generic')).toBe('generic');
    expect(parseClientProfile('claude-code')).toBe('claude-code');
    expect(parseClientProfile('claude-desktop')).toBe('claude-desktop');
    expect(parseClientProfile('codex-cli')).toBe('codex-cli');
    expect(parseClientProfile('cursor')).toBe('cursor');
    expect(parseClientProfile('windsurf')).toBe('windsurf');
    expect(parseClientProfile('vscode')).toBe('vscode');
  });

  it('falls back to generic for unknown values', () => {
    expect(parseClientProfile('unknown')).toBe('generic');
    expect(parseClientProfile('vim')).toBe('generic');
    expect(parseClientProfile('CLAUDE-CODE')).toBe('claude-code'); // normalizes to lowercase
  });

  it('trims whitespace', () => {
    expect(parseClientProfile('  claude-code  ')).toBe('claude-code');
  });
});

// ── getClientDisplayName ──────────────────────────────────────────────────────

describe('getClientDisplayName', () => {
  it('returns human-readable names for all profiles', () => {
    expect(getClientDisplayName('generic')).toBe('Generic MCP Client');
    expect(getClientDisplayName('claude-code')).toBe('Claude Code');
    expect(getClientDisplayName('claude-desktop')).toBe('Claude Desktop');
    expect(getClientDisplayName('codex-cli')).toBe('Codex CLI');
    expect(getClientDisplayName('cursor')).toBe('Cursor');
    expect(getClientDisplayName('windsurf')).toBe('Windsurf');
    expect(getClientDisplayName('vscode')).toBe('VS Code');
  });
});

// ── getClientSetupInstructions ────────────────────────────────────────────────

describe('getClientSetupInstructions', () => {
  const name = 'jira-delivery-mcp';
  const cmd = 'node';
  const args = ['/path/to/dist/index.js'];

  it('returns markdown with server metadata', () => {
    const result = getClientSetupInstructions('generic', name, cmd, args);
    expect(result).toContain('# MCP Setup Instructions: Generic MCP Client');
    expect(result).toContain(`- Name: ${name}`);
    expect(result).toContain(`- Command: ${cmd}`);
    expect(result).toContain('/path/to/dist/index.js');
  });

  it('includes client-specific setup steps for claude-code', () => {
    const result = getClientSetupInstructions('claude-code', name, cmd, args);
    expect(result).toContain('claude mcp add');
    expect(result).toContain(name);
  });

  it('includes codex-cli specific steps', () => {
    const result = getClientSetupInstructions('codex-cli', name, cmd, args);
    expect(result).toContain('config.toml');
  });

  it('includes example usage for every profile', () => {
    for (const profile of ['generic', 'claude-code', 'claude-desktop', 'codex-cli', 'cursor', 'windsurf', 'vscode'] as const) {
      const result = getClientSetupInstructions(profile, name, cmd, args);
      expect(result).toContain('## Example Usage');
      expect(result).toContain('<ISSUE-KEY>');
    }
  });
});

// ── getClientExampleCommands ──────────────────────────────────────────────────

describe('getClientExampleCommands', () => {
  it('returns array of example command strings', () => {
    const cmds = getClientExampleCommands('generic', 'ENG-123');
    expect(Array.isArray(cmds)).toBe(true);
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      expect(typeof cmd).toBe('string');
      expect(cmd).toContain('ENG-123');
    }
  });

  it('includes additional commands for claude-code profile', () => {
    const generic = getClientExampleCommands('generic', 'ENG-1');
    const claudeCode = getClientExampleCommands('claude-code', 'ENG-1');
    expect(claudeCode.length).toBeGreaterThan(generic.length);
  });
});

// ── getClientPromptStyle ──────────────────────────────────────────────────────

describe('getClientPromptStyle', () => {
  it('returns generic agent labels for non-claude profiles', () => {
    for (const profile of ['generic', 'claude-desktop', 'codex-cli', 'cursor', 'windsurf', 'vscode'] as const) {
      const style = getClientPromptStyle(profile);
      expect(style.agentNameLabel).not.toContain('Claude Code');
      expect(style.repoInspectionInstruction).toContain('coding agent');
    }
  });

  it('returns Claude Code specific labels for claude-code profile', () => {
    const style = getClientPromptStyle('claude-code');
    expect(style.agentNameLabel).toBe('Claude Code');
    expect(style.repoInspectionInstruction).toContain('Claude Code');
  });

  it('returns all required PromptStyle fields', () => {
    const style = getClientPromptStyle('generic');
    expect(style).toHaveProperty('agentNameLabel');
    expect(style).toHaveProperty('repoInspectionInstruction');
    expect(style).toHaveProperty('implementationInstruction');
    expect(style).toHaveProperty('prReviewInstruction');
  });
});
