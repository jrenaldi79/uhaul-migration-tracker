#!/usr/bin/env node

/**
 * CLAUDE.md drift detection script.
 *
 * Two modes:
 * 1. Pre-commit (default): Warn if src/ files changed but CLAUDE.md didn't
 * 2. Standalone (--full): Deep comparison of CLAUDE.md against actual codebase
 *
 * NOTE: Uses execFileSync (not exec) throughout - no shell injection risk.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const { readdirSync, readFileSync } = require('node:fs');
const { resolve, basename } = require('node:path');

const CONFIG = {
  docFile: 'CLAUDE.md',
  trackedDirs: ['src/', 'scripts/'],
  mappings: [
    { section: 'Directory Structure', dirs: ['src/', 'scripts/', 'tests/'] },
    { section: 'Key Modules', dir: 'src/', pattern: /\.ts$/ },
  ],
};

function extractSection(markdown, heading) {
  const lines = markdown.split('\n');
  let inSection = false;
  let sectionLevel = 0;
  const result = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      if (text === heading) {
        inSection = true;
        sectionLevel = level;
        continue;
      } else if (inSection && level <= sectionLevel) {
        break;
      }
    }
    if (inSection) {
      result.push(line);
    }
  }

  return result.join('\n').trim();
}

function findFilesInSection(section) {
  const files = new Set();
  const regex = /[\w/.-]*?([\w.-]+\.ts)\b/g;
  let match;
  while ((match = regex.exec(section)) !== null) {
    files.add(match[1]);
  }
  return [...files];
}

function checkDrift(docFiles, diskFiles) {
  const docSet = new Set(docFiles);
  const diskSet = new Set(diskFiles);

  const missingFromDocs = diskFiles.filter(f => !docSet.has(f));
  const missingFromDisk = docFiles.filter(f => !diskSet.has(f));

  return { missingFromDocs, missingFromDisk };
}

function checkStagedFilesDrift(stagedFiles) {
  const claudeMdStaged = stagedFiles.some(
    f => basename(f) === 'CLAUDE.md'
  );
  const trackedChanges = stagedFiles.filter(f =>
    CONFIG.trackedDirs.some(dir => f.startsWith(dir))
  );

  if (trackedChanges.length > 0 && !claudeMdStaged) {
    return { warn: true, changedFiles: trackedChanges };
  }
  return { warn: false, changedFiles: [] };
}

function runFullAnalysis() {
  const docPath = resolve(CONFIG.docFile);
  let markdown;
  try {
    markdown = readFileSync(docPath, 'utf-8');
  } catch {
    console.error('Cannot read ' + CONFIG.docFile);
    process.exit(1);
  }

  let hasIssues = false;

  for (const mapping of CONFIG.mappings) {
    const section = extractSection(markdown, mapping.section);
    if (!section) {
      console.warn('  Warning: Section "' + mapping.section + '" not found in ' + CONFIG.docFile);
      continue;
    }

    const docFiles = findFilesInSection(section);
    const dirs = mapping.dirs || [mapping.dir];
    const diskFiles = [];
    for (const dir of dirs) {
      try {
        const entries = readdirSync(resolve(dir), { withFileTypes: true });
        for (const entry of entries) {
          if (
            entry.isFile() &&
            (!mapping.pattern || mapping.pattern.test(entry.name))
          ) {
            diskFiles.push(entry.name);
          }
        }
      } catch {
        // Directory might not exist
      }
    }

    const drift = checkDrift(docFiles, diskFiles);

    if (drift.missingFromDocs.length > 0) {
      hasIssues = true;
      console.warn('\n  "' + mapping.section + '" is missing files that exist on disk:');
      for (const f of drift.missingFromDocs) {
        console.warn('    + ' + f + ' (exists but not documented)');
      }
    }

    if (drift.missingFromDisk.length > 0) {
      hasIssues = true;
      console.warn('\n  "' + mapping.section + '" references files that don\'t exist:');
      for (const f of drift.missingFromDisk) {
        console.warn('    - ' + f + ' (documented but missing)');
      }
    }
  }

  if (hasIssues) {
    console.warn('\n  Update CLAUDE.md to fix drift.\n');
    process.exit(1);
  } else {
    console.log('  CLAUDE.md is in sync with the codebase.');
  }
}

function runPreCommitCheck() {
  let stagedFiles;
  try {
    // execFileSync is safe - no shell interpolation
    const output = execFileSync(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=ACMR'],
      { encoding: 'utf-8' }
    );
    stagedFiles = output.trim().split('\n').filter(Boolean);
  } catch {
    process.exit(0);
  }

  if (stagedFiles.length === 0) {
    process.exit(0);
  }

  const result = checkStagedFilesDrift(stagedFiles);

  if (result.warn) {
    console.warn('\n  Warning: CLAUDE.md may need updating. Changed files in tracked dirs:');
    for (const f of result.changedFiles) {
      console.warn('    ' + f);
    }
    console.warn('  Run `node scripts/validate-docs.js --full` to check for drift.\n');
  }
}

function main() {
  const fullMode = process.argv.includes('--full');
  if (fullMode) {
    runFullAnalysis();
  } else {
    runPreCommitCheck();
  }
}

if (require.main === module) {
  main();
}

module.exports = { extractSection, findFilesInSection, checkDrift, checkStagedFilesDrift };
