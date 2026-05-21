import { describe, it, expect } from 'vitest';
import {
  classifyChangedFiles,
  isTestFile,
  isGeneratedFile,
  isLockFile,
} from '../src/utils/changedFileClassifier.js';
import type { ChangedFile } from '../src/git/gitDiffService.js';

// ── Helper ─────────────────────────────────────────────────────────────────────

function makeFile(path: string, status: ChangedFile['status'] = 'added'): ChangedFile {
  return { path, status };
}

// ── isTestFile ─────────────────────────────────────────────────────────────────

describe('isTestFile', () => {
  it('returns true for .test.ts suffix', () => {
    expect(isTestFile('src/services/UserService.test.ts')).toBe(true);
  });

  it('returns true for .spec.ts suffix', () => {
    expect(isTestFile('src/services/UserService.spec.ts')).toBe(true);
  });

  it('returns true for .test.tsx suffix', () => {
    expect(isTestFile('src/components/Button.test.tsx')).toBe(true);
  });

  it('returns true for .spec.tsx suffix', () => {
    expect(isTestFile('src/components/Button.spec.tsx')).toBe(true);
  });

  it('returns true for .test.js suffix', () => {
    expect(isTestFile('lib/utils.test.js')).toBe(true);
  });

  it('returns true for .spec.js suffix', () => {
    expect(isTestFile('lib/utils.spec.js')).toBe(true);
  });

  it('returns true for .test.py suffix', () => {
    expect(isTestFile('tests/auth/test_login.test.py')).toBe(true);
  });

  it('returns true for .spec.py suffix', () => {
    expect(isTestFile('tests/auth.spec.py')).toBe(true);
  });

  it('returns true for _test.go suffix', () => {
    expect(isTestFile('pkg/handler/server_test.go')).toBe(true);
  });

  it('returns true for _test.rb suffix', () => {
    expect(isTestFile('spec/models/user_test.rb')).toBe(true);
  });

  it('returns true for path containing /__tests__/', () => {
    expect(isTestFile('src/__tests__/auth.ts')).toBe(true);
  });

  it('returns true for path containing /test/', () => {
    expect(isTestFile('app/test/helpers.ts')).toBe(true);
  });

  it('returns true for path containing /tests/', () => {
    expect(isTestFile('app/tests/helpers.ts')).toBe(true);
  });

  it('returns true for path containing /spec/', () => {
    expect(isTestFile('app/spec/models.ts')).toBe(true);
  });

  it('returns true for path containing /__spec__/', () => {
    expect(isTestFile('src/__spec__/utils.ts')).toBe(true);
  });

  it('returns true for path containing /test-utils/', () => {
    expect(isTestFile('src/test-utils/renderHelpers.ts')).toBe(true);
  });

  it('returns true for path containing /test-helpers/', () => {
    expect(isTestFile('src/test-helpers/mocks.ts')).toBe(true);
  });

  it('returns true for path containing /testing/', () => {
    expect(isTestFile('src/testing/fixtures.ts')).toBe(true);
  });

  it('returns false for regular source file', () => {
    expect(isTestFile('src/services/UserService.ts')).toBe(false);
  });

  it('returns false for file with "test" in a non-segment part of the path', () => {
    // e.g. "testimony" shouldn't match /test/
    expect(isTestFile('src/utils/testimony.ts')).toBe(false);
  });
});

// ── isGeneratedFile ────────────────────────────────────────────────────────────

describe('isGeneratedFile', () => {
  it('returns true for file in /dist/', () => {
    expect(isGeneratedFile('dist/index.js')).toBe(true);
  });

  it('returns true for file in /build/', () => {
    expect(isGeneratedFile('build/main.js')).toBe(true);
  });

  it('returns true for file in /coverage/', () => {
    expect(isGeneratedFile('coverage/lcov.info')).toBe(true);
  });

  it('returns true for file in /node_modules/', () => {
    expect(isGeneratedFile('node_modules/lodash/index.js')).toBe(true);
  });

  it('returns true for file in /.next/', () => {
    expect(isGeneratedFile('.next/static/chunk.js')).toBe(true);
  });

  it('returns true for file in /__generated__/', () => {
    expect(isGeneratedFile('src/__generated__/graphql.ts')).toBe(true);
  });

  it('returns true for file in /generated/', () => {
    expect(isGeneratedFile('src/generated/types.ts')).toBe(true);
  });

  it('returns true for .min.js file', () => {
    expect(isGeneratedFile('public/vendor.min.js')).toBe(true);
  });

  it('returns true for .min.css file', () => {
    expect(isGeneratedFile('public/app.min.css')).toBe(true);
  });

  it('returns true for .map file', () => {
    expect(isGeneratedFile('dist/app.js.map')).toBe(true);
  });

  it('returns true for .pb.go file', () => {
    expect(isGeneratedFile('proto/user.pb.go')).toBe(true);
  });

  it('returns true for .pb.ts file', () => {
    expect(isGeneratedFile('proto/user.pb.ts')).toBe(true);
  });

  it('returns true for filename containing "generated"', () => {
    expect(isGeneratedFile('src/userGenerated.ts')).toBe(true);
  });

  it('returns false for regular source file', () => {
    expect(isGeneratedFile('src/utils/helper.ts')).toBe(false);
  });
});

