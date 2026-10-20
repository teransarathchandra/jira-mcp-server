import { describe, it, expect } from 'vitest';
import { markdownToAdf, type AdfNode } from '../src/utils/markdownToAdf.js';
import { adfToMarkdown } from '../src/utils/adfToMarkdown.js';

const blocks = (md: string): AdfNode[] => markdownToAdf(md).content;
const text = (t: string, marks?: AdfNode['marks']): AdfNode => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const para = (...content: AdfNode[]): AdfNode => ({ type: 'paragraph', content });

describe('markdownToAdf()', () => {
  it('wraps blocks in a version 1 doc', () => {
    expect(markdownToAdf('hi')).toEqual({ type: 'doc', version: 1, content: [para(text('hi'))] });
  });

  it('turns an empty string into one empty paragraph', () => {
    expect(blocks('')).toEqual([{ type: 'paragraph', content: [] }]);
  });

  it('parses headings', () => {
    expect(blocks('## QA handoff')).toEqual([{ type: 'heading', attrs: { level: 2 }, content: [text('QA handoff')] }]);
  });

  it('joins consecutive lines into one paragraph and splits on blank lines', () => {
    expect(blocks('one\ntwo\n\nthree')).toEqual([para(text('one two')), para(text('three'))]);
  });

  it('parses bullet and ordered lists', () => {
    expect(blocks('- a\n* b')).toEqual([
      { type: 'bulletList', content: [{ type: 'listItem', content: [para(text('a'))] }, { type: 'listItem', content: [para(text('b'))] }] },
    ]);
    expect(blocks('1. first\n2. second')).toEqual([
      { type: 'orderedList', content: [{ type: 'listItem', content: [para(text('first'))] }, { type: 'listItem', content: [para(text('second'))] }] },
    ]);
  });

  it('parses fenced code blocks with a language', () => {
    expect(blocks('```ts\nconst a = 1;\n```')).toEqual([{ type: 'codeBlock', attrs: { language: 'ts' }, content: [text('const a = 1;')] }]);
  });

  it('parses rules and block quotes', () => {
    expect(blocks('---')).toEqual([{ type: 'rule' }]);
    expect(blocks('> careful')).toEqual([{ type: 'blockquote', content: [para(text('careful'))] }]);
  });

  it('survives deeply nested quotes', () => {
    expect(() => markdownToAdf(`${'>'.repeat(20_000)} deep`)).not.toThrow();
  });

  it('keeps only content Jira allows inside a block quote', () => {
    const quote = blocks('> # Title\n> ---\n> > nested\n> - item')[0];
    expect(quote.type).toBe('blockquote');
    const allowed = new Set(['paragraph', 'bulletList', 'orderedList', 'codeBlock']);
    expect(quote.content?.every((n) => allowed.has(n.type))).toBe(true);
    expect(JSON.stringify(quote)).toContain('Title');
    expect(JSON.stringify(quote)).toContain('nested');
  });

  it('parses bold, italic, code and links', () => {
    expect(blocks('**b** and *i* and `c` and [docs](https://x.example/a)')).toEqual([
      para(
        text('b', [{ type: 'strong' }]),
        text(' and '),
        text('i', [{ type: 'em' }]),
        text(' and '),
        text('c', [{ type: 'code' }]),
        text(' and '),
        text('docs', [{ type: 'link', attrs: { href: 'https://x.example/a' } }]),
      ),
    ]);
  });

  it('keeps links with unsafe schemes as plain text', () => {
    expect(blocks('[click](javascript:alert(1))')).toEqual([para(text('[click](javascript:alert(1))'))]);
  });

  it('never throws on odd input', () => {
    for (const input of ['```', '**unclosed', '[x](', '> ', '1.', '#'.repeat(9) + ' x']) {
      expect(() => markdownToAdf(input)).not.toThrow();
    }
  });

  it('round-trips the subset the server produces', () => {
    const md = [
      '## QA handoff for ABC-1',
      '',
      'Lock the account after **5** failed attempts.',
      '',
      '- Happy path covered',
      '- Lockout message uses `remainingMinutes`',
      '',
      '1. Log in with a wrong password five times',
      '2. Check the lockout message',
      '',
      '```ts',
      'lockoutMessage(3)',
      '```',
      '',
      '> Regression risk in the session refresh flow',
      '',
      '---',
      '',
      'See [the PR](https://github.com/o/r/pull/7).',
    ].join('\n');
    const normalise = (s: string) => s.replace(/\n{2,}/g, '\n\n').trim();
    expect(normalise(adfToMarkdown(markdownToAdf(md)))).toBe(normalise(md));
  });
});

