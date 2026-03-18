import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readHistory, appendCollection } from '../src/storage.js';
import type { Collection, HistoryFile } from '../src/types.js';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TEST_DIR = join(import.meta.dirname, '../data/test-storage');
const TEST_FILE = join(TEST_DIR, 'history.json');

function makeCollection(date: string): Collection {
  return {
    date,
    timestamp: date + 'T07:00:00Z',
    durationMs: 180000,
    routesAttempted: 14,
    routesSucceeded: 14,
    routes: [],
    corridors: [],
  };
}

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe('readHistory', () => {
  it('creates history file if it does not exist', () => {
    const result = readHistory(TEST_FILE);
    expect(result.version).toBe(1);
    expect(result.collections).toEqual([]);
  });

  it('reads back valid history', () => {
    const data: HistoryFile = {
      version: 1,
      collections: [makeCollection('2026-03-17')],
    };
    writeFileSync(TEST_FILE, JSON.stringify(data));
    const result = readHistory(TEST_FILE);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].date).toBe('2026-03-17');
  });

  it('handles empty file gracefully', () => {
    writeFileSync(TEST_FILE, '');
    const result = readHistory(TEST_FILE);
    expect(result.version).toBe(1);
    expect(result.collections).toEqual([]);
  });

  it('handles malformed JSON gracefully with backup', () => {
    writeFileSync(TEST_FILE, '{broken json!!!');
    const result = readHistory(TEST_FILE);
    expect(result.version).toBe(1);
    expect(result.collections).toEqual([]);
    expect(existsSync(TEST_FILE + '.backup')).toBe(true);
  });
});

describe('appendCollection', () => {
  it('appends to empty history', () => {
    const collection = makeCollection('2026-03-17');
    appendCollection(TEST_FILE, collection);
    const result = readHistory(TEST_FILE);
    expect(result.collections).toHaveLength(1);
    expect(result.collections[0].date).toBe('2026-03-17');
  });

  it('appends without corrupting existing data', () => {
    const c1 = makeCollection('2026-03-17');
    const c2 = makeCollection('2026-03-18');
    appendCollection(TEST_FILE, c1);
    appendCollection(TEST_FILE, c2);
    const result = readHistory(TEST_FILE);
    expect(result.collections).toHaveLength(2);
    expect(result.collections[0].date).toBe('2026-03-17');
    expect(result.collections[1].date).toBe('2026-03-18');
  });
});
