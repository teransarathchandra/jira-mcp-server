export interface Config {
  baseUrl: string;
  email: string;
  apiToken: string;
  projectKey: string;
}

export function getConfig(): Config {
  const baseUrl = process.env.JIRA_BASE_URL?.trim();
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  const projectKey = (process.env.JIRA_PROJECT_KEY?.trim()) || "CMPI";

  const errors: string[] = [];

  if (!baseUrl) {
    errors.push("JIRA_BASE_URL");
  }
  if (!email) {
    errors.push("JIRA_EMAIL");
  }
  if (!apiToken) {
    errors.push("JIRA_API_TOKEN");
  }

  if (errors.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${errors.join(", ")}`
    );
  }

  return {
    baseUrl: baseUrl as string,
    email: email as string,
    apiToken: apiToken as string,
    projectKey,
  };
}
