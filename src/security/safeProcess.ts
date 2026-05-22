import { execFile as execFileCb } from 'node:child_process';
import { redactSecrets } from '../security/secretRedactor.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SafeProcessOptions {
  /** Timeout in milliseconds. Default: 15000 */
  timeout?: number;
  /** Max stdout+stderr buffer in bytes. Default: 10 * 1024 * 1024 (10 MB) */
  maxBuffer?: number;
  /** Working directory for the child process */
  cwd?: string;
}

// ── SafeProcessError ───────────────────────────────────────────────────────────

export class SafeProcessError extends Error {
  readonly command: string;
  readonly code: number | null;
  readonly stderr: string; // already redacted

  constructor(message: string, command: string, code: number | null, stderr: string) {
    super(message);
    this.name = 'SafeProcessError';
    this.command = command;
    this.code = code;
    this.stderr = stderr;
  }
}

// ── Validation helpers ─────────────────────────────────────────────────────────

/**
 * A safe command is either:
 * - An absolute path (starts with '/') with no null bytes or shell metacharacters
 * - A simple command name: no spaces, no shell metacharacters, no null bytes
 */
const SHELL_META_PATTERN = /[`$|&;()<>{}\[\]\\'"\s]/;

function validateCommand(command: string): void {
  if (!command || command.length === 0) {
    throw new SafeProcessError('Command must not be empty.', command, null, '');
  }
  if (command.includes('\x00')) {
    throw new SafeProcessError('Command contains null bytes.', command, null, '');
  }
  // Allow absolute paths (may contain '/', '.', '-', '_')
  if (command.startsWith('/')) {
    const UNSAFE_ABS_PATTERN = /[`$|&;()<>{}\[\]\\'"\s\x00]/;
    if (UNSAFE_ABS_PATTERN.test(command)) {
      throw new SafeProcessError(
        `Command contains unsafe characters: "${command}"`,
        command,
        null,
        ''
      );
    }
    return;
  }
  // Simple command name: no spaces, no shell metacharacters
  if (SHELL_META_PATTERN.test(command)) {
    throw new SafeProcessError(
      `Command contains shell metacharacters or spaces which are not allowed: "${command}"`,
      command,
      null,
      ''
    );
  }
}

function validateArgs(args: string[]): void {
  if (!Array.isArray(args)) {
    throw new TypeError('args must be an array');
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (typeof arg !== 'string') {
      throw new TypeError(`args[${i}] must be a string`);
    }
    if (arg.includes('\x00')) {
      throw new SafeProcessError(
        `Argument at index ${i} contains a null byte which is not allowed.`,
        '',
        null,
        ''
      );
    }
  }
}

// ── runCommandSafe ─────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB

/**
 * Safe wrapper around child_process.execFile.
 *
 * - Never spawns a shell (shell: false is the default for execFile)
 * - Validates command and args before use
 * - Enforces timeout and maxBuffer
 * - Throws SafeProcessError with redacted stderr on failure
 */
export async function runCommandSafe(
  command: string,
  args: string[],
  options?: SafeProcessOptions
): Promise<{ stdout: string; stderr: string }> {
  validateCommand(command);
  validateArgs(args);

  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS;
  const maxBuffer = options?.maxBuffer ?? DEFAULT_MAX_BUFFER;
  const cwd = options?.cwd;

  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFileCb(
      command,
      args,
      {
        timeout,
        maxBuffer,
        shell: false,
        ...(cwd !== undefined ? { cwd } : {}),
      },
      (error, stdout, stderr) => {
        if (error) {
          const redactedStderr = redactSecrets(stderr ?? '') as string;

          // Timeout detection: error.killed is true when the process was killed due to timeout
          if (error.killed) {
            reject(
              new SafeProcessError(
                `Command timed out after ${timeout}ms`,
                command,
                null,
                redactedStderr
              )
            );
            return;
          }

          const exitCode = typeof error.code === 'number' ? error.code : null;
          const redactedMessage = redactSecrets(error.message) as string;

          reject(
            new SafeProcessError(
              redactedMessage,
              command,
              exitCode,
              redactedStderr
            )
          );
          return;
        }

        resolve({
          stdout: stdout ?? '',
          stderr: stderr ?? '',
        });
      }
    );
  });
}
