/**
 * Converts Atlassian Document Format (ADF) JSON to readable Markdown/plain text.
 * ADF is the format Jira uses for rich-text fields like descriptions and comments.
 */

interface AdfMark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface AdfNode {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: AdfNode[];
  marks?: AdfMark[];
}

/**
 * Apply inline marks (bold, italic, code, link, strikethrough, underline) to a text string.
 */
function renderMark(text: string, marks: AdfMark[]): string {
  let result = text;
  for (const mark of marks) {
    switch (mark.type) {
      case "strong":
        result = `**${result}**`;
        break;
      case "em":
        result = `*${result}*`;
        break;
      case "code":
        result = `\`${result}\``;
        break;
      case "link": {
        const href =
          (mark.attrs?.href as string) || (mark.attrs?.url as string) || "#";
        result = `[${result}](${href})`;
        break;
      }
      case "strike":
        result = `~~${result}~~`;
        break;
      case "underline":
        result = `<u>${result}</u>`;
        break;
      // other marks (textColor, backgroundColor, etc.) — pass through unchanged
    }
  }
  return result;
}

/**
 * Escape Markdown special characters in plain text to prevent unintended rendering.
 * Escapes: \ ` * _ [ ]
 */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

/**
 * Recursively render an ADF node to a Markdown string.
 * @param node  The ADF node to render.
 * @param listIndex  When rendering an orderedList item, pass the 1-based index here.
 */
