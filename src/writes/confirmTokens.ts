import { createHash, randomBytes } from 'node:crypto';

// Single-use confirmation tokens for write tools (R3 design §5.2). A token is a
// random value held in server memory, bound to the tool, the issue and a hash
// of the exact arguments, so any change to the request needs a fresh preview.

const TOKEN_TTL_MS = 5 * 60 * 1000;

interface TokenRecord {
  tool: string;
  issueKey: string;
  hash: string;
  expiresAt: number;
  used: boolean;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortKeys((value as Record<string, unknown>)[k])]),
    );
  }
  return value;
}

/** SHA-256 of the canonical JSON of the arguments, ignoring `confirmToken`. */
export function argsHash(args: Record<string, unknown>): string {
  const { confirmToken: _ignored, ...rest } = args;
  return createHash('sha256').update(JSON.stringify(sortKeys(rest))).digest('hex');
}

export class ConfirmTokenStore {
  private readonly tokens = new Map<string, TokenRecord>();

  issue(tool: string, issueKey: string, args: Record<string, unknown>): string {
    this.prune();
    const token = randomBytes(16).toString('hex');
    this.tokens.set(token, { tool, issueKey, hash: argsHash(args), expiresAt: Date.now() + TOKEN_TTL_MS, used: false });
    return token;
  }

  /** True exactly once for a valid, unexpired token matching tool, issue and arguments. */
  consume(token: string, tool: string, issueKey: string, args: Record<string, unknown>): boolean {
    const record = this.tokens.get(token);
    if (!record || record.used || Date.now() > record.expiresAt) return false;
    if (record.tool !== tool || record.issueKey !== issueKey || record.hash !== argsHash(args)) return false;
    record.used = true;
    return true;
  }

  private prune(): void {
    const now = Date.now();
    for (const [token, record] of this.tokens) {
      if (record.used || now > record.expiresAt) this.tokens.delete(token);
    }
  }
}
