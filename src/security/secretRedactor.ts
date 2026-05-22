import { createHash } from 'node:crypto';

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/Authorization:\s*Basic\s+\S+/gi, 'Authorization: [REDACTED]'],
  [/Authorization:\s*Bearer\s+\S+/gi, 'Authorization: [REDACTED]'],
  [/Bearer\s+\S{8,}/g, 'Bearer [REDACTED]'],
  [/Basic\s+\S{8,}/g, 'Basic [REDACTED]'],
  [/(JIRA_API_TOKEN=)\S+/g, '$1[REDACTED]'],
  [/(CONFLUENCE_API_TOKEN=)\S+/g, '$1[REDACTED]'],
  [/(GITHUB_TOKEN=)\S+/g, '$1[REDACTED]'],
  [/([A-Z][A-Z0-9_]*_TOKEN=)\S+/g, '$1[REDACTED]'],
  [/([A-Z][A-Z0-9_]*_SECRET=)\S+/g, '$1[REDACTED]'],
];

export function isLikelySecret(value: string): boolean {
  if (value.length < 20) return false;
  if (/\s/.test(value)) return false;

  const shannon = shannonEntropy(value);
  return shannon > 3.5;
}

function shannonEntropy(s: string): number {
  const freq = new Map<string, number>();
  for (const ch of s) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / s.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function redactString(value: string): string {
  let result = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function redactSecrets(input: unknown): unknown {
  if (typeof input === 'string') {
    return redactString(input);
  }

  if (Array.isArray(input)) {
    return input.map(redactSecrets);
  }

  if (input instanceof Error) {
    const redacted = new Error(redactString(input.message));
    if (input.stack) {
      redacted.stack = redactString(input.stack);
    }
    return redacted;
  }

  if (input !== null && typeof input === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      out[k] = redactSecrets(v);
    }
    return out;
  }

  return input;
}

export function redactUrl(url: string): string {
  const SENSITIVE_PARAMS = new Set(['token', 'api_key', 'secret', 'key']);
  try {
    const parsed = new URL(url);
    const toDelete: string[] = [];
    for (const name of parsed.searchParams.keys()) {
      if (SENSITIVE_PARAMS.has(name.toLowerCase())) {
        toDelete.push(name);
      }
    }
    for (const name of toDelete) {
      parsed.searchParams.delete(name);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
