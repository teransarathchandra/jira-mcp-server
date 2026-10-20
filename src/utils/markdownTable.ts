/** Keeps arbitrary text inside one Markdown table cell. */
export function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}
