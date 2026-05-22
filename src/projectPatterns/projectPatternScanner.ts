// ── Project Pattern Scanner ───────────────────────────────────────────────────
// Scan a local repository to extract non-sensitive reusable technical patterns.
// No I/O to external services. Only directory/filename inspection + package.json keys.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';

// ── Output interface ──────────────────────────────────────────────────────────

export interface ProjectPatterns {
  scannedAt: string;            // ISO date
  repoPath: string;
  moduleNames: string[];        // directory names under src/, app/, lib/
  testLocations: string[];      // directories containing test files
  namingConventions: string[];  // detected: camelCase, PascalCase, kebab-case, snake_case
  apiStructure: string[];       // detected route patterns
  componentPatterns: string[];  // detected UI component patterns
  permissionPatterns: string[]; // detected auth/role patterns
  validationPatterns: string[]; // detected validation patterns
  techStack: string[];          // detected: TypeScript, React, Next.js, etc.
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function readDirSafe(dirPath: string): string[] {
  try {
    return readdirSync(dirPath);
  } catch {
    return [];
  }
}

function isDirectory(filePath: string): boolean {
  try {
    return statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function readPackageJsonSync(repoPath: string): Record<string, unknown> {
  const pkgPath = join(repoPath, 'package.json');
  if (!existsSync(pkgPath)) return {};
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getAllDeps(pkg: Record<string, unknown>): string[] {
  const deps = Object.keys((pkg['dependencies'] as Record<string, unknown>) ?? {});
  const devDeps = Object.keys((pkg['devDependencies'] as Record<string, unknown>) ?? {});
  return [...deps, ...devDeps];
}

// ── Find directories with given names at max depth ────────────────────────────

function findDirectoriesNamed(
  rootPath: string,
  names: Set<string>,
  maxDepth: number,
  currentDepth = 0,
): string[] {
  if (currentDepth > maxDepth) return [];
  const results: string[] = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

  const entries = readDirSafe(rootPath);
  for (const entry of entries) {
    if (SKIP.has(entry)) continue;
    const fullPath = join(rootPath, entry);
    if (isDirectory(fullPath)) {
      if (names.has(entry)) {
        results.push(fullPath);
      }
      const nested = findDirectoriesNamed(fullPath, names, maxDepth, currentDepth + 1);
      results.push(...nested);
    }
  }

  return results;
}

// ── Find first N .ts/.tsx filenames under a directory ────────────────────────

function findTsFilenames(rootPath: string, maxCount: number): string[] {
  const results: string[] = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

  function walk(dirPath: string) {
    if (results.length >= maxCount) return;
    const entries = readDirSafe(dirPath);
    for (const entry of entries) {
      if (results.length >= maxCount) return;
      if (SKIP.has(entry)) continue;
      const fullPath = join(dirPath, entry);
      if (isDirectory(fullPath)) {
        walk(fullPath);
      } else {
        const ext = extname(entry);
        if (ext === '.ts' || ext === '.tsx') {
          results.push(entry);
        }
      }
    }
  }

  walk(rootPath);
  return results;
}

// ── Find files whose relative path contains a keyword ────────────────────────

function findFilesContainingKeyword(
  rootPath: string,
  keyword: string,
  maxCount: number,
): string[] {
  const results: string[] = [];
  const SKIP = new Set(['node_modules', '.git', 'dist', 'build']);

  function walk(dirPath: string, relativePath: string) {
    if (results.length >= maxCount) return;
    const entries = readDirSafe(dirPath);
    for (const entry of entries) {
      if (results.length >= maxCount) return;
      if (SKIP.has(entry)) continue;
      const fullPath = join(dirPath, entry);
      const relPath = relativePath ? `${relativePath}/${entry}` : entry;
      if (isDirectory(fullPath)) {
        walk(fullPath, relPath);
      } else {
        if (relPath.toLowerCase().includes(keyword.toLowerCase())) {
          results.push(relPath);
        }
      }
    }
  }

  walk(rootPath, '');
  return results;
}

// ── Main scan function ────────────────────────────────────────────────────────

export function scanProjectPatterns(repoPath: string): ProjectPatterns {
  const pkg = readPackageJsonSync(repoPath);
  const allDeps = getAllDeps(pkg);

  // ── 1. moduleNames ──────────────────────────────────────────────────────────
  const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.next']);
  const sourceRoots = ['src', 'app', 'lib'];
  const moduleNameSet = new Set<string>();

  for (const root of sourceRoots) {
    const rootPath = join(repoPath, root);
    if (existsSync(rootPath)) {
      const entries = readDirSafe(rootPath);
      for (const entry of entries) {
        if (!EXCLUDED_DIRS.has(entry) && isDirectory(join(rootPath, entry))) {
          moduleNameSet.add(entry);
        }
      }
    }
  }

  const moduleNames = Array.from(moduleNameSet);

  // ── 2. testLocations ───────────────────────────────────────────────────────
  const testDirNames = new Set(['tests', 'test', '__tests__', 'spec']);
  const foundTestDirs = findDirectoriesNamed(repoPath, testDirNames, 3);

  const testLocations: string[] = foundTestDirs.map((dir) => {
    const rel = dir.startsWith(repoPath + '/') ? dir.slice(repoPath.length + 1) : dir;
    return rel;
  });

  // Check for config files at root level
  const rootEntries = readDirSafe(repoPath);
  const hasVitestConfig = rootEntries.some((e) => e.startsWith('vitest.config.'));
  const hasJestConfig = rootEntries.some((e) => e.startsWith('jest.config.'));
  if (hasVitestConfig || hasJestConfig) {
    testLocations.push('tests at root level configured');
  }

  // ── 3. namingConventions ───────────────────────────────────────────────────
  const srcPath = join(repoPath, 'src');
  const tsFilenames = existsSync(srcPath) ? findTsFilenames(srcPath, 20) : [];

  let hasCamelCase = false;
  let hasPascalCase = false;
  let hasKebabCase = false;
  let hasSnakeCase = false;

  for (const file of tsFilenames) {
    const name = basename(file, extname(file));
    if (name.includes('-')) hasKebabCase = true;
    if (name.includes('_')) hasSnakeCase = true;
    if (/^[A-Z]/.test(name)) hasPascalCase = true;
    if (/^[a-z]/.test(name) && /[A-Z]/.test(name)) hasCamelCase = true;
  }

  const namingConventions: string[] = [];
  if (hasCamelCase) namingConventions.push('camelCase files detected');
  if (hasPascalCase) namingConventions.push('PascalCase files detected');
  if (hasKebabCase) namingConventions.push('kebab-case files detected');
  if (hasSnakeCase) namingConventions.push('snake_case files detected');

  // ── 4. apiStructure ────────────────────────────────────────────────────────
  const apiStructure: string[] = [];

  const apiDirs = ['api', 'routes', 'controllers', 'handlers'];
  for (const dir of apiDirs) {
    if (existsSync(join(repoPath, 'src', dir))) {
      apiStructure.push(`src/${dir}/ directory detected`);
    }
  }

  const apiFrameworks: Array<[string, string]> = [
    ['express', 'Express'],
    ['fastify', 'Fastify'],
    ['koa', 'Koa'],
    ['hono', 'Hono'],
    ['next', 'Next.js'],
  ];

  for (const [dep, label] of apiFrameworks) {
    if (allDeps.includes(dep)) {
      apiStructure.push(`${label} detected`);
    }
  }

  if (allDeps.some((d) => d.startsWith('@modelcontextprotocol'))) {
    apiStructure.push('MCP SDK detected');
  }

  // ── 5. componentPatterns ──────────────────────────────────────────────────
  const componentPatterns: string[] = [];

  const uiDirs = ['components', 'ui', 'pages', 'views'];
  for (const dir of uiDirs) {
    if (existsSync(join(repoPath, 'src', dir))) {
      componentPatterns.push(`src/${dir}/ directory detected`);
    }
  }

  const uiFrameworks: Array<[string, string]> = [
    ['react', 'React'],
    ['vue', 'Vue.js'],
    ['@angular/core', 'Angular'],
    ['svelte', 'Svelte'],
  ];

  for (const [dep, label] of uiFrameworks) {
    if (allDeps.includes(dep)) {
      componentPatterns.push(`${label} detected`);
    }
  }

  // ── 6. permissionPatterns ─────────────────────────────────────────────────
  const permissionPatterns: string[] = [];

  if (existsSync(srcPath)) {
    const authKeywords = ['auth', 'permission', 'role'];
    for (const keyword of authKeywords) {
      const found = findFilesContainingKeyword(srcPath, keyword, 3);
      if (found.length > 0) {
        const paths = found.slice(0, 3).map((p) => `src/${p}`);
        permissionPatterns.push(`${keyword} files detected at: ${paths.join(', ')}`);
      }
    }
  }

  // ── 7. validationPatterns ─────────────────────────────────────────────────
  const validationPatterns: string[] = [];

  const validationLibs: Array<[string, string]> = [
    ['zod', 'Zod'],
    ['joi', 'Joi'],
    ['yup', 'Yup'],
    ['class-validator', 'class-validator'],
  ];

  for (const [dep, label] of validationLibs) {
    if (allDeps.includes(dep)) {
      validationPatterns.push(label);
    }
  }

  if (existsSync(srcPath)) {
    const validationKeywords = ['validator', 'validation', 'schema'];
    for (const keyword of validationKeywords) {
      const found = findFilesContainingKeyword(srcPath, keyword, 3);
      if (found.length > 0) {
        validationPatterns.push(`${keyword} files detected`);
      }
    }
  }

  // ── 8. techStack ──────────────────────────────────────────────────────────
  const detectedTech = new Set<string>();

  const techMap: Array<[string, string]> = [
    ['typescript', 'TypeScript'],
    ['react', 'React'],
    ['next', 'Next.js'],
    ['vue', 'Vue.js'],
    ['express', 'Express'],
    ['prisma', 'Prisma'],
    ['typeorm', 'TypeORM'],
    ['mongoose', 'Mongoose'],
    ['zod', 'Zod'],
    ['vitest', 'Vitest'],
    ['jest', 'Jest'],
    ['@modelcontextprotocol/sdk', 'MCP SDK'],
  ];

  for (const [key, label] of techMap) {
    if (allDeps.includes(key)) {
      detectedTech.add(label);
    }
  }

  // NestJS — any @nestjs/ package
  if (allDeps.some((d) => d.startsWith('@nestjs/'))) {
    detectedTech.add('NestJS');
  }

  return {
    scannedAt: new Date().toISOString(),
    repoPath,
    moduleNames,
    testLocations,
    namingConventions,
    apiStructure,
    componentPatterns,
    permissionPatterns,
    validationPatterns,
    techStack: Array.from(detectedTech),
  };
}
