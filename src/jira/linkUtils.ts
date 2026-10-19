import type { LinkedIssueContext } from './issueContextService.js';

/**
 * True when the linked issue blocks *this* issue ("is blocked by").
 * An outbound "blocks" link means this issue blocks the other one, which
 * never stops work on this issue.
 */
export function isInboundBlocker(link: Pick<LinkedIssueContext, 'direction' | 'linkTypeName'>): boolean {
  return link.direction === 'inward' && /block/i.test(link.linkTypeName);
}
