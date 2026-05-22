export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function isPositiveInt(value: string): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n > 0;
}

function isNonNegativeIntInRange(value: string, min: number, max: number): boolean {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max;
}

export function validateConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const baseUrl = process.env.JIRA_BASE_URL?.trim();
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();

  if (!baseUrl) errors.push('JIRA_BASE_URL is required but not set');
  if (!email) errors.push('JIRA_EMAIL is required but not set');
  if (!apiToken) errors.push('JIRA_API_TOKEN is required but not set');

  const confBaseUrl = process.env.CONFLUENCE_BASE_URL?.trim();
  const confEmail = process.env.CONFLUENCE_EMAIL?.trim();
  const confApiToken = process.env.CONFLUENCE_API_TOKEN?.trim();

  const confSet = [confBaseUrl, confEmail, confApiToken].filter(Boolean);
  if (confSet.length > 0 && confSet.length < 3) {
    const missing = [
      !confBaseUrl && 'CONFLUENCE_BASE_URL',
      !confEmail && 'CONFLUENCE_EMAIL',
      !confApiToken && 'CONFLUENCE_API_TOKEN',
    ].filter(Boolean);
    warnings.push(
      `Confluence integration is partially configured — missing: ${missing.join(', ')}. All three vars are required together.`
    );
  }

  const timeoutMs = process.env.MCP_HTTP_TIMEOUT_MS?.trim();
  if (timeoutMs !== undefined && timeoutMs !== '') {
    if (!isPositiveInt(timeoutMs)) {
      warnings.push('MCP_HTTP_TIMEOUT_MS must be a positive integer');
    }
  }

  const maxRetries = process.env.MCP_HTTP_MAX_RETRIES?.trim();
  if (maxRetries !== undefined && maxRetries !== '') {
    if (!isNonNegativeIntInRange(maxRetries, 0, 10)) {
      warnings.push('MCP_HTTP_MAX_RETRIES must be an integer between 0 and 10');
    }
  }

  const jiraTtl = process.env.MCP_CACHE_TTL_JIRA_SECONDS?.trim();
  if (jiraTtl !== undefined && jiraTtl !== '') {
    if (!isPositiveInt(jiraTtl)) {
      warnings.push('MCP_CACHE_TTL_JIRA_SECONDS must be a positive integer');
    }
  }

  const confluenceTtl = process.env.MCP_CACHE_TTL_CONFLUENCE_SECONDS?.trim();
  if (confluenceTtl !== undefined && confluenceTtl !== '') {
    if (!isPositiveInt(confluenceTtl)) {
      warnings.push('MCP_CACHE_TTL_CONFLUENCE_SECONDS must be a positive integer');
    }
  }

  const maxOutput = process.env.MCP_MAX_OUTPUT_CHARS?.trim();
  if (maxOutput !== undefined && maxOutput !== '') {
    const n = Number(maxOutput);
    if (!Number.isInteger(n) || n < 1000) {
      warnings.push('MCP_MAX_OUTPUT_CHARS must be a positive integer >= 1000');
    }
  }

  const maxDiff = process.env.MCP_MAX_DIFF_CHARS?.trim();
  if (maxDiff !== undefined && maxDiff !== '') {
    if (!isPositiveInt(maxDiff)) {
      warnings.push('MCP_MAX_DIFF_CHARS must be a positive integer');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