function renderNode(node: AdfNode, listIndex?: number): string {
  if (!node || typeof node !== "object") return "";

  const children = node.content ?? [];

  switch (node.type) {
    // ── Block containers ───────────────────────────────────────────────────

    case "doc": {
      const parts = children.map((child) => renderNode(child));
      return parts.join("\n");
    }

    case "paragraph": {
      const inline = children.map((child) => renderNode(child)).join("");
      return `${inline}\n\n`;
    }

    case "heading": {
      const level = Math.min(Math.max(Number(node.attrs?.level ?? 1), 1), 6);
      const prefix = "#".repeat(level);
      const inline = children.map((child) => renderNode(child)).join("");
      return `${prefix} ${inline}\n\n`;
    }

    case "blockquote": {
      const inner = children.map((child) => renderNode(child)).join("").trim();
      // Prefix every line with "> "
      const lines = inner.split("\n");
      return lines.map((line) => `> ${line}`).join("\n") + "\n\n";
    }

    case "codeBlock": {
      const lang = (node.attrs?.language as string) ?? "";
      const code = children
        .map((child) => (child.type === "text" ? child.text ?? "" : renderNode(child)))
        .join("");
      return `\`\`\`${lang}\n${code}\n\`\`\`\n\n`;
    }

    case "rule":
      return `---\n\n`;

    case "hardBreak":
      return `\n`;

    // ── Lists ──────────────────────────────────────────────────────────────

    case "bulletList": {
      const items = children.map((child) => renderNode(child)).join("");
      return `${items}\n`;
    }

    case "orderedList": {
      const items = children
        .map((child, idx) => renderNode(child, idx + 1))
        .join("");
      return `${items}\n`;
    }

    case "listItem": {
      // Render children; flatten any trailing newlines from nested paragraphs
      const inner = children
        .map((child) => renderNode(child))
        .join("")
        .trimEnd();

      const prefix = listIndex !== undefined ? `${listIndex}. ` : "- ";

      // Handle multi-line list items (e.g. nested lists): indent continuation lines
      const lines = inner.split("\n");
      const firstLine = `${prefix}${lines[0]}`;
      const restLines = lines
        .slice(1)
        .map((l) => (l.trim() === "" ? "" : `  ${l}`));
      return [firstLine, ...restLines].join("\n") + "\n";
    }

    // ── Table ──────────────────────────────────────────────────────────────

    case "table": {
      const rows = children.filter(
        (c) => c.type === "tableRow"
      );
      if (rows.length === 0) return "";

      const renderedRows = rows.map((row) => renderNode(row));

      // Insert a separator row after the first row (header)
      const firstRow = renderedRows[0];
      // Count columns from first row
      const colCount = (rows[0].content ?? []).length;
      const separator = `| ${Array(colCount).fill("---").join(" | ")} |`;

      const result = [firstRow, separator, ...renderedRows.slice(1)].join("\n");
      return `${result}\n\n`;
    }

    case "tableRow": {
      const cells = children.map((cell) => renderNode(cell)).join("");
      return `|${cells}`;
    }

    case "tableHeader":
    case "tableCell": {
      const inner = children
        .map((child) => renderNode(child))
        .join("")
        .replace(/\n+/g, " ")
        .trim();
      return ` ${inner} |`;
    }

    // ── Inline / leaf nodes ────────────────────────────────────────────────

    case "text": {
      const raw = node.text ?? "";
      const marks = node.marks ?? [];
      // Only escape if there's no code mark (code content is already protected by backticks)
      const hasCodeMark = marks.some((m) => m.type === "code");
      const escaped = !hasCodeMark && marks.length === 0 ? escapeMarkdown(raw) : raw;
      return marks.length > 0 ? renderMark(escaped, marks) : escaped;
    }

    case "inlineCard": {
      const url = (node.attrs?.url as string) ?? "#";
      return `[${url}](${url})`;
    }

    case "mention": {
      const name =
        (node.attrs?.text as string) ||
        (node.attrs?.displayName as string) ||
        "unknown";
      return `@${name}`;
    }

    case "emoji": {
      const emoji =
        (node.attrs?.text as string) ||
        (node.attrs?.shortName as string) ||
        "";
      return emoji;
    }

    case "status": {
      const text = (node.attrs?.text as string) ?? "";
      return `**[${text}]**`;
    }

    case "mediaSingle": {
      // Try to render any caption child; otherwise fall back to [attachment]
      const captionNode = children.find((c) => c.type === "caption");
      if (captionNode) {
        const caption = (captionNode.content ?? [])
          .map((c) => renderNode(c))
          .join("");
        return `[attachment: ${caption}]\n\n`;
      }
      // Also render any media children
      const mediaChildren = children
        .filter((c) => c.type === "media")
        .map((c) => renderNode(c))
        .join(" ");
      return mediaChildren
        ? `${mediaChildren}\n\n`
        : `[attachment]\n\n`;
    }

    case "media": {
      const id = (node.attrs?.id as string) || "file";
      return `[media: ${id}]`;
    }

    case "expand": {
      const title = (node.attrs?.title as string) ?? "";
      const inner = children.map((child) => renderNode(child)).join("");
      return title ? `### ${title}\n${inner}` : inner;
    }

    // ── Fallthrough for unknown/unsupported nodes ──────────────────────────

    default: {
      if (children.length > 0) {
        return children.map((child) => renderNode(child)).join("");
      }
      return "";
    }
  }
}

/**
 * Convert an ADF document (as returned by the Jira Cloud REST API v3) into
 * readable Markdown text.
 *
 * @param adf  The ADF value from Jira (`issue.fields.description`, etc.).
 *             Accepts `unknown` because the Jira API returns untyped JSON.
 * @returns    A Markdown string, or an empty string if the input is not a
 *             valid ADF document.
 */
export function adfToMarkdown(adf: unknown): string {
  // Guard: must be a non-null object with type === "doc"
  if (
    adf === null ||
    adf === undefined ||
    typeof adf !== "object" ||
    Array.isArray(adf)
  ) {
    return "";
  }

  const doc = adf as AdfNode;

  if (doc.type !== "doc") {
    return "";
  }

  try {
    let result = renderNode(doc);

    // Normalise: collapse more-than-2 consecutive blank lines down to 2
    result = result.replace(/\n{3,}/g, "\n\n");

    // Strip leading/trailing blank lines
    result = result.trim();

    return result;
  } catch {
    // Never throw — return best-effort empty string on malformed input
    return "";
  }
}