// ── isLockFile ─────────────────────────────────────────────────────────────────

describe('isLockFile', () => {
  it('returns true for package-lock.json', () => {
    expect(isLockFile('package-lock.json')).toBe(true);
  });

  it('returns true for yarn.lock', () => {
    expect(isLockFile('yarn.lock')).toBe(true);
  });

  it('returns true for pnpm-lock.yaml', () => {
    expect(isLockFile('pnpm-lock.yaml')).toBe(true);
  });

  it('returns true for Gemfile.lock', () => {
    expect(isLockFile('Gemfile.lock')).toBe(true);
  });

  it('returns true for Pipfile.lock', () => {
    expect(isLockFile('Pipfile.lock')).toBe(true);
  });

  it('returns true for poetry.lock', () => {
    expect(isLockFile('poetry.lock')).toBe(true);
  });

  it('returns true for composer.lock', () => {
    expect(isLockFile('composer.lock')).toBe(true);
  });

  it('returns true for Cargo.lock', () => {
    expect(isLockFile('Cargo.lock')).toBe(true);
  });

  it('returns true for go.sum', () => {
    expect(isLockFile('go.sum')).toBe(true);
  });

  it('returns true for bun.lockb', () => {
    expect(isLockFile('bun.lockb')).toBe(true);
  });

  it('returns true for lock file in subdirectory', () => {
    expect(isLockFile('apps/web/yarn.lock')).toBe(true);
  });

  it('returns false for regular file', () => {
    expect(isLockFile('src/index.ts')).toBe(false);
  });

  it('returns false for package.json', () => {
    expect(isLockFile('package.json')).toBe(false);
  });
});

// ── classifyChangedFiles – testFiles ──────────────────────────────────────────

describe('classifyChangedFiles – testFiles', () => {
  it('puts .test.ts files into testFiles', () => {
    const files = [makeFile('src/UserService.test.ts')];
    const result = classifyChangedFiles(files);
    expect(result.testFiles).toEqual(files);
  });

  it('puts .spec.ts files into testFiles', () => {
    const files = [makeFile('src/UserService.spec.ts')];
    const result = classifyChangedFiles(files);
    expect(result.testFiles).toEqual(files);
  });

  it('puts __tests__ directory files into testFiles', () => {
    const files = [makeFile('src/__tests__/auth.ts')];
    const result = classifyChangedFiles(files);
    expect(result.testFiles).toEqual(files);
  });

  it('does not put regular source files into testFiles', () => {
    const files = [makeFile('src/UserService.ts')];
    const result = classifyChangedFiles(files);
    expect(result.testFiles).toHaveLength(0);
  });
});

// ── classifyChangedFiles – configFiles ────────────────────────────────────────

describe('classifyChangedFiles – configFiles', () => {
  it('puts tsconfig.json into configFiles', () => {
    const files = [makeFile('tsconfig.json')];
    const result = classifyChangedFiles(files);
    expect(result.configFiles).toEqual(files);
  });

  it('puts docker-compose.yml into configFiles', () => {
    const files = [makeFile('docker-compose.yml')];
    const result = classifyChangedFiles(files);
    expect(result.configFiles).toEqual(files);
  });

  it('puts .env.example into configFiles', () => {
    const files = [makeFile('.env.example')];
    const result = classifyChangedFiles(files);
    expect(result.configFiles).toEqual(files);
  });

  it('puts .github/workflows/ci.yml into configFiles', () => {
    const files = [makeFile('.github/workflows/ci.yml')];
    const result = classifyChangedFiles(files);
    expect(result.configFiles).toEqual(files);
  });

  it('puts package.json into configFiles', () => {
    const files = [makeFile('package.json')];
    const result = classifyChangedFiles(files);
    expect(result.configFiles).toEqual(files);
  });

  it('puts vitest.config.ts into configFiles', () => {
    const files = [makeFile('vitest.config.ts')];
    const result = classifyChangedFiles(files);
    expect(result.configFiles).toEqual(files);
  });

  it('puts .eslintrc.json into configFiles', () => {
    const files = [makeFile('.eslintrc.json')];
    const result = classifyChangedFiles(files);
    expect(result.configFiles).toEqual(files);
  });

  it('puts Dockerfile into configFiles', () => {
    const files = [makeFile('Dockerfile')];
    const result = classifyChangedFiles(files);
    expect(result.configFiles).toEqual(files);
  });
});

