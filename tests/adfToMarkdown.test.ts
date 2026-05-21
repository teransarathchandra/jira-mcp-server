import { describe, it, expect } from 'vitest';
import { adfToMarkdown } from '../src/utils/adfToMarkdown.js';

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Minimal ADF doc wrapper */
function doc(...content: object[]) {
  return { type: 'doc', content };
}

function paragraph(...content: object[]) {
  return { type: 'paragraph', content };
}

function text(value: string, marks?: object[]) {
  const node: Record<string, unknown> = { type: 'text', text: value };
  if (marks && marks.length > 0) node.marks = marks;
  return node;
}

function heading(level: number, ...content: object[]) {
  return { type: 'heading', attrs: { level }, content };
}

function bulletList(...items: object[][]) {
  return {
    type: 'bulletList',
    content: items.map((itemContent) => ({
      type: 'listItem',
      content: [paragraph(...itemContent)],
    })),
  };
}

function orderedList(...items: object[][]) {
  return {
    type: 'orderedList',
    content: items.map((itemContent) => ({
      type: 'listItem',
      content: [paragraph(...itemContent)],
    })),
  };
}

function codeBlock(lang: string, code: string) {
  return {
    type: 'codeBlock',
    attrs: { language: lang },
    content: [{ type: 'text', text: code }],
  };
}

