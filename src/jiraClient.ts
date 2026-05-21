import { Config } from "./config.js";

// ── Custom error classes ──────────────────────────────────────────────────────

export class JiraAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraAuthError";
  }
}

export class JiraNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraNotFoundError";
  }
}

export class JiraRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraRateLimitError";
  }
}

export class JiraServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraServerError";
  }
}

export class JiraNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JiraNetworkError";
  }
}

// ── Jira API response interfaces ──────────────────────────────────────────────

interface JiraUser {
  displayName: string;
  emailAddress?: string;
}

interface JiraStatus {
  name: string;
}

interface JiraPriority {
  name: string;
}

interface JiraIssueType {
  name: string;
}

interface JiraAttachment {
  filename: string;
  content: string; // URL
  mimeType: string;
}

interface JiraComment {
  id: string;
  author: JiraUser;
  body: unknown; // ADF
  created: string;
  updated: string;
}

interface JiraSubtask {
  key: string;
  fields: {
    summary: string;
    status: JiraStatus;
  };
}

interface JiraIssueFields {
  summary: string;
  description: unknown | null; // ADF
  status: JiraStatus;
  priority: JiraPriority | null;
  assignee: JiraUser | null;
  reporter: JiraUser | null;
  labels: string[];
  components: Array<{ name: string }>;
  fixVersions: Array<{ name: string }>;
  issuetype: JiraIssueType;
  parent?: { key: string; fields: { summary: string } };
  subtasks: JiraSubtask[];
  attachment: JiraAttachment[];
  comment: {
    comments: JiraComment[];
    total: number;
  };
  created: string;
  updated: string;
}

export interface JiraIssue {
  id: string;
  key: string;
  fields: JiraIssueFields;
}

interface JiraSearchResult {
  issues: Array<{
    key: string;
    fields: {
      summary: string;
      status: JiraStatus;
      priority: JiraPriority | null;
      updated: string;
    };
  }>;
  total: number;
}

// ── JiraClient ────────────────────────────────────────────────────────────────

const ISSUE_FIELDS = [
  "summary",
  "description",
  "status",
  "priority",
  "assignee",
  "reporter",
  "labels",
  "components",
  "fixVersions",
  "issuetype",
  "parent",
  "subtasks",
  "attachment",
  "comment",
  "created",
  "updated",
].join(",");

export class JiraClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(config: Config) {
    // Trim trailing slash so we can always append paths with a leading slash.
    this.baseUrl = config.baseUrl.replace(/\/$/, "");

    const credentials = Buffer.from(
      `${config.email}:${config.apiToken}`
    ).toString("base64");
    this.authHeader = `Basic ${credentials}`;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private commonHeaders(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
  }

  /**
   * Inspect a non-OK HTTP response and throw an appropriate typed error.
   * `issueKey` is only supplied by getIssue so the 404 message can be precise.
   */
  private async handleErrorResponse(
    response: Response,
    issueKey?: string
  ): Promise<never> {
    const status = response.status;

    if (status === 401) {
      throw new JiraAuthError(
        "Jira authentication failed. Check your credentials."
      );
    }
    if (status === 403) {
      throw new JiraAuthError(
        "Jira access denied. Your account may lack permission for this resource."
      );
    }
    if (status === 404) {
      const subject = issueKey ? `Issue ${issueKey}` : "Resource";
      throw new JiraNotFoundError(`${subject} not found in Jira.`);
    }
    if (status === 429) {
      throw new JiraRateLimitError(
        "Jira rate limit exceeded. Please wait before retrying."
      );
    }
    if (status >= 500 && status <= 599) {
      throw new JiraServerError(
        `Jira server error (${status}). Try again later.`
      );
    }

    // Fallback for unexpected status codes.
    throw new Error(`Unexpected Jira API response: HTTP ${status}`);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async getIssue(issueKey: string): Promise<JiraIssue> {
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${ISSUE_FIELDS}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "GET",
        headers: this.commonHeaders(),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new JiraNetworkError('Jira request timed out after 15 seconds.');
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new JiraNetworkError(
        `Network error connecting to Jira: ${message}`
      );
    }

    if (!response.ok) {
      await this.handleErrorResponse(response, issueKey);
    }

    return response.json() as Promise<JiraIssue>;
  }

  async searchIssues(
    jql: string,
    fields: string[],
    maxResults: number
  ): Promise<JiraSearchResult> {
    const url = `${this.baseUrl}/rest/api/3/issue/search`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          ...this.commonHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ jql, fields, maxResults, startAt: 0 }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new JiraNetworkError('Jira request timed out after 15 seconds.');
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new JiraNetworkError(
        `Network error connecting to Jira: ${message}`
      );
    }

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    return response.json() as Promise<JiraSearchResult>;
  }
}
