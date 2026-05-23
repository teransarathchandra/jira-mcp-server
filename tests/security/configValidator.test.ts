import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateConfig } from '../../src/security/configValidator.js';

const VALID_ENV = {
  JIRA_BASE_URL: 'https://myorg.atlassian.net',
  JIRA_EMAIL: 'user@example.com',
  JIRA_API_TOKEN: 'token-value-goes-here',
};

describe('validateConfig()', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    delete process.env.JIRA_BASE_URL;
    delete process.env.JIRA_EMAIL;
    delete process.env.JIRA_API_TOKEN;
    delete process.env.CONFLUENCE_BASE_URL;
    delete process.env.CONFLUENCE_EMAIL;
    delete process.env.CONFLUENCE_API_TOKEN;
    delete process.env.MCP_HTTP_TIMEOUT_MS;
    delete process.env.MCP_HTTP_MAX_RETRIES;
    delete process.env.MCP_CACHE_TTL_JIRA_SECONDS;
    delete process.env.MCP_CACHE_TTL_CONFLUENCE_SECONDS;
    delete process.env.MCP_MAX_OUTPUT_CHARS;
    delete process.env.MCP_MAX_DIFF_CHARS;
    delete process.env.JIRA_STRICT_PROJECT_ALLOWLIST;
    delete process.env.JIRA_DEFAULT_PROJECT_KEY;
    delete process.env.JIRA_PROJECT_KEY;
    delete process.env.JIRA_ALLOWED_PROJECT_KEYS;
  });

  afterEach(() => {
    process.env = savedEnv;
  });

  describe('required variables', () => {
    it('returns valid=true with all required vars set', () => {
      Object.assign(process.env, VALID_ENV);
      const result = validateConfig();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when JIRA_BASE_URL is missing', () => {
      Object.assign(process.env, VALID_ENV);
      delete process.env.JIRA_BASE_URL;
      const result = validateConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('JIRA_BASE_URL'))).toBe(true);
    });

    it('fails when JIRA_EMAIL is missing', () => {
      Object.assign(process.env, VALID_ENV);
      delete process.env.JIRA_EMAIL;
      const result = validateConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('JIRA_EMAIL'))).toBe(true);
    });

    it('fails when JIRA_API_TOKEN is missing', () => {
      Object.assign(process.env, VALID_ENV);
      delete process.env.JIRA_API_TOKEN;
      const result = validateConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('JIRA_API_TOKEN'))).toBe(true);
    });

    it('reports all missing required vars at once', () => {
      const result = validateConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(3);
    });
  });

  describe('Confluence partial config', () => {
    it('passes without warnings when no Confluence vars are set', () => {
      Object.assign(process.env, VALID_ENV);
      const result = validateConfig();
      expect(result.warnings).toHaveLength(0);
    });

    it('passes without warnings when all three Confluence vars are set', () => {
      Object.assign(process.env, VALID_ENV, {
        CONFLUENCE_BASE_URL: 'https://myorg.atlassian.net/wiki',
        CONFLUENCE_EMAIL: 'user@example.com',
        CONFLUENCE_API_TOKEN: 'conf-token',
      });
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('Confluence'))).toBe(false);
    });

    it('warns when only CONFLUENCE_BASE_URL is set (partial config)', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.CONFLUENCE_BASE_URL = 'https://myorg.atlassian.net/wiki';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('Confluence'))).toBe(true);
    });

    it('warns when two of three Confluence vars are set', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.CONFLUENCE_BASE_URL = 'https://myorg.atlassian.net/wiki';
      process.env.CONFLUENCE_EMAIL = 'user@example.com';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('Confluence'))).toBe(true);
      expect(result.warnings.some(w => w.includes('CONFLUENCE_API_TOKEN'))).toBe(true);
    });
  });

  describe('optional numeric vars', () => {
    it('warns when MCP_HTTP_TIMEOUT_MS is not a positive integer', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_HTTP_TIMEOUT_MS = 'notanumber';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_HTTP_TIMEOUT_MS'))).toBe(true);
    });

    it('warns when MCP_HTTP_TIMEOUT_MS is zero', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_HTTP_TIMEOUT_MS = '0';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_HTTP_TIMEOUT_MS'))).toBe(true);
    });

    it('warns when MCP_HTTP_TIMEOUT_MS is negative', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_HTTP_TIMEOUT_MS = '-100';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_HTTP_TIMEOUT_MS'))).toBe(true);
    });

    it('accepts valid MCP_HTTP_TIMEOUT_MS', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_HTTP_TIMEOUT_MS = '5000';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_HTTP_TIMEOUT_MS'))).toBe(false);
    });

    it('warns when MCP_HTTP_MAX_RETRIES is greater than 10', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_HTTP_MAX_RETRIES = '11';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_HTTP_MAX_RETRIES'))).toBe(true);
    });

    it('accepts MCP_HTTP_MAX_RETRIES of 0', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_HTTP_MAX_RETRIES = '0';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_HTTP_MAX_RETRIES'))).toBe(false);
    });

    it('warns when MCP_MAX_OUTPUT_CHARS is less than 1000', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_MAX_OUTPUT_CHARS = '500';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_MAX_OUTPUT_CHARS'))).toBe(true);
    });

    it('accepts MCP_MAX_OUTPUT_CHARS of exactly 1000', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_MAX_OUTPUT_CHARS = '1000';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_MAX_OUTPUT_CHARS'))).toBe(false);
    });

    it('warns when MCP_CACHE_TTL_JIRA_SECONDS is not a positive integer', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_CACHE_TTL_JIRA_SECONDS = '0';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_CACHE_TTL_JIRA_SECONDS'))).toBe(true);
    });

    it('warns when MCP_CACHE_TTL_CONFLUENCE_SECONDS is invalid', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_CACHE_TTL_CONFLUENCE_SECONDS = 'abc';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_CACHE_TTL_CONFLUENCE_SECONDS'))).toBe(true);
    });

    it('warns when MCP_MAX_DIFF_CHARS is not a positive integer', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.MCP_MAX_DIFF_CHARS = '-1';
      const result = validateConfig();
      expect(result.warnings.some(w => w.includes('MCP_MAX_DIFF_CHARS'))).toBe(true);
    });
  });

  describe('strict project allowlist', () => {
    it('passes when strict mode is off and no keys configured', () => {
      Object.assign(process.env, VALID_ENV);
      const result = validateConfig();
      expect(result.valid).toBe(true);
    });

    it('passes when strict mode is on and JIRA_DEFAULT_PROJECT_KEY is set', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.JIRA_STRICT_PROJECT_ALLOWLIST = 'true';
      process.env.JIRA_DEFAULT_PROJECT_KEY = 'PROJ';
      const result = validateConfig();
      expect(result.valid).toBe(true);
    });

    it('passes when strict mode is on and JIRA_ALLOWED_PROJECT_KEYS is set', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.JIRA_STRICT_PROJECT_ALLOWLIST = 'true';
      process.env.JIRA_ALLOWED_PROJECT_KEYS = 'PROJ,ABC';
      const result = validateConfig();
      expect(result.valid).toBe(true);
    });

    it('passes when strict mode enabled via "1" with a default key', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.JIRA_STRICT_PROJECT_ALLOWLIST = '1';
      process.env.JIRA_DEFAULT_PROJECT_KEY = 'PROJ';
      const result = validateConfig();
      expect(result.valid).toBe(true);
    });

    it('passes when strict mode on and legacy JIRA_PROJECT_KEY is set', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.JIRA_STRICT_PROJECT_ALLOWLIST = 'true';
      process.env.JIRA_PROJECT_KEY = 'PROJ';
      const result = validateConfig();
      expect(result.valid).toBe(true);
    });

    it('fails when strict mode is on and no project keys are configured', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.JIRA_STRICT_PROJECT_ALLOWLIST = 'true';
      const result = validateConfig();
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('JIRA_STRICT_PROJECT_ALLOWLIST'))).toBe(true);
    });

    it('error message mentions required vars when strict mode has no keys', () => {
      Object.assign(process.env, VALID_ENV);
      process.env.JIRA_STRICT_PROJECT_ALLOWLIST = 'true';
      const result = validateConfig();
      expect(result.errors.some(e =>
        e.includes('JIRA_DEFAULT_PROJECT_KEY') || e.includes('JIRA_ALLOWED_PROJECT_KEYS')
      )).toBe(true);
    });
  });

  describe('token safety', () => {
    it('does not expose actual token values in error messages', () => {
      const tokenValue = 'super-secret-token-12345';
      process.env.JIRA_API_TOKEN = tokenValue;
      const result = validateConfig();
      const allMessages = [...result.errors, ...result.warnings].join(' ');
      expect(allMessages).not.toContain(tokenValue);
    });

    it('does not expose Confluence token in warnings', () => {
      const tokenValue = 'conf-secret-token-xyz';
      Object.assign(process.env, VALID_ENV);
      process.env.CONFLUENCE_BASE_URL = 'https://myorg.atlassian.net/wiki';
      process.env.CONFLUENCE_API_TOKEN = tokenValue;
      const result = validateConfig();
      const allMessages = [...result.errors, ...result.warnings].join(' ');
      expect(allMessages).not.toContain(tokenValue);
    });
  });
});
