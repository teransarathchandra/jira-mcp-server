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
