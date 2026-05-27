import { Config } from "./config.js";
import { MemoryCache, isCacheEnabled } from "./cache/memoryCache.js";
import { jiraIssueKey, jiraSearchKey } from "./cache/cacheKeys.js";
import { httpGet, httpPost } from "./api/httpClient.js";
import { jiraLimiter } from "./performance/concurrencyLimiter.js";

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

export interface JiraStatus {
  name: string;
}

interface JiraPriority {
  name: string;
}

export interface JiraIssueType {
  name: string;
}

interface JiraAttachment {
  filename: string;
  content: string; // URL
  mimeType: string;
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: unknown; // ADF
  created: string;
  updated: string;
}

export interface JiraSubtask {
  key: string;
  fields: {
    summary: string;
    status: JiraStatus;
  };
}

export interface JiraIssueLinkType {
  name: string;       // e.g. "Blocks", "is blocked by", "relates to", "duplicates", "clones"
  inward: string;
  outward: string;
}

export interface JiraIssueLink {
  id: string;
  type: JiraIssueLinkType;
  inwardIssue?: {
    key: string;
    fields: {
      summary: string;
      status: JiraStatus;
      issuetype: JiraIssueType;
    };
  };
  outwardIssue?: {
    key: string;
    fields: {
      summary: string;
      status: JiraStatus;
      issuetype: JiraIssueType;
    };
  };
}

export interface JiraMinimalIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: unknown | null;
    status: JiraStatus;
    priority: JiraPriority | null;
    issuetype: JiraIssueType;
    parent?: { key: string; fields: { summary: string } };
    subtasks: JiraSubtask[];
    comment: { comments: JiraComment[]; total: number; startAt?: number; maxResults?: number };
    updated: string;
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
    startAt?: number;
    maxResults?: number;
  };
  created: string;
  updated: string;
  issuelinks?: JiraIssueLink[];
  epic?: {
    key: string;
    fields: { summary: string; status: JiraStatus };
  } | null;
  // Note: custom fields (e.g. epicFieldId like "customfield_10014") are accessed
  // via (issue.fields as any)[epicFieldId] because an index signature
  // [key: string]: unknown would conflict with the typed fields above.
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
  "issuelinks",
  "epic",
].join(",");

const MINIMAL_ISSUE_FIELDS = [
  "summary",
  "description",
  "status",
  "priority",
  "issuetype",
  "parent",
  "subtasks",
  "comment",
  "updated",
].join(",");