describe('markdownToAdf() tables', () => {
  const cell = (type: 'tableHeader' | 'tableCell', ...content: AdfNode[]): AdfNode => ({ type, attrs: {}, content: [para(...content)] });
  const row = (...cells: AdfNode[]): AdfNode => ({ type: 'tableRow', content: cells });
  const table = (...rows: AdfNode[]): AdfNode => ({ type: 'table', attrs: { isNumberColumnEnabled: false, layout: 'default' }, content: rows });
  const h = (t: string) => cell('tableHeader', text(t));
  const c = (t: string) => cell('tableCell', ...(t ? [text(t)] : []));

  it('turns a pipe table into an ADF table with a header row', () => {
    expect(blocks('| Check | Result |\n|---|---|\n| lint | pass |\n| tests | fail |')).toEqual([
      table(row(h('Check'), h('Result')), row(c('lint'), c('pass')), row(c('tests'), c('fail'))),
    ]);
  });

  it('accepts alignment colons and rows without outer pipes', () => {
    expect(blocks('a | b\n:-- | --:\n1 | 2')).toEqual([table(row(h('a'), h('b')), row(c('1'), c('2')))]);
  });

  it('keeps inline marks inside cells', () => {
    expect(blocks('| File |\n| --- |\n| `src/a.ts` **new** |')).toEqual([
      table(row(h('File')), row(cell('tableCell', text('src/a.ts', [{ type: 'code' }]), text(' '), text('new', [{ type: 'strong' }])))),
    ]);
  });

  it('treats an escaped pipe as text', () => {
    expect(blocks('| expr |\n|---|\n| a \\| b |')).toEqual([table(row(h('expr')), row(c('a | b')))]);
  });

  it('pads short rows and drops extra cells', () => {
    expect(blocks('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |')).toEqual([
      table(row(h('a'), h('b')), row(c('1'), c('')), row(c('1'), c('2'))),
    ]);
  });

  it('ends the table at a blank line', () => {
    expect(blocks('| a |\n|---|\n| 1 |\n\nafter')).toEqual([table(row(h('a')), row(c('1'))), para(text('after'))]);
  });

  it('starts a table right after a paragraph line', () => {
    expect(blocks('Results:\n| a |\n|---|\n| 1 |')).toEqual([para(text('Results:')), table(row(h('a')), row(c('1')))]);
  });

  it('leaves a table whose separator has the wrong column count as text', () => {
    expect(blocks('| a | b |\n|---|\n| 1 | 2 |')).toEqual([para(text('| a | b | |---| | 1 | 2 |'))]);
  });

  it('leaves pipes without a separator row as text', () => {
    expect(blocks('a | b\nc | d')).toEqual([para(text('a | b c | d'))]);
  });

  it('flattens a table inside a block quote into paragraphs (Jira allows no tables there)', () => {
    expect(blocks('> | a | b |\n> |---|---|\n> | 1 | 2 |')).toEqual([
      { type: 'blockquote', content: [para(text('a | b')), para(text('1 | 2'))] },
    ]);
  });

  it('never throws on degenerate tables', () => {
    for (const md of ['|', '||\n|-|', '|---|', '| a |\n|---|\n|', '|\n|\n|', ' | | \n | - | ']) {
      expect(() => markdownToAdf(md)).not.toThrow();
    }
  });
});
