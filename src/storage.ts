import type { Collection, HistoryFile } from './types.js';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  renameSync,
} from 'node:fs';
import { dirname } from 'node:path';

function emptyHistory(): HistoryFile {
  return { version: 1, collections: [] };
}

export function readHistory(filePath: string): HistoryFile {
  if (!existsSync(filePath)) {
    mkdirSync(dirname(filePath), { recursive: true });
    return emptyHistory();
  }

  const raw = readFileSync(filePath, 'utf-8').trim();
  if (!raw) return emptyHistory();

  try {
    const data = JSON.parse(raw) as HistoryFile;
    if (data.version === 1 && Array.isArray(data.collections)) {
      return data;
    }
    return emptyHistory();
  } catch {
    // Malformed JSON -- backup and recreate
    copyFileSync(filePath, filePath + '.backup');
    return emptyHistory();
  }
}

export function appendCollection(
  filePath: string,
  collection: Collection,
): void {
  const history = readHistory(filePath);
  history.collections.push(collection);

  // Atomic write: write to tmp, then rename
  const tmpPath = filePath + '.tmp';
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmpPath, JSON.stringify(history, null, 2));
  renameSync(tmpPath, filePath);
}
