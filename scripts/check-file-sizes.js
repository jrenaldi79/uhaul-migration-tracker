#!/usr/bin/env node

/**
 * File size enforcement script for pre-commit hook.
 * Blocks commits containing .ts files in src/ that exceed the line limit.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const CONFIG = {
  maxLines: 300,
  include: ['src/**/*.ts'],
  exclude: [],
};

function checkFileSize(content, filePath, limit) {
  const lineCount = content.split('\n').length;
  const adjustedCount = content.endsWith('\n') ? lineCount - 1 : lineCount;

  if (adjustedCount > limit) {
    return { file: filePath, lines: adjustedCount, limit };
  }
  return null;
}

function matchesPattern(filePath, patterns) {
  for (const pattern of patterns) {
    const regexStr = pattern
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/]*')
      .replace(/<<GLOBSTAR>>/g, '.*');
    if (new RegExp('^' + regexStr + '$').test(filePath)) {
      return true;
    }
  }
  return false;
}

function main() {
  let stagedFiles;
  try {
    const output = execFileSync(
      'git',
      ['diff', '--cached', '--name-only', '--diff-filter=ACM'],
      { encoding: 'utf-8' }
    );
    stagedFiles = output.trim().split('\n').filter(Boolean);
  } catch {
    console.error('Failed to get staged files.');
    process.exit(1);
  }

  const targetFiles = stagedFiles.filter(f =>
    matchesPattern(f, CONFIG.include) && !matchesPattern(f, CONFIG.exclude)
  );

  if (targetFiles.length === 0) {
    process.exit(0);
  }

  const violations = [];
  for (const f of targetFiles) {
    try {
      const content = readFileSync(resolve(f), 'utf-8');
      const result = checkFileSize(content, f, CONFIG.maxLines);
      if (result) {
        violations.push(result);
      }
    } catch {
      // skip unreadable
    }
  }

  if (violations.length > 0) {
    console.error(
      '\n  BLOCKED: File size limit exceeded (max ' + CONFIG.maxLines + ' lines):'
    );
    for (const v of violations) {
      console.error('    ' + v.file + ': ' + v.lines + ' lines (limit: ' + v.limit + ')');
    }
    console.error('\n  Refactor large files before committing.\n');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes('check-file-sizes')) {
  main();
}

module.exports = { checkFileSize, matchesPattern };