export class JiraClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly _issueCache: MemoryCache<JiraIssue>;
  private readonly _minimalCache: MemoryCache<JiraMinimalIssue>;
  private readonly _searchCache: MemoryCache<JiraSearchResult>;

  constructor(config: Config) {
    // Trim trailing slash so we can always append paths with a leading slash.
    this.baseUrl = config.baseUrl.replace(/\/$/, "");

    const credentials = Buffer.from(
      `${config.email}:${config.apiToken}`
    ).toString("base64");
    this.authHeader = `Basic ${credentials}`;

    const issueTtlMs = (parseInt(process.env.MCP_CACHE_TTL_JIRA_SECONDS ?? "300", 10) || 300) * 1000;
    this._issueCache = new MemoryCache<JiraIssue>({ ttlMs: issueTtlMs });
    this._minimalCache = new MemoryCache<JiraMinimalIssue>({ ttlMs: issueTtlMs });
    this._searchCache = new MemoryCache<JiraSearchResult>({ ttlMs: issueTtlMs });
  }

  /** Expose caches so external tools (e.g. mcp_clear_cache) can clear them. */
  get issueCache(): MemoryCache<JiraIssue> { return this._issueCache; }
  get minimalCache(): MemoryCache<JiraMinimalIssue> { return this._minimalCache; }
  get searchCache(): MemoryCache<JiraSearchResult> { return this._searchCache; }

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

  private mapHttpClientError(err: unknown, issueKey?: string): never {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('HTTP 401') || message.includes('HTTP 403')) {
      throw new JiraAuthError('Jira authentication failed. Check your credentials.');
    }
    if (message.includes('HTTP 404')) {
      const subject = issueKey ? `Issue ${issueKey}` : 'Resource';
      throw new JiraNotFoundError(`${subject} not found in Jira.`);
    }
    if (message.includes('HTTP 429')) {
      throw new JiraRateLimitError('Jira rate limit exceeded. Please wait before retrying.');
    }
    if (message.includes('timed out')) {
      throw new JiraNetworkError('Jira request timed out.');
    }
    if (message.includes('Network error')) {
      throw new JiraNetworkError(`Network error connecting to Jira: ${message}`);
    }
    if (/HTTP 5\d\d/.test(message)) {
      throw new JiraServerError(`Jira server error. Try again later.`);
    }
    throw new JiraNetworkError(message);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async getIssue(issueKey: string): Promise<JiraIssue> {
    if (isCacheEnabled()) {
      const cached = this._issueCache.get(jiraIssueKey(issueKey));
      if (cached !== undefined) return cached;
    }

    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${ISSUE_FIELDS}`;

    let response;
    try {
      response = await jiraLimiter.run(() => httpGet(url, this.commonHeaders(), { provider: 'jira' }));
    } catch (err) {
      this.mapHttpClientError(err, issueKey);
    }

    const issue = await response.json<JiraIssue>();
    if (isCacheEnabled()) {
      this._issueCache.set(jiraIssueKey(issueKey), issue);
    }
    return issue;
  }

  async getIssueMinimal(issueKey: string): Promise<JiraMinimalIssue> {
    const cacheKey = jiraIssueKey(issueKey + ':minimal');
    if (isCacheEnabled()) {
      const cached = this._minimalCache.get(cacheKey);
      if (cached !== undefined) return cached;
    }

    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?fields=${MINIMAL_ISSUE_FIELDS}`;

    let response;
    try {
      response = await jiraLimiter.run(() => httpGet(url, this.commonHeaders(), { provider: 'jira' }));
    } catch (err) {
      this.mapHttpClientError(err, issueKey);
    }

    const issue = await response.json<JiraMinimalIssue>();
    if (isCacheEnabled()) {
      this._minimalCache.set(cacheKey, issue);
    }
    return issue;
  }

  async getIssueComments(
    issueKey: string,
    startAt: number,
    maxResults: number
  ): Promise<{ comments: JiraComment[]; total: number; startAt: number; maxResults: number }> {
    const url = `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}/comment?startAt=${startAt}&maxResults=${maxResults}&orderBy=created`;

    let response;
    try {
      response = await jiraLimiter.run(() => httpGet(url, this.commonHeaders(), { provider: 'jira' }));
    } catch (err) {
      this.mapHttpClientError(err, issueKey);
    }

    return response.json<{ comments: JiraComment[]; total: number; startAt: number; maxResults: number }>();
  }

  async searchIssues(
    jql: string,
    fields: string[],
    maxResults: number
  ): Promise<JiraSearchResult> {
    const cacheKey = jiraSearchKey(jql, maxResults);
    if (isCacheEnabled()) {
      const cached = this._searchCache.get(cacheKey);
      if (cached !== undefined) return cached;
    }

    const url = `${this.baseUrl}/rest/api/3/issue/search`;
    const postHeaders = { ...this.commonHeaders(), 'Content-Type': 'application/json' };

    let response;
    try {
      response = await jiraLimiter.run(() =>
        httpPost(url, postHeaders, { jql, fields, maxResults, startAt: 0 }, { provider: 'jira' })
      );
    } catch (err) {
      this.mapHttpClientError(err);
    }

    const result = await response.json<JiraSearchResult>();
    if (isCacheEnabled()) {
      this._searchCache.set(cacheKey, result);
    }
    return result;
  }
}
