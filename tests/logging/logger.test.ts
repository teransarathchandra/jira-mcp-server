import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Logger } from '../../src/logging/logger.js';

describe('Logger', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('logs info messages by default', () => {
    const log = new Logger('info');
    log.info('hello world');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('suppresses debug messages when level is info', () => {
    const log = new Logger('info');
    log.debug('debug message');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('shows debug messages when level is debug', () => {
    const log = new Logger('debug');
    log.debug('debug message');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('logs to stderr not stdout', () => {
    const log = new Logger('info');
    log.info('test message');
    expect(stderrSpy).toHaveBeenCalledOnce();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it('outputs valid JSON on each log line', () => {
    const log = new Logger('info');
    log.info('json test');
    const written = stderrSpy.mock.calls[0][0] as string;
    expect(() => JSON.parse(written)).not.toThrow();
  });

  it('log entry includes level, time, and message fields', () => {
    const log = new Logger('info');
    log.info('structured test');
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(entry.level).toBe('info');
    expect(entry.time).toBeDefined();
    expect(entry.message).toBe('structured test');
  });

  it('redacts secrets in meta by default', () => {
    process.env.MCP_LOG_REDACT_SECRETS = 'true';
    const log = new Logger('info');
    log.info('request', { auth: 'Authorization: Bearer secret-tok' });
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(entry.meta.auth).toBe('Authorization: [REDACTED]');
    expect(entry.meta.auth).not.toContain('secret-tok');
  });

  it('redacts secrets in the message itself', () => {
    process.env.MCP_LOG_REDACT_SECRETS = 'true';
    const log = new Logger('info');
    log.info('JIRA_API_TOKEN=mysecrettoken');
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(entry.message).toBe('JIRA_API_TOKEN=[REDACTED]');
  });

  it('does not redact when MCP_LOG_REDACT_SECRETS=false', () => {
    process.env.MCP_LOG_REDACT_SECRETS = 'false';
    const log = new Logger('info');
    log.info('plain message', { key: 'value' });
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(entry.meta.key).toBe('value');
  });

  it('logs warn messages at info level', () => {
    const log = new Logger('info');
    log.warn('warning message');
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(entry.level).toBe('warn');
  });

  it('logs error messages at info level', () => {
    const log = new Logger('info');
    log.error('error message');
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(entry.level).toBe('error');
  });

  it('suppresses info when level is error', () => {
    const log = new Logger('error');
    log.info('should be suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('suppresses warn when level is error', () => {
    const log = new Logger('error');
    log.warn('should be suppressed');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('log entry time is an ISO 8601 string', () => {
    const log = new Logger('info');
    log.info('time test');
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(new Date(entry.time).toISOString()).toBe(entry.time);
  });

  it('includes meta fields nested under meta key in log entry', () => {
    process.env.MCP_LOG_REDACT_SECRETS = 'false';
    const log = new Logger('info');
    log.info('meta test', { requestId: 'abc', count: 5 });
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(entry.meta.requestId).toBe('abc');
    expect(entry.meta.count).toBe(5);
  });

  it('setLevel changes the effective log level', () => {
    const log = new Logger('info');
    log.debug('before change');
    expect(stderrSpy).not.toHaveBeenCalled();
    log.setLevel('debug');
    log.debug('after change');
    expect(stderrSpy).toHaveBeenCalledOnce();
  });

  it('does not crash when meta contains circular references', () => {
    const log = new Logger('info');
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    expect(() => log.info('circular meta', circular)).not.toThrow();
    expect(stderrSpy).toHaveBeenCalled();
  });

  it('outputs valid JSON even when meta contains circular references', () => {
    const log = new Logger('info');
    const circular: Record<string, unknown> = { a: 1 };
    circular['self'] = circular;
    log.info('circular meta', circular);
    const written = stderrSpy.mock.calls[0][0] as string;
    expect(() => JSON.parse(written)).not.toThrow();
  });

  it('meta key in log entry does not overwrite reserved level field', () => {
    process.env.MCP_LOG_REDACT_SECRETS = 'false';
    const log = new Logger('info');
    log.info('injection test', { level: 'INJECTED' } as Record<string, unknown>);
    const written = stderrSpy.mock.calls[0][0] as string;
    const entry = JSON.parse(written);
    expect(entry.level).toBe('info');
    expect(entry.level).not.toBe('INJECTED');
  });

  it('warns to stderr when MCP_LOG_LEVEL has an unrecognized value', () => {
    process.env.MCP_LOG_LEVEL = 'verbose';
    // resolveLevel is called during Logger construction
    const _log = new Logger();
    // The unrecognized level warning should have been written to stderr
    const calls = stderrSpy.mock.calls.map((c) => c[0] as string);
    const warnCall = calls.find((c) => c.includes('Unrecognized MCP_LOG_LEVEL'));
    expect(warnCall).toBeDefined();
  });
});
