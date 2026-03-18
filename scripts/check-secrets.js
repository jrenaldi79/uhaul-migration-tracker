#!/usr/bin/env node

/**
 * Secret detection script for pre-commit hook.
 * Scans staged files for API keys, tokens, and private key material.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const CONFIG = {
  patterns: [
    { regex: /sk-or-[\w-]{3,}/g, name: 'sk-or-', description: 'OpenRouter API key' },
    { regex: /sk-ant-[\w-]{3,}/g, name: 'sk-ant-', description: 'Anthropic API key' },
    { regex: /AKIA[0-9A-Z]{16}/g, name: 'AKIA', description: 'AWS access key' },
    { regex: /ghp_[A-Za-z0-9_]{10,}/g, name: 'ghp_', description: 'GitHub personal access token' },
    { regex: /-----BEGIN\s[\w\s]*?PRIVATE\sKEY-----/g, name: 'BEGIN.*KEY', description: 'Private key block' },
  ],
  allowlistPaths: [
    'tests/**',
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/*.md',
    'docs/**',
  ],
};

function matchesAllowlist(filePath, allowlistPaths) {
  for (const pattern of allowlistPaths) {
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

function scanForSecrets(content, filePath, options = {}) {
  const allowlist = options.allowlistPaths || CONFIG.allowlistPaths;
  if (matchesAllowlist(filePath, allowlist)) {
    return [];
  }

  const results = [];
  const lines = content.split('\n');

  for (const { regex, name, description } of CONFIG.patterns) {
    const re = new RegExp(regex.source, regex.flags);
    for (let i = 0; i < lines.length; i++) {
      if (re.test(lines[i])) {
        results.push({ pattern: name, description, line: i + 1 });
      }
      re.lastIndex = 0;
    }
  }

  return results;
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
    console.error('Failed to get staged files. Are you in a git repo?');
    process.exit(1);
  }

  if (stagedFiles.length === 0) {
    process.exit(0);
  }

  let foundSecrets = false;

  for (const file of stagedFiles) {
    try {
      const fullPath = resolve(file);
      const content = readFileSync(fullPath, 'utf-8');
      const secrets = scanForSecrets(content, file);

      if (secrets.length > 0) {
        foundSecrets = true;
        console.error('\n  BLOCKED: Potential secret(s) in ' + file + ':');
        for (const s of secrets) {
          console.error('    Line ' + s.line + ': ' + s.description + ' (matched: ' + s.pattern + ')');
        }
      }
    } catch {
      // File might be binary or unreadable, skip
    }
  }

  if (foundSecrets) {
    console.error('\n  Remove secrets before committing. Use .env for local secrets.\n');
    process.exit(1);
  }
}

if (process.argv[1] && process.argv[1].includes('check-secrets')) {
  main();
}

module.exports = { scanForSecrets, matchesAllowlist };
