// Markdown → Atlassian Document Format, for comments the server posts to Jira.
// Covers the subset the server itself produces (R3 design §6): headings,
// paragraphs, bullet/ordered lists, fenced code, rules, block quotes, and
// bold/italic/code/link marks. Anything else stays plain text. Never throws.

export interface AdfMark {
  type: 'strong' | 'em' | 'code' | 'link';
  attrs?: { href: string };
}

export interface AdfNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  text?: string;
  marks?: AdfMark[];
}

export interface AdfDoc {
  type: 'doc';
  version: 1;
  content: AdfNode[];
}

const FENCE = /^```(\S*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const RULE = /^(?:-{3,}|\*{3,})\s*$/;
// Nested markers ("> > x") collapse into one quote: ADF has no nested quotes.
const QUOTE = /^(?:>\s?)+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const INLINE = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|\[([^\]]+)\]\(([^)\s]+)\)/g;
const SAFE_LINK = /^https?:\/\//i;

function startsBlock(line: string): boolean {
  return FENCE.test(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || BULLET.test(line) || ORDERED.test(line);
}

function textNode(text: string, marks?: AdfMark[]): AdfNode {
  return marks ? { type: 'text', text, marks } : { type: 'text', text };
}

/** Inline marks; adjacent plain text is merged so unsafe links read as one string. */
function parseInline(source: string): AdfNode[] {
  const nodes: AdfNode[] = [];
  const pushPlain = (text: string) => {
    if (!text) return;
    const last = nodes[nodes.length - 1];
    if (last && last.type === 'text' && !last.marks) last.text += text;
    else nodes.push(textNode(text));
  };

  let cursor = 0;
  for (const match of source.matchAll(INLINE)) {
    const index = match.index ?? 0;
    pushPlain(source.slice(cursor, index));
    const [whole, code, strong, em1, em2, linkText, href] = match;
    if (code !== undefined) nodes.push(textNode(code, [{ type: 'code' }]));
    else if (strong !== undefined) nodes.push(textNode(strong, [{ type: 'strong' }]));
    else if (em1 !== undefined || em2 !== undefined) nodes.push(textNode((em1 ?? em2) as string, [{ type: 'em' }]));
    else if (linkText !== undefined && href !== undefined && SAFE_LINK.test(href)) {
      nodes.push(textNode(linkText, [{ type: 'link', attrs: { href } }]));
    } else pushPlain(whole);
    cursor = index + whole.length;
  }
  pushPlain(source.slice(cursor));
  return nodes;
}

function paragraph(source: string): AdfNode {
  return { type: 'paragraph', content: parseInline(source) };
}

function list(type: 'bulletList' | 'orderedList', items: string[]): AdfNode {
  return { type, content: items.map((item) => ({ type: 'listItem', content: [paragraph(item)] })) };
}

/** Jira accepts only paragraphs, lists and code inside a blockquote. */
function quoteContent(blocks: AdfNode[]): AdfNode[] {
  return blocks.flatMap((node): AdfNode[] => {
    if (node.type === 'rule') return [];
    if (node.type === 'heading') {
      // A heading becomes a bold paragraph; code-marked text cannot also be bold.
      const bold = (t: AdfNode): AdfNode =>
        t.marks?.some((m) => m.type === 'code' || m.type === 'strong') ? t : { ...t, marks: [...(t.marks ?? []), { type: 'strong' }] };
      const content = (node.content ?? []).map(bold);
      return [{ type: 'paragraph', content }];
    }
    return [node];
  });
}

function parseBlocks(lines: string[]): AdfNode[] {
  const blocks: AdfNode[] = [];
  let i = 0;
  const collect = (pattern: RegExp): string[] => {
    const items: string[] = [];
    while (i < lines.length && pattern.test(lines[i])) {
      items.push((pattern.exec(lines[i]) as RegExpExecArray)[1]);
      i++;
    }
    return items;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++; // closing fence (or end of input)
      const node: AdfNode = { type: 'codeBlock', content: code.length > 0 ? [textNode(code.join('\n'))] : [] };
      if (fence[1]) node.attrs = { language: fence[1] };
      blocks.push(node);
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', attrs: { level: heading[1].length }, content: parseInline(heading[2].trim()) });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner = quoteContent(parseBlocks(collect(QUOTE)));
      blocks.push({ type: 'blockquote', content: inner.length > 0 ? inner : [{ type: 'paragraph', content: [] }] });
      continue;
    }
    if (BULLET.test(line)) {
      blocks.push(list('bulletList', collect(BULLET)));
      continue;
    }
    if (ORDERED.test(line)) {
      blocks.push(list('orderedList', collect(ORDERED)));
      continue;
    }
    const text: string[] = [];
    while (i < lines.length && lines[i].trim() !== '' && (text.length === 0 || !startsBlock(lines[i]))) {
      text.push(lines[i].trim());
      i++;
    }
    blocks.push(paragraph(text.join(' ')));
  }
  return blocks;
}

export function markdownToAdf(markdown: string): AdfDoc {
  const content = parseBlocks(markdown.replace(/\r\n?/g, '\n').split('\n'));
  return { type: 'doc', version: 1, content: content.length > 0 ? content : [{ type: 'paragraph', content: [] }] };
}