// ── classifyChangedFiles – migrationFiles ─────────────────────────────────────

describe('classifyChangedFiles – migrationFiles', () => {
  it('puts a .sql file with timestamp prefix into migrationFiles', () => {
    const files = [makeFile('20240101_add_users.sql')];
    const result = classifyChangedFiles(files);
    expect(result.migrationFiles).toEqual(files);
  });

  it('puts a file in /migrations/ into migrationFiles', () => {
    const files = [makeFile('db/migrations/002_add_email_index.ts')];
    const result = classifyChangedFiles(files);
    expect(result.migrationFiles).toEqual(files);
  });

  it('puts a V1__ flyway-style file into migrationFiles', () => {
    const files = [makeFile('V1__create_users_table.sql')];
    const result = classifyChangedFiles(files);
    expect(result.migrationFiles).toEqual(files);
  });

  it('puts any .sql file into migrationFiles', () => {
    const files = [makeFile('queries/seed_data.sql')];
    const result = classifyChangedFiles(files);
    expect(result.migrationFiles).toEqual(files);
  });

  it('does not put a .ts file (no migration indicators) into migrationFiles', () => {
    const files = [makeFile('src/utils/helper.ts')];
    const result = classifyChangedFiles(files);
    expect(result.migrationFiles).toHaveLength(0);
  });
});

// ── classifyChangedFiles – lockFiles ──────────────────────────────────────────

describe('classifyChangedFiles – lockFiles', () => {
  it('puts package-lock.json into lockFiles', () => {
    const files = [makeFile('package-lock.json')];
    const result = classifyChangedFiles(files);
    expect(result.lockFiles).toEqual(files);
  });

  it('puts yarn.lock into lockFiles', () => {
    const files = [makeFile('yarn.lock')];
    const result = classifyChangedFiles(files);
    expect(result.lockFiles).toEqual(files);
  });

  it('puts go.sum into lockFiles', () => {
    const files = [makeFile('go.sum')];
    const result = classifyChangedFiles(files);
    expect(result.lockFiles).toEqual(files);
  });

  it('does not put package.json into lockFiles', () => {
    const files = [makeFile('package.json')];
    const result = classifyChangedFiles(files);
    expect(result.lockFiles).toHaveLength(0);
  });
});

// ── classifyChangedFiles – generatedFiles ─────────────────────────────────────

describe('classifyChangedFiles – generatedFiles', () => {
  it('puts a file in /dist/ into generatedFiles', () => {
    const files = [makeFile('dist/index.js')];
    const result = classifyChangedFiles(files);
    expect(result.generatedFiles).toEqual(files);
  });

  it('puts a .min.js file into generatedFiles', () => {
    const files = [makeFile('public/vendor.min.js')];
    const result = classifyChangedFiles(files);
    expect(result.generatedFiles).toEqual(files);
  });

  it('puts a file in /__generated__/ into generatedFiles', () => {
    const files = [makeFile('src/__generated__/graphql.ts')];
    const result = classifyChangedFiles(files);
    expect(result.generatedFiles).toEqual(files);
  });

  it('does not put a regular ts file into generatedFiles', () => {
    const files = [makeFile('src/utils/helper.ts')];
    const result = classifyChangedFiles(files);
    expect(result.generatedFiles).toHaveLength(0);
  });
});

// ── classifyChangedFiles – documentationFiles ─────────────────────────────────

describe('classifyChangedFiles – documentationFiles', () => {
  it('puts a .md file into documentationFiles', () => {
    const files = [makeFile('README.md')];
    const result = classifyChangedFiles(files);
    expect(result.documentationFiles).toEqual(files);
  });

  it('puts a .mdx file into documentationFiles', () => {
    const files = [makeFile('docs/guide.mdx')];
    const result = classifyChangedFiles(files);
    expect(result.documentationFiles).toEqual(files);
  });

  it('puts a .rst file into documentationFiles', () => {
    const files = [makeFile('docs/api.rst')];
    const result = classifyChangedFiles(files);
    expect(result.documentationFiles).toEqual(files);
  });

  it('does not put a .ts file into documentationFiles', () => {
    const files = [makeFile('src/utils/helper.ts')];
    const result = classifyChangedFiles(files);
    expect(result.documentationFiles).toHaveLength(0);
  });
});

