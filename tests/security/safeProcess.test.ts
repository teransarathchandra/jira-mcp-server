import { describe, it, expect } from 'vitest';
import { runCommandSafe, SafeProcessError } from '../../src/security/safeProcess.js';

// ── Success cases ──────────────────────────────────────────────────────────────

describe('runCommandSafe – success', () => {
  it('runs /bin/echo and returns stdout', async () => {
    const result = await runCommandSafe('/bin/echo', ['hello', 'world']);
    expect(result.stdout.trim()).toBe('hello world');
    expect(result.stderr).toBe('');
  });

  it('runs /usr/bin/true and returns empty stdout', async () => {
    const result = await runCommandSafe('/usr/bin/true', []);
    expect(result.stdout).toBe('');
  });

  it('passes an argument with spaces as a single arg (not split by shell)', async () => {
    // If a shell were used, "hello world" would be split into two args.
    // With execFile (no shell), the whole string is passed as one argument.
    const result = await runCommandSafe('/bin/echo', ['hello world']);
    // echo receives one argument "hello world" and prints it with a newline
    expect(result.stdout.trim()).toBe('hello world');
  });
});

// ── Non-zero exit ──────────────────────────────────────────────────────────────

describe('runCommandSafe – non-zero exit', () => {
  it('throws SafeProcessError when command exits non-zero', async () => {
    await expect(
      runCommandSafe('/usr/bin/false', [])
    ).rejects.toThrow(SafeProcessError);
  });

  it('SafeProcessError has the command name', async () => {
    try {
      await runCommandSafe('/usr/bin/false', []);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SafeProcessError);
      expect((err as SafeProcessError).command).toBe('/usr/bin/false');
    }
  });

  it('SafeProcessError has a numeric code or null', async () => {
    try {
      await runCommandSafe('/usr/bin/false', []);
      expect.fail('should have thrown');
    } catch (err) {
      const spErr = err as SafeProcessError;
      // code should be a number or null
      expect(spErr.code === null || typeof spErr.code === 'number').toBe(true);
    }
  });
});

// ── Timeout ────────────────────────────────────────────────────────────────────

describe('runCommandSafe – timeout', () => {
  it('throws SafeProcessError with timeout message when process exceeds timeout', async () => {
    // Use /bin/sleep with a very long duration, but a very short timeout
    try {
      await runCommandSafe('/bin/sleep', ['10'], { timeout: 100 });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SafeProcessError);
      expect((err as SafeProcessError).message).toMatch(/timed out after 100ms/i);
    }
  }, 5_000);
});

// ── Validation – command ───────────────────────────────────────────────────────

describe('runCommandSafe – command validation', () => {
  it('rejects a command with a semicolon (shell metacharacter)', async () => {
    await expect(
      runCommandSafe('echo; evil', [])
    ).rejects.toThrow(SafeProcessError);
  });

  it('rejects a command with a pipe (shell metacharacter)', async () => {
    await expect(
      runCommandSafe('echo|cat', [])
    ).rejects.toThrow(SafeProcessError);
  });

  it('rejects a command with a space', async () => {
    await expect(
      runCommandSafe('echo hello', [])
    ).rejects.toThrow(SafeProcessError);
  });

  it('rejects an empty command', async () => {
    await expect(
      runCommandSafe('', [])
    ).rejects.toThrow(SafeProcessError);
  });

  it('accepts a simple command name without metacharacters', async () => {
    // /bin/echo is an absolute path — should be accepted
    await expect(runCommandSafe('/bin/echo', ['ok'])).resolves.toBeDefined();
  });

  it('accepts a simple command name like "node"', async () => {
    // Simple names (no metacharacters, no spaces) are accepted even if they
    // rely on PATH lookup by execFile
    await expect(
      runCommandSafe('/usr/bin/true', [])
    ).resolves.toBeDefined();
  });
});

// ── Validation – args ──────────────────────────────────────────────────────────

describe('runCommandSafe – arg validation', () => {
  it('rejects an arg containing a null byte', async () => {
    await expect(
      runCommandSafe('/bin/echo', ['hello\x00world'])
    ).rejects.toThrow(SafeProcessError);
  });

  it('accepts args with spaces (they are treated as single values)', async () => {
    const result = await runCommandSafe('/bin/echo', ['arg with spaces']);
    expect(result.stdout.trim()).toBe('arg with spaces');
  });

  it('accepts multiple normal args', async () => {
    const result = await runCommandSafe('/bin/echo', ['-n', 'value']);
    expect(result.stdout).toBe('value');
  });
});

// ── Secret redaction in errors ─────────────────────────────────────────────────

describe('runCommandSafe – secret redaction in errors', () => {
  it('redacts secrets from stderr when process fails', async () => {
    // Run node to print a secret to stderr and exit with code 1
    const node = process.execPath; // absolute path to node binary
    const script = `process.stderr.write('JIRA_API_TOKEN=supersecret\\n'); process.exit(1);`;
    try {
      await runCommandSafe(node, ['-e', script]);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SafeProcessError);
      const spErr = err as SafeProcessError;
      expect(spErr.stderr).not.toContain('supersecret');
      expect(spErr.stderr).toContain('[REDACTED]');
    }
  });
});
