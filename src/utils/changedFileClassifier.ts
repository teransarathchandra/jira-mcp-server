import { ChangedFile } from '../git/gitDiffService.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export type RiskyReason =
  | 'database_migration'
  | 'auth_or_permissions'
  | 'payment_or_financial'
  | 'dependency_update'
  | 'lock_file'
  | 'deleted_file'
  | 'config_or_environment'
  | 'large_generated_file';

export interface RiskyFile {
  file: ChangedFile;
  reasons: RiskyReason[];
}

export interface ClassifiedFiles {
  testFiles: ChangedFile[];
  configFiles: ChangedFile[];
  migrationFiles: ChangedFile[];
  lockFiles: ChangedFile[];
  generatedFiles: ChangedFile[];
  documentationFiles: ChangedFile[];
  sourceFiles: ChangedFile[];      // remaining non-special files
  riskyFiles: RiskyFile[];         // any file with at least one risky reason
  backendFiles: ChangedFile[];     // files that look like backend/server code
  frontendFiles: ChangedFile[];    // files that look like frontend/UI code
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Returns the lowercase filename (basename) from a path. */
function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

/** Returns true if the file appears to be a test file. */
export function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);

  // path-segment checks
  if (
    containsDir(lower, '/test/') ||
    containsDir(lower, '/tests/') ||
    containsDir(lower, '/__tests__/') ||
    containsDir(lower, '/spec/') ||
    containsDir(lower, '/__spec__/') ||
    containsDir(lower, '/test-utils/') ||
    containsDir(lower, '/test-helpers/') ||
    containsDir(lower, '/testing/')
  ) {
    return true;
  }

  // filename-suffix checks
  const testSuffixes = [
    '.test.ts', '.test.tsx', '.test.js',
    '.spec.ts', '.spec.tsx', '.spec.js',
    '.test.py', '.spec.py',
  ];
  for (const suffix of testSuffixes) {
    if (name.endsWith(suffix)) return true;
  }

  // Go / Ruby conventions
  if (name.endsWith('_test.go') || name.endsWith('_test.rb')) return true;

  return false;
}

/** Returns true if a path contains a directory segment (handles leading-slash-free paths too). */
function containsDir(lower: string, segment: string): boolean {
  // segment should already start with / e.g. '/dist/'
  return lower.includes(segment) || lower.startsWith(segment.slice(1));
}

/** Returns true if the file appears to be a generated/noise file. */
export function isGeneratedFile(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);

  if (
    containsDir(lower, '/dist/') ||
    containsDir(lower, '/build/') ||
    containsDir(lower, '/coverage/') ||
    containsDir(lower, '/node_modules/') ||
    containsDir(lower, '/.next/') ||
    containsDir(lower, '/.nuxt/') ||
    containsDir(lower, '/__generated__/') ||
    containsDir(lower, '/generated/')
  ) {
    return true;
  }

  if (name.endsWith('.min.js') || name.endsWith('.min.css') || name.endsWith('.map')) {
    return true;
  }

  if (name.endsWith('.pb.go') || name.endsWith('.pb.ts')) return true;

  if (name.includes('generated')) return true;

  return false;
}

/** Returns true if the file appears to be a lock file. */
export function isLockFile(path: string): boolean {
  const name = basename(path);
  const lockFileNames = new Set([
    'package-lock.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'Gemfile.lock',
    'Pipfile.lock',
    'poetry.lock',
    'composer.lock',
    'Cargo.lock',
    'go.sum',
    'bun.lockb',
  ]);
  return lockFileNames.has(name);
}

function isConfigFile(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(path);          // keep original case for exact-name checks
  const nameLower = name.toLowerCase();

  // path prefix (both with and without leading slash)
  if (lower.startsWith('.github/') || lower.includes('/.github/')) return true;

  // exact filenames (case-sensitive set)
  const exactNames = new Set(['package.json', 'Makefile', 'Dockerfile']);
  if (exactNames.has(name)) return true;

  // glob-style patterns (checked on lowercase name)
  if (nameLower === '.env') return true;
  if (nameLower.startsWith('.env.')) return true;
  if (nameLower === 'tsconfig.json') return true;
  if (nameLower.startsWith('tsconfig.') && nameLower.endsWith('.json')) return true;
  if (nameLower.startsWith('.eslintrc')) return true;
  if (nameLower.startsWith('.prettierrc')) return true;
  if (nameLower.startsWith('jest.config')) return true;
  if (nameLower.startsWith('vitest.config')) return true;
  if (nameLower.startsWith('vite.config')) return true;
  if (nameLower.startsWith('webpack.config')) return true;
  if (nameLower.startsWith('babel.config')) return true;
  if (nameLower.startsWith('.babelrc')) return true;
  if (nameLower.startsWith('docker-compose')) return true;
  if (nameLower.startsWith('dockerfile')) return true;
  if (nameLower.endsWith('.yaml') || nameLower.endsWith('.yml')) return true;

  return false;
}

function isMigrationFile(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);

  if (
    containsDir(lower, '/migrations/') ||
    containsDir(lower, '/migration/') ||
    lower.includes('/db/migrate/') ||
    lower.includes('/db/migrations/')
  ) {
    return true;
  }

  // patterns like 20240101_something.sql, V1__something.sql, 001_something.ts
  if (/^\d{8}_/.test(name)) return true;           // 20240101_...
  if (/^v\d+__/i.test(name)) return true;           // V1__...
  if (/^\d{3,}_/.test(name)) return true;           // 001_...

  if (name.endsWith('.sql')) return true;

  return false;
}

function isDocumentationFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return (
    name.endsWith('.md') ||
    name.endsWith('.mdx') ||
    name.endsWith('.rst') ||
    name.endsWith('.txt') ||
    name.endsWith('.adoc')
  );
}

function isBackendFile(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);

  if (
    containsDir(lower, '/api/') ||
    containsDir(lower, '/server/') ||
    containsDir(lower, '/backend/') ||
    containsDir(lower, '/services/') ||
    containsDir(lower, '/controllers/') ||
    containsDir(lower, '/handlers/') ||
    containsDir(lower, '/routes/') ||
    containsDir(lower, '/middleware/') ||
    containsDir(lower, '/models/') ||
    containsDir(lower, '/repositories/') ||
    containsDir(lower, '/dao/')
  ) {
    return true;
  }

  if (
    name.endsWith('.go') ||
    name.endsWith('.py') ||
    name.endsWith('.java') ||
    name.endsWith('.rb') ||
    name.endsWith('.php') ||
    name.endsWith('.rs') ||
    name.endsWith('.cs')
  ) {
    return true;
  }

  if (
    name.endsWith('controller.ts') ||
    name.endsWith('service.ts') ||
    name.endsWith('repository.ts') ||
    name.endsWith('handler.ts') ||
    name.endsWith('route.ts') ||
    name.endsWith('middleware.ts')
  ) {
    return true;
  }

  if (
    name.includes('controller') ||
    name.includes('service') ||
    name.includes('repository') ||
    name.includes('handler') ||
    name.includes('route') ||
    name.includes('middleware')
  ) {
    return true;
  }

  return false;
}

function isFrontendFile(path: string): boolean {
  const lower = path.toLowerCase();
  const name = basename(lower);

  if (
    containsDir(lower, '/ui/') ||
    containsDir(lower, '/frontend/') ||
    containsDir(lower, '/web/') ||
    containsDir(lower, '/client/') ||
    containsDir(lower, '/components/') ||
    containsDir(lower, '/pages/') ||
    containsDir(lower, '/views/') ||
    containsDir(lower, '/screens/') ||
    containsDir(lower, '/styles/') ||
    containsDir(lower, '/assets/') ||
    containsDir(lower, '/public/') ||
    containsDir(lower, '/static/')
  ) {
    return true;
  }

  if (name.endsWith('.tsx') || name.endsWith('.jsx')) return true;

  if (
    name.endsWith('.css') ||
    name.endsWith('.scss') ||
    name.endsWith('.sass') ||
    name.endsWith('.less') ||
    name.endsWith('.styl')
  ) {
    return true;
  }

  return false;
}

function getRiskyReasons(file: ChangedFile, migration: boolean, lock: boolean, generated: boolean): RiskyReason[] {
  const reasons: RiskyReason[] = [];
  const lower = file.path.toLowerCase();
  const name = basename(lower);

  if (migration || name.endsWith('.sql')) {
    reasons.push('database_migration');
  }

  const authKeywords = ['auth', 'permission', 'role', 'oauth', 'jwt', 'token', 'credential', 'access-control', 'acl'];
  if (authKeywords.some(kw => lower.includes(kw))) {
    reasons.push('auth_or_permissions');
  }

  const paymentKeywords = ['payment', 'billing', 'invoice', 'stripe', 'paypal', 'financial', 'pricing', 'subscription', 'charge', 'refund'];
  if (paymentKeywords.some(kw => lower.includes(kw))) {
    reasons.push('payment_or_financial');
  }

  if (basename(file.path) === 'package.json' && file.status === 'modified') {
    reasons.push('dependency_update');
  }

  if (lock) {
    reasons.push('lock_file');
  }

  if (file.status === 'deleted') {
    reasons.push('deleted_file');
  }

  // config_or_environment: contains .env, is in /config/, is Dockerfile, or docker-compose
  const nameOrig = basename(file.path).toLowerCase();
  if (
    lower.includes('.env') ||
    containsDir(lower, '/config/') ||
    nameOrig.startsWith('dockerfile') ||
    nameOrig.startsWith('docker-compose')
  ) {
    reasons.push('config_or_environment');
  }

  if (generated) {
    reasons.push('large_generated_file');
  }

  return reasons;
}

// ── Main function ──────────────────────────────────────────────────────────────

export function classifyChangedFiles(files: ChangedFile[]): ClassifiedFiles {
  const result: ClassifiedFiles = {
    testFiles: [],
    configFiles: [],
    migrationFiles: [],
    lockFiles: [],
    generatedFiles: [],
    documentationFiles: [],
    sourceFiles: [],
    riskyFiles: [],
    backendFiles: [],
    frontendFiles: [],
  };

  for (const file of files) {
    const test = isTestFile(file.path);
    const config = isConfigFile(file.path);
    const migration = isMigrationFile(file.path);
    const lock = isLockFile(file.path);
    const generated = isGeneratedFile(file.path);
    const documentation = isDocumentationFile(file.path);
    const backend = isBackendFile(file.path);
    const frontend = isFrontendFile(file.path);

    if (test) result.testFiles.push(file);
    if (config) result.configFiles.push(file);
    if (migration) result.migrationFiles.push(file);
    if (lock) result.lockFiles.push(file);
    if (generated) result.generatedFiles.push(file);
    if (documentation) result.documentationFiles.push(file);
    if (backend) result.backendFiles.push(file);
    if (frontend) result.frontendFiles.push(file);

    // Source files = not test, config, migration, lock, or generated
    if (!test && !config && !migration && !lock && !generated) {
      result.sourceFiles.push(file);
    }

    // Risky files
    const reasons = getRiskyReasons(file, migration, lock, generated);
    if (reasons.length > 0) {
      result.riskyFiles.push({ file, reasons });
    }
  }

  return result;
}
