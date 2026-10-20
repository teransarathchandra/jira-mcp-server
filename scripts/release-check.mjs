// Used by .github/workflows/release.yml: checks a pushed tag against every
// release manifest and picks the npm dist-tag. A prerelease is published under
// its first identifier (2.0.0-rc.1 → rc), the same rule getPackageSpec() uses
// for the install docs, so `npx jira-delivery-mcp@rc` finds it.
import { appendFileSync, readFileSync } from 'node:fs';

const MANIFESTS = ['package.json', 'plugin/.claude-plugin/plugin.json', 'server.json'];
const TAG = /^v(\d+\.\d+\.\d+)(?:-(alpha|beta|rc)\.\d+)?$/;

/** @param {string} tag @param {Record<string, string>} versions manifest path → version */
export function releaseInfo(tag, versions) {
  const match = TAG.exec(tag);
  if (!match) throw new Error(`${tag} is not a release tag (vX.Y.Z or vX.Y.Z-alpha|beta|rc.N)`);
  const version = tag.slice(1);
  for (const [path, v] of Object.entries(versions)) {
    if (v !== version) throw new Error(`${path} is ${v}, but the tag is ${tag}`);
  }
  return { version, distTag: match[2] ?? 'latest' };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const versions = Object.fromEntries(MANIFESTS.map((p) => [p, JSON.parse(readFileSync(p, 'utf8')).version]));
  const { version, distTag } = releaseInfo(process.argv[2] ?? '', versions);
  console.log(`version ${version}, dist-tag ${distTag}`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `VERSION=${version}\nDIST_TAG=${distTag}\n`);
}
