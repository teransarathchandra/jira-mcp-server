import {
  ConfluenceConfig,
  ConfluenceAuthError,
  ConfluenceNotFoundError,
  ConfluenceRateLimitError,
  ConfluenceServerError,
  ConfluenceNetworkError,
} from "./confluenceConfig.js";
import { MemoryCache, isCacheEnabled } from "../cache/memoryCache.js";
import { confluencePageKey, confluenceSearchKey } from "../cache/cacheKeys.js";

// ── Confluence API response interfaces ────────────────────────────────────────

export interface ConfluenceLabel {
  prefix: string;
  name: string;
  id: string;
}

export interface ConfluenceSpace {
  key: string;
  name: string;
}

export interface ConfluenceVersion {
  number: number;
  when: string;
  by?: { displayName: string };
}

export interface ConfluenceAncestor {
  id: string;
  title: string;
}

export interface ConfluencePageBody {
  view?: { value: string };    // HTML content
  storage?: { value: string }; // storage format
}

export interface ConfluencePage {
  id: string;
  title: string;
  type: string;
  status: string;
  space: ConfluenceSpace;
  version: ConfluenceVersion;
  ancestors: ConfluenceAncestor[];
  metadata: {
    labels: {
      results: ConfluenceLabel[];
    };
  };
  body?: ConfluencePageBody;
  _links: {
    webui: string;   // relative path like /spaces/SPACE/pages/123/My+Page
    base?: string;   // base URL like https://your-domain.atlassian.net/wiki
  };
}

export interface ConfluenceSearchResult {
  results: ConfluencePage[];
  start: number;
  limit: number;
  size: number;
  totalSize?: number;
}

// ── ConfluenceClient ──────────────────────────────────────────────────────────

