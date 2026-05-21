// Validates Jira issue keys for the CMPI project (Teach For America / Compass).
// Update this regex if the project key changes.
export const ISSUE_KEY_REGEX = /^CMPI-\d{4}$/;

export function isValidIssueKey(key: string): boolean {
  return ISSUE_KEY_REGEX.test(key);
}

export function validateIssueKey(key: string): void {
  if (!isValidIssueKey(key)) {
    throw new Error(
      `Invalid issue key: must match ^CMPI-\\d{4}$ (e.g., CMPI-1234)`
    );
  }
}
