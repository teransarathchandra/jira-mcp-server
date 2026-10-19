// Markdown → Atlassian Document Format, for comments the server posts to Jira.
// Covers the subset the server itself produces (R3 design §6).

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
