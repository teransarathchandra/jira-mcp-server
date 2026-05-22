import { redactSecrets } from '../security/secretRedactor.js';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

function resolveLevel(): LogLevel {
  const raw = process.env.MCP_LOG_LEVEL?.toLowerCase();
  if (raw === 'error' || raw === 'warn' || raw === 'info' || raw === 'debug') {
    return raw;
  }
  return 'info';
}

function shouldRedact(): boolean {
  return process.env.MCP_LOG_REDACT_SECRETS !== 'false';
}

export class Logger {
  private level: LogLevel;

  constructor(level?: LogLevel) {
    this.level = level ?? resolveLevel();
  }

  private write(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] > LEVEL_ORDER[this.level]) return;

    const redact = shouldRedact();
    const entry: Record<string, unknown> = {
      level,
      time: new Date().toISOString(),
      message: redact ? (redactSecrets(message) as string) : message,
    };

    if (meta) {
      const processedMeta = redact ? redactSecrets(meta) : meta;
      Object.assign(entry, processedMeta);
    }

    process.stderr.write(JSON.stringify(entry) + '\n');
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.write('error', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.write('warn', message, meta);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.write('info', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.write('debug', message, meta);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }
}

export const logger = new Logger();
