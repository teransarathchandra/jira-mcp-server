export type Success<T> = { ok: true; value: T; warnings: string[] };
export type Failure = { ok: false; error: string; code?: string };
export type PartialSuccess<T> = { ok: 'partial'; value: T; warnings: string[]; missing: string[] };

export type Result<T> = Success<T> | Failure | PartialSuccess<T>;

export function success<T>(value: T, warnings: string[] = []): Success<T> {
  return { ok: true, value, warnings };
}

export function failure(error: string, code?: string): Failure {
  return { ok: false, error, ...(code !== undefined ? { code } : {}) };
}

export function partialSuccess<T>(value: T, warnings: string[], missing: string[]): PartialSuccess<T> {
  return { ok: 'partial', value, warnings, missing };
}

export function isSuccess<T>(r: Result<T>): r is Success<T> {
  return r.ok === true;
}

export function isFailure<T>(r: Result<T>): r is Failure {
  return r.ok === false;
}

export function isPartialSuccess<T>(r: Result<T>): r is PartialSuccess<T> {
  return r.ok === 'partial';
}