// ── classifyChangedFiles – backendFiles ───────────────────────────────────────

describe('classifyChangedFiles – backendFiles', () => {
  it('puts file in /api/controllers/ into backendFiles', () => {
    const files = [makeFile('src/api/controllers/UserController.ts')];
    const result = classifyChangedFiles(files);
    expect(result.backendFiles).toContainEqual(files[0]);
  });

  it('puts a file with Service.ts suffix in /services/ into backendFiles', () => {
    const files = [makeFile('src/services/UserService.ts')];
    const result = classifyChangedFiles(files);
    expect(result.backendFiles).toContainEqual(files[0]);
  });

  it('puts a .go file into backendFiles', () => {
    const files = [makeFile('cmd/server/main.go')];
    const result = classifyChangedFiles(files);
    expect(result.backendFiles).toContainEqual(files[0]);
  });

  it('puts a .py file into backendFiles', () => {
    const files = [makeFile('app/views.py')];
    const result = classifyChangedFiles(files);
    expect(result.backendFiles).toContainEqual(files[0]);
  });

  it('puts a file with lowercase controller in name into backendFiles', () => {
    const files = [makeFile('src/userController.ts')];
    const result = classifyChangedFiles(files);
    expect(result.backendFiles).toContainEqual(files[0]);
  });
});

// ── classifyChangedFiles – frontendFiles ──────────────────────────────────────

describe('classifyChangedFiles – frontendFiles', () => {
  it('puts a .tsx file into frontendFiles', () => {
    const files = [makeFile('src/components/Button.tsx')];
    const result = classifyChangedFiles(files);
    expect(result.frontendFiles).toContainEqual(files[0]);
  });

  it('puts a file in /components/ into frontendFiles', () => {
    const files = [makeFile('src/components/Card.ts')];
    const result = classifyChangedFiles(files);
    expect(result.frontendFiles).toContainEqual(files[0]);
  });

  it('puts a .scss file into frontendFiles', () => {
    const files = [makeFile('src/styles/main.scss')];
    const result = classifyChangedFiles(files);
    expect(result.frontendFiles).toContainEqual(files[0]);
  });

  it('puts a .jsx file into frontendFiles', () => {
    const files = [makeFile('src/App.jsx')];
    const result = classifyChangedFiles(files);
    expect(result.frontendFiles).toContainEqual(files[0]);
  });

  it('puts file in /pages/ into frontendFiles', () => {
    const files = [makeFile('src/pages/Home.ts')];
    const result = classifyChangedFiles(files);
    expect(result.frontendFiles).toContainEqual(files[0]);
  });

  it('does not put a plain .ts backend file into frontendFiles', () => {
    const files = [makeFile('src/utils/stringUtils.ts')];
    const result = classifyChangedFiles(files);
    expect(result.frontendFiles).toHaveLength(0);
  });
});

// ── classifyChangedFiles – sourceFiles ────────────────────────────────────────

describe('classifyChangedFiles – sourceFiles', () => {
  it('puts a plain .ts file into sourceFiles', () => {
    const files = [makeFile('src/utils/stringUtils.ts')];
    const result = classifyChangedFiles(files);
    expect(result.sourceFiles).toEqual(files);
  });

  it('does not put test files into sourceFiles', () => {
    const files = [makeFile('src/utils/stringUtils.test.ts')];
    const result = classifyChangedFiles(files);
    expect(result.sourceFiles).toHaveLength(0);
  });

  it('does not put config files into sourceFiles', () => {
    const files = [makeFile('tsconfig.json')];
    const result = classifyChangedFiles(files);
    expect(result.sourceFiles).toHaveLength(0);
  });

  it('does not put migration files into sourceFiles', () => {
    const files = [makeFile('db/migrations/001_init.sql')];
    const result = classifyChangedFiles(files);
    expect(result.sourceFiles).toHaveLength(0);
  });

  it('does not put lock files into sourceFiles', () => {
    const files = [makeFile('yarn.lock')];
    const result = classifyChangedFiles(files);
    expect(result.sourceFiles).toHaveLength(0);
  });

  it('does not put generated files into sourceFiles', () => {
    const files = [makeFile('dist/bundle.js')];
    const result = classifyChangedFiles(files);
    expect(result.sourceFiles).toHaveLength(0);
  });

  it('frontend and backend files appear in sourceFiles (they are subsets)', () => {
    const frontend = makeFile('src/components/Button.tsx');
    const backend = makeFile('src/services/UserService.ts');
    const result = classifyChangedFiles([frontend, backend]);
    expect(result.sourceFiles).toContainEqual(frontend);
    expect(result.sourceFiles).toContainEqual(backend);
  });
});

