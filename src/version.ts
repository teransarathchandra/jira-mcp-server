import { readFileSync } from 'node:fs';

/**
 * The server version, read from package.json so the version the server
 * reports can never drift from the published one. Resolves from both
 * src/ (tests) and dist/ (runtime) because each sits one level below the root.
 */
export function getServerVersion(): string {
  const pkgUrl = new URL('../package.json', import.meta.url);
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8')) as { version: string };
  return pkg.version;
}

/**
 * The npm spec that installs this release line. A prerelease such as
 * 2.0.0-beta.1 is published under its identifier's dist-tag (`beta`), so a
 * bare `npx jira-delivery-mcp` would install `latest` instead.
 */
export function getPackageSpec(version: string = getServerVersion()): string {
  const prerelease = version.split('-')[1];
  if (!prerelease) return 'jira-delivery-mcp';
  return `jira-delivery-mcp@${prerelease.split('.')[0]}`;
}