export class ConfluenceClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly _pageCache: MemoryCache<ConfluencePage>;
  private readonly _searchCache: MemoryCache<ConfluenceSearchResult>;

  constructor(config: ConfluenceConfig) {
    // Trim trailing slash so we can always append paths with a leading slash.
    this.baseUrl = config.baseUrl.replace(/\/$/, "");

    const credentials = Buffer.from(
      `${config.email}:${config.apiToken}`
    ).toString("base64");
    this.authHeader = `Basic ${credentials}`;

    const pageTtlMs = (parseInt(process.env.MCP_CACHE_TTL_CONFLUENCE_SECONDS ?? "600", 10) || 600) * 1000;
    this._pageCache = new MemoryCache<ConfluencePage>({ ttlMs: pageTtlMs });
    this._searchCache = new MemoryCache<ConfluenceSearchResult>({ ttlMs: pageTtlMs });
  }

  /** Expose caches so external tools (e.g. mcp_clear_cache) can clear them. */
  get pageCache(): MemoryCache<ConfluencePage> { return this._pageCache; }
  get searchCache(): MemoryCache<ConfluenceSearchResult> { return this._searchCache; }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private commonHeaders(): Record<string, string> {
    return {
      Authorization: this.authHeader,
      Accept: "application/json",
    };
  }

  /**
   * Inspect a non-OK HTTP response and throw an appropriate typed error.
   * `pageId` is only supplied when operating on a specific page so the 404
   * message can be precise.
   */
  private async handleErrorResponse(
    response: Response,
    pageId?: string
  ): Promise<never> {
    const status = response.status;

    if (status === 401) {
      throw new ConfluenceAuthError(
        "Confluence authentication failed. Check your credentials."
      );
    }
    if (status === 403) {
      throw new ConfluenceAuthError(
        "Confluence access denied. This page may be restricted."
      );
    }
    if (status === 404) {
      throw new ConfluenceNotFoundError(
        `Confluence page ${pageId ?? "resource"} not found.`
      );
    }
    if (status === 429) {
      throw new ConfluenceRateLimitError(
        "Confluence rate limit exceeded. Please wait before retrying."
      );
    }
    if (status >= 500 && status <= 599) {
      throw new ConfluenceServerError(
        `Confluence server error (${status}). Try again later.`
      );
    }

    // Fallback for unexpected status codes.
    throw new Error(`Unexpected Confluence API response: HTTP ${status}`);
  }

  /**
   * Build the fully-qualified URL for a page's web UI.
   * Exported as public because the context service needs it.
   */
  public getPageUrl(page: ConfluencePage): string {
    if (page._links.base) {
      return page._links.base + page._links.webui;
    }
    return this.baseUrl + page._links.webui;
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Search pages using CQL.
   * GET {baseUrl}/rest/api/content/search?cql={cql}&limit={limit}&expand=metadata.labels,space,version,ancestors
   */
  async searchContentByCql(
    cql: string,
    limit: number
  ): Promise<ConfluenceSearchResult> {
    const cacheKey = confluenceSearchKey(cql, [], limit);
    if (isCacheEnabled()) {
      const cached = this._searchCache.get(cacheKey);
      if (cached !== undefined) return cached;
    }

    const params = new URLSearchParams({
      cql,
      limit: String(limit),
      expand: "metadata.labels,space,version,ancestors",
    });
    const url = `${this.baseUrl}/rest/api/content/search?${params.toString()}`;

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
      if (err instanceof Error && err.name === "AbortError") {
        throw new ConfluenceNetworkError(
          "Confluence request timed out after 15 seconds."
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfluenceNetworkError(
        `Network error connecting to Confluence: ${message}`
      );
    }

    if (!response.ok) {
      await this.handleErrorResponse(response);
    }

    const result = await response.json() as ConfluenceSearchResult;
    if (isCacheEnabled()) {
      this._searchCache.set(cacheKey, result);
    }
    return result;
  }

  /**
   * Fetch a single page with all metadata and body.
   * GET {baseUrl}/rest/api/content/{pageId}?expand=metadata.labels,space,version,ancestors,body.view
   */
  async getPageById(pageId: string): Promise<ConfluencePage> {
    const cacheKey = confluencePageKey(pageId);
    if (isCacheEnabled()) {
      const cached = this._pageCache.get(cacheKey);
      if (cached !== undefined) return cached;
    }

    const params = new URLSearchParams({
      expand: "metadata.labels,space,version,ancestors,body.view",
    });
    const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}?${params.toString()}`;

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
      if (err instanceof Error && err.name === "AbortError") {
        throw new ConfluenceNetworkError(
          "Confluence request timed out after 15 seconds."
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfluenceNetworkError(
        `Network error connecting to Confluence: ${message}`
      );
    }

    if (!response.ok) {
      await this.handleErrorResponse(response, pageId);
    }

    const page = await response.json() as ConfluencePage;
    if (isCacheEnabled()) {
      this._pageCache.set(cacheKey, page);
    }
    return page;
  }

  /**
   * Returns body.view.value HTML string, empty string if not available.
   */
  async getPageBody(pageId: string): Promise<string> {
    const page = await this.getPageById(pageId);
    return page.body?.view?.value ?? "";
  }

  /**
   * Returns array of label name strings extracted from the page metadata.
   */
  async getPageLabels(pageId: string): Promise<string[]> {
    const page = await this.getPageById(pageId);
    return page.metadata.labels.results.map((label) => label.name);
  }

  /**
   * Returns array of ancestor objects for the page.
   */
  async getPageAncestors(pageId: string): Promise<ConfluenceAncestor[]> {
    const page = await this.getPageById(pageId);
    return page.ancestors;
  }

  /**
   * Fetch child pages of a given page.
   * GET {baseUrl}/rest/api/content/{pageId}/child/page?limit={limit}&expand=metadata.labels,space,version
   */
  async getPageChildren(
    pageId: string,
    limit: number
  ): Promise<ConfluencePage[]> {
    const params = new URLSearchParams({
      limit: String(limit),
      expand: "metadata.labels,space,version",
    });
    const url = `${this.baseUrl}/rest/api/content/${encodeURIComponent(pageId)}/child/page?${params.toString()}`;

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
      if (err instanceof Error && err.name === "AbortError") {
        throw new ConfluenceNetworkError(
          "Confluence request timed out after 15 seconds."
        );
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new ConfluenceNetworkError(
        `Network error connecting to Confluence: ${message}`
      );
    }

    if (!response.ok) {
      await this.handleErrorResponse(response, pageId);
    }

    const data = (await response.json()) as { results: ConfluencePage[] };
    return data.results;
  }
}