// ── classifyChangedFiles – riskyFiles ─────────────────────────────────────────

describe('classifyChangedFiles – riskyFiles', () => {
  it('gives deleted_file reason to a deleted file', () => {
    const file = makeFile('src/utils/helper.ts', 'deleted');
    const result = classifyChangedFiles([file]);
    expect(result.riskyFiles).toHaveLength(1);
    expect(result.riskyFiles[0].reasons).toContain('deleted_file');
  });

  it('gives config_or_environment reason to a .env file', () => {
    const file = makeFile('.env', 'added');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('config_or_environment');
  });

  it('gives auth_or_permissions reason to a file with "auth" in path', () => {
    const file = makeFile('src/auth/authService.ts', 'modified');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('auth_or_permissions');
  });

  it('gives auth_or_permissions reason to a file with "jwt" in path', () => {
    const file = makeFile('src/utils/jwtHelper.ts', 'modified');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('auth_or_permissions');
  });

  it('gives payment_or_financial reason to a file with "payment" in path', () => {
    const file = makeFile('src/services/paymentService.ts', 'modified');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('payment_or_financial');
  });

  it('gives payment_or_financial reason to a file with "stripe" in path', () => {
    const file = makeFile('src/integrations/stripeWebhook.ts', 'added');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('payment_or_financial');
  });

  it('gives dependency_update reason to modified package.json', () => {
    const file = makeFile('package.json', 'modified');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('dependency_update');
  });

  it('does NOT give dependency_update reason to added package.json', () => {
    const file = makeFile('package.json', 'added');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    if (risky) {
      expect(risky.reasons).not.toContain('dependency_update');
    }
  });

  it('gives lock_file reason to a lock file', () => {
    const file = makeFile('yarn.lock', 'modified');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('lock_file');
  });

  it('gives database_migration reason to a migration file', () => {
    const file = makeFile('db/migrations/001_create_users.sql');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('database_migration');
  });

  it('gives large_generated_file reason to a file in /dist/', () => {
    const file = makeFile('dist/bundle.js', 'added');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('large_generated_file');
  });

  it('gives config_or_environment reason to a Dockerfile', () => {
    const file = makeFile('Dockerfile', 'modified');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('config_or_environment');
  });

  it('does not flag a plain source file as risky', () => {
    const file = makeFile('src/utils/stringUtils.ts', 'added');
    const result = classifyChangedFiles([file]);
    expect(result.riskyFiles).toHaveLength(0);
  });
});

// ── classifyChangedFiles – multi-category membership ─────────────────────────

describe('classifyChangedFiles – multi-category membership', () => {
  it('a payment .tsx component is both frontend and risky', () => {
    const file = makeFile('src/components/PaymentForm.tsx', 'added');
    const result = classifyChangedFiles([file]);
    expect(result.frontendFiles).toContainEqual(file);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('payment_or_financial');
  });

  it('an auth service in /services/ is both backend and risky', () => {
    const file = makeFile('src/services/authService.ts', 'modified');
    const result = classifyChangedFiles([file]);
    expect(result.backendFiles).toContainEqual(file);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('auth_or_permissions');
  });

  it('a deleted auth file accumulates both deleted_file and auth_or_permissions reasons', () => {
    const file = makeFile('src/auth/tokenManager.ts', 'deleted');
    const result = classifyChangedFiles([file]);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('deleted_file');
    expect(risky!.reasons).toContain('auth_or_permissions');
  });

  it('a migration .sql file is in both migrationFiles and riskyFiles', () => {
    const file = makeFile('db/migrations/001_init.sql', 'added');
    const result = classifyChangedFiles([file]);
    expect(result.migrationFiles).toContainEqual(file);
    const risky = result.riskyFiles.find(r => r.file === file);
    expect(risky).toBeDefined();
    expect(risky!.reasons).toContain('database_migration');
  });

  it('handles an empty file list gracefully', () => {
    const result = classifyChangedFiles([]);
    expect(result.testFiles).toHaveLength(0);
    expect(result.configFiles).toHaveLength(0);
    expect(result.migrationFiles).toHaveLength(0);
    expect(result.lockFiles).toHaveLength(0);
    expect(result.generatedFiles).toHaveLength(0);
    expect(result.documentationFiles).toHaveLength(0);
    expect(result.sourceFiles).toHaveLength(0);
    expect(result.riskyFiles).toHaveLength(0);
    expect(result.backendFiles).toHaveLength(0);
    expect(result.frontendFiles).toHaveLength(0);
  });
});