function mark(type: string, attrs?: Record<string, unknown>) {
  return attrs ? { type, attrs } : { type };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe('adfToMarkdown — null/undefined/non-ADF input', () => {
  it('returns empty string for null', () => {
    expect(adfToMarkdown(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(adfToMarkdown(undefined)).toBe('');
  });

  it('returns empty string for a plain string', () => {
    expect(adfToMarkdown('hello')).toBe('');
  });

  it('returns empty string for a number', () => {
    expect(adfToMarkdown(42)).toBe('');
  });

  it('returns empty string for an array', () => {
    expect(adfToMarkdown([])).toBe('');
  });

  it('returns empty string for an object without type === "doc"', () => {
    expect(adfToMarkdown({ type: 'paragraph', content: [] })).toBe('');
  });

  it('returns empty string for an ADF doc with empty content array', () => {
    expect(adfToMarkdown({ type: 'doc', content: [] })).toBe('');
  });
});

describe('adfToMarkdown — paragraph', () => {
  it('renders a simple paragraph with text', () => {
    const result = adfToMarkdown(doc(paragraph(text('Hello, world!'))));
    expect(result).toBe('Hello, world!');
  });

  it('renders multiple paragraphs separated by blank lines', () => {
    const result = adfToMarkdown(
      doc(paragraph(text('First')), paragraph(text('Second')))
    );
    expect(result).toContain('First');
    expect(result).toContain('Second');
    // Two paragraphs should be separated by blank line
    expect(result).toMatch(/First\n\n+Second/);
  });
});

describe('adfToMarkdown — headings', () => {
  it('renders heading level 1 with single #', () => {
    const result = adfToMarkdown(doc(heading(1, text('My Heading'))));
    expect(result).toMatch(/^# My Heading/);
  });

  it('renders heading level 2 with ##', () => {
    const result = adfToMarkdown(doc(heading(2, text('Section'))));
    expect(result).toMatch(/^## Section/);
  });

  it('renders heading level 3 with ###', () => {
    const result = adfToMarkdown(doc(heading(3, text('Subsection'))));
    expect(result).toMatch(/^### Subsection/);
  });

  it('clamps heading level below 1 to 1', () => {
    // level 0 should be treated as 1
    const result = adfToMarkdown(
      doc({ type: 'heading', attrs: { level: 0 }, content: [text('H0')] })
    );
    expect(result).toMatch(/^# H0/);
  });

  it('clamps heading level above 6 to 6', () => {
    const result = adfToMarkdown(
      doc({ type: 'heading', attrs: { level: 9 }, content: [text('H9')] })
    );
    expect(result).toMatch(/^#{6} H9/);
  });
});

describe('adfToMarkdown — inline marks', () => {
  it('renders bold text with **', () => {
    const result = adfToMarkdown(
      doc(paragraph(text('bold text', [mark('strong')])))
    );
    expect(result).toContain('**bold text**');
  });

  it('renders italic text with *', () => {
    const result = adfToMarkdown(
      doc(paragraph(text('italic text', [mark('em')])))
    );
    expect(result).toContain('*italic text*');
  });

  it('renders inline code with backticks', () => {
    const result = adfToMarkdown(
      doc(paragraph(text('myVar', [mark('code')])))
    );
    expect(result).toContain('`myVar`');
  });

  it('renders link mark as [text](url)', () => {
    const result = adfToMarkdown(
      doc(
        paragraph(
          text('click here', [mark('link', { href: 'https://example.com' })])
        )
      )
    );
    expect(result).toContain('[click here](https://example.com)');
  });

  it('renders strikethrough with ~~', () => {
    const result = adfToMarkdown(
      doc(paragraph(text('deleted', [mark('strike')])))
    );
    expect(result).toContain('~~deleted~~');
  });

  it('renders underline with <u> tags', () => {
    const result = adfToMarkdown(
      doc(paragraph(text('underlined', [mark('underline')])))
    );
    expect(result).toContain('<u>underlined</u>');
  });
});

describe('adfToMarkdown — bullet list', () => {
  it('renders a single-item bullet list', () => {
    const result = adfToMarkdown(doc(bulletList([text('Item one')])));
    expect(result).toContain('- Item one');
  });

  it('renders a multi-item bullet list', () => {
    const result = adfToMarkdown(
      doc(bulletList([text('Alpha')], [text('Beta')], [text('Gamma')]))
    );
    expect(result).toContain('- Alpha');
    expect(result).toContain('- Beta');
    expect(result).toContain('- Gamma');
  });
});

describe('adfToMarkdown — ordered list', () => {
  it('renders an ordered list with 1-based indices', () => {
    const result = adfToMarkdown(
      doc(orderedList([text('First')], [text('Second')], [text('Third')]))
    );
    expect(result).toContain('1. First');
    expect(result).toContain('2. Second');
    expect(result).toContain('3. Third');
  });
});

describe('adfToMarkdown — code block', () => {
  it('renders a code block with language annotation', () => {
    const result = adfToMarkdown(doc(codeBlock('typescript', 'const x = 1;')));
    expect(result).toContain('```typescript');
    expect(result).toContain('const x = 1;');
    expect(result).toContain('```');
  });

  it('renders a code block without language (empty fence)', () => {
    const result = adfToMarkdown(doc(codeBlock('', 'plain code')));
    expect(result).toContain('```\n');
    expect(result).toContain('plain code');
  });
});

describe('adfToMarkdown — nested lists', () => {
  it('renders nested bullet list with indentation', () => {
    const nestedItem = {
      type: 'listItem',
      content: [
        paragraph(text('Parent')),
        bulletList([text('Child')]),
      ],
    };
    const result = adfToMarkdown(
      doc({ type: 'bulletList', content: [nestedItem] })
    );
    expect(result).toContain('- Parent');
    expect(result).toContain('Child');
  });
});

describe('adfToMarkdown — mixed content', () => {
  it('renders heading followed by paragraph', () => {
    const result = adfToMarkdown(
      doc(heading(1, text('Title')), paragraph(text('Body text here.')))
    );
    expect(result).toContain('# Title');
    expect(result).toContain('Body text here.');
  });

  it('renders text with multiple marks applied in sequence', () => {
    // Bold+italic: marks are applied in order
    const result = adfToMarkdown(
      doc(paragraph(text('combo', [mark('strong'), mark('em')])))
    );
    // The result should contain the text wrapped with both markers
    expect(result).toContain('combo');
    expect(result).toContain('*');
    expect(result).toContain('**');
  });
});

describe('adfToMarkdown — special node types', () => {
  it('renders horizontal rule', () => {
    const result = adfToMarkdown(doc({ type: 'rule' }));
    expect(result).toContain('---');
  });

  it('renders inlineCard as a link', () => {
    const result = adfToMarkdown(
      doc(
        paragraph({
          type: 'inlineCard',
          attrs: { url: 'https://jira.example.com/browse/CMPI-1234' },
        })
      )
    );
    expect(result).toContain('https://jira.example.com/browse/CMPI-1234');
  });

  it('renders mention node as @name', () => {
    const result = adfToMarkdown(
      doc(
        paragraph({
          type: 'mention',
          attrs: { text: '@John Doe', displayName: 'John Doe' },
        })
      )
    );
    expect(result).toContain('@John Doe');
  });

  it('renders status node as **[text]**', () => {
    const result = adfToMarkdown(
      doc(paragraph({ type: 'status', attrs: { text: 'DONE' } }))
    );
    expect(result).toContain('**[DONE]**');
  });
});

describe('adfToMarkdown — markdown escaping', () => {
  it('escapes markdown special characters in plain text', () => {
    const result = adfToMarkdown(doc(paragraph(text('Use *asterisks* and _underscores_'))));
    // Special chars should be escaped in plain text
    expect(result).toContain('\\*asterisks\\*');
    expect(result).toContain('\\_underscores\\_');
  });

  it('does not escape text inside a code mark', () => {
    const result = adfToMarkdown(
      doc(paragraph(text('*raw*', [mark('code')])))
    );
    expect(result).toContain('`*raw*`');
  });
});

describe('adfToMarkdown — never throws', () => {
  it('does not throw on malformed/partial ADF', () => {
    expect(() => adfToMarkdown({ type: 'doc', content: null })).not.toThrow();
    expect(() =>
      adfToMarkdown({ type: 'doc', content: [{ type: 'unknown_node_xyz' }] })
    ).not.toThrow();
    expect(() =>
      adfToMarkdown({ type: 'doc', content: [{ type: 'text' }] })
    ).not.toThrow();
  });

  it('returns a string (possibly empty) on any input', () => {
    const inputs = [
      null,
      undefined,
      {},
      [],
      '',
      42,
      { type: 'doc' },
      { type: 'doc', content: [] },
    ];
    for (const input of inputs) {
      expect(typeof adfToMarkdown(input)).toBe('string');
    }
  });
});
