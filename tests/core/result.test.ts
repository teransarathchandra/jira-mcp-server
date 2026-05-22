import { describe, it, expect } from 'vitest';
import {
  success,
  failure,
  partialSuccess,
  isSuccess,
  isFailure,
  isPartialSuccess,
  type Result,
} from '../../src/core/result.js';

describe('success()', () => {
  it('returns ok: true', () => {
    const r = success('data');
    expect(r.ok).toBe(true);
  });

  it('returns the provided value', () => {
    const r = success({ id: 1 });
    expect(r.value).toEqual({ id: 1 });
  });

  it('defaults warnings to an empty array', () => {
    const r = success('data');
    expect(r.warnings).toEqual([]);
  });

  it('accepts explicit warnings', () => {
    const r = success('data', ['minor issue']);
    expect(r.warnings).toEqual(['minor issue']);
  });

  it('works with various value types', () => {
    expect(success(42).value).toBe(42);
    expect(success(null).value).toBe(null);
    expect(success([1, 2, 3]).value).toEqual([1, 2, 3]);
  });
});

describe('failure()', () => {
  it('returns ok: false', () => {
    const r = failure('something went wrong');
    expect(r.ok).toBe(false);
  });

  it('includes the error message', () => {
    const r = failure('bad request');
    expect(r.error).toBe('bad request');
  });

  it('accepts an optional error code', () => {
    const r = failure('not found', 'NOT_FOUND');
    expect(r.code).toBe('NOT_FOUND');
  });

  it('omits code when not provided', () => {
    const r = failure('error');
    expect(r.code).toBeUndefined();
  });
});

describe('partialSuccess()', () => {
  it('returns ok: "partial"', () => {
    const r = partialSuccess('data', [], ['field1']);
    expect(r.ok).toBe('partial');
  });

  it('includes the value', () => {
    const r = partialSuccess({ items: [1, 2] }, [], ['extra']);
    expect(r.value).toEqual({ items: [1, 2] });
  });

  it('includes warnings', () => {
    const r = partialSuccess('data', ['slow response'], ['missing']);
    expect(r.warnings).toEqual(['slow response']);
  });

  it('includes missing fields', () => {
    const r = partialSuccess('data', [], ['confluence', 'git']);
    expect(r.missing).toEqual(['confluence', 'git']);
  });
});

describe('isSuccess()', () => {
  it('returns true for a Success result', () => {
    const r: Result<string> = success('data');
    expect(isSuccess(r)).toBe(true);
  });

  it('returns false for a Failure result', () => {
    const r: Result<string> = failure('error');
    expect(isSuccess(r)).toBe(false);
  });

  it('returns false for a PartialSuccess result', () => {
    const r: Result<string> = partialSuccess('data', [], ['x']);
    expect(isSuccess(r)).toBe(false);
  });

  it('narrows the type to Success<T>', () => {
    const r: Result<number> = success(99);
    if (isSuccess(r)) {
      expect(r.value).toBe(99);
      expect(r.warnings).toEqual([]);
    }
  });
});

describe('isFailure()', () => {
  it('returns true for a Failure result', () => {
    const r: Result<string> = failure('error');
    expect(isFailure(r)).toBe(true);
  });

  it('returns false for a Success result', () => {
    const r: Result<string> = success('data');
    expect(isFailure(r)).toBe(false);
  });

  it('returns false for a PartialSuccess result', () => {
    const r: Result<string> = partialSuccess('data', [], ['x']);
    expect(isFailure(r)).toBe(false);
  });

  it('narrows the type to Failure', () => {
    const r: Result<number> = failure('boom', 'BOOM');
    if (isFailure(r)) {
      expect(r.error).toBe('boom');
      expect(r.code).toBe('BOOM');
    }
  });
});

describe('isPartialSuccess()', () => {
  it('returns true for a PartialSuccess result', () => {
    const r: Result<string> = partialSuccess('data', [], ['x']);
    expect(isPartialSuccess(r)).toBe(true);
  });

  it('returns false for a Success result', () => {
    const r: Result<string> = success('data');
    expect(isPartialSuccess(r)).toBe(false);
  });

  it('returns false for a Failure result', () => {
    const r: Result<string> = failure('error');
    expect(isPartialSuccess(r)).toBe(false);
  });

  it('narrows the type to PartialSuccess<T>', () => {
    const r: Result<string[]> = partialSuccess(['a'], ['warn1'], ['missing1']);
    if (isPartialSuccess(r)) {
      expect(r.value).toEqual(['a']);
      expect(r.warnings).toEqual(['warn1']);
      expect(r.missing).toEqual(['missing1']);
    }
  });
});
