// ── Delivery Intelligence Layer — Project Pattern Memory Tools ────────────────
// Three MCP tool handlers for scanning, retrieving, and clearing local project
// pattern memory. No I/O to external services.

import { scanProjectPatterns, type ProjectPatterns } from '../projectPatterns/projectPatternScanner.js';
import {
  savePatterns,
  loadPatterns,
  clearPatterns,
} from '../projectPatterns/projectPatternStore.js';

// ── Formatting helper ─────────────────────────────────────────────────────────

function formatPatterns(patterns: ProjectPatterns, savedStatus?: { saved: boolean; reason?: string }): string {
  const lines: string[] = [];

  lines.push(`# Project Pattern Scan: ${patterns.repoPath}`);
  lines.push('');
  lines.push(`> Scanned: ${patterns.scannedAt}`);
  lines.push('');

  // Tech Stack
  lines.push('## Tech Stack');
  if (patterns.techStack.length > 0) {
    lines.push(`- ${patterns.techStack.join(', ')}`);
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // Module Names
  lines.push('## Module Names');
  if (patterns.moduleNames.length > 0) {
    lines.push(`- ${patterns.moduleNames.join(', ')}`);
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // Test Locations
  lines.push('## Test Locations');
  if (patterns.testLocations.length > 0) {
    for (const loc of patterns.testLocations) {
      lines.push(`- ${loc}`);
    }
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // Naming Conventions
  lines.push('## Naming Conventions');
  if (patterns.namingConventions.length > 0) {
    for (const convention of patterns.namingConventions) {
      lines.push(`- ${convention}`);
    }
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // API Structure
  lines.push('## API Structure');
  if (patterns.apiStructure.length > 0) {
    for (const item of patterns.apiStructure) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // Component Patterns
  lines.push('## Component Patterns');
  if (patterns.componentPatterns.length > 0) {
    for (const item of patterns.componentPatterns) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // Permission Patterns
  lines.push('## Permission Patterns');
  if (patterns.permissionPatterns.length > 0) {
    for (const item of patterns.permissionPatterns) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // Validation Patterns
  lines.push('## Validation Patterns');
  if (patterns.validationPatterns.length > 0) {
    for (const item of patterns.validationPatterns) {
      lines.push(`- ${item}`);
    }
  } else {
    lines.push('*(none detected)*');
  }
  lines.push('');

  // Pattern Memory status
  lines.push('## Pattern Memory');
  if (savedStatus === undefined) {
    // Loaded from file — no save status to report
    lines.push('Loaded from persisted pattern file.');
  } else if (savedStatus.saved) {
    lines.push('Patterns saved to local pattern file.');
  } else {
    lines.push(
      `Disabled — ${savedStatus.reason ?? 'set DELIVERY_PATTERN_MEMORY_ENABLED=true to persist patterns.'}`,
    );
  }

  return lines.join('\n');
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

export async function deliveryScanProjectPatterns(input: {
  issueKey?: string;
  repoPath: string;
}): Promise<string> {
  const patterns = scanProjectPatterns(input.repoPath);
  const savedStatus = savePatterns(input.repoPath, patterns);
  return formatPatterns(patterns, savedStatus);
}

export async function deliveryGetProjectPatterns(input: {
  repoPath: string;
}): Promise<string> {
  const patterns = loadPatterns(input.repoPath);

  if (patterns === null) {
    const isEnabled = process.env['DELIVERY_PATTERN_MEMORY_ENABLED'] === 'true';
    if (!isEnabled) {
      return [
        '# Project Pattern Memory',
        '',
        'Pattern memory is disabled.',
        '',
        'Set `DELIVERY_PATTERN_MEMORY_ENABLED=true` and run `delivery_scan_project_patterns` to scan and persist patterns.',
      ].join('\n');
    }
    return [
      '# Project Pattern Memory',
      '',
      `No pattern file found for: ${input.repoPath}`,
      '',
      'Run `delivery_scan_project_patterns` first to scan and persist patterns.',
    ].join('\n');
  }

  return formatPatterns(patterns);
}

export async function deliveryClearProjectPatterns(input: {
  repoPath: string;
}): Promise<string> {
  const result = clearPatterns(input.repoPath);

  if (result.cleared) {
    return `Pattern memory cleared for: ${input.repoPath}`;
  }

  return result.reason ?? 'No pattern file found.';
}
