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
  if (!raw) {return emptyHistory();}

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
  atomicWrite(filePath, history);
}

/**
 * Upsert: if a collection with the same date exists, merge routes and corridors
 * into it (keeping the most complete version). Otherwise append.
 * This allows incremental saves that survive crashes.
 */
export function upsertCollection(
  filePath: string,
  collection: Collection,
): void {
  const history = readHistory(filePath);
  const idx = history.collections.findIndex((c) => c.date === collection.date);

  if (idx === -1) {
    history.collections.push(collection);
  } else {
    const existing = history.collections[idx];
    // Merge routes: keep existing successful routes, add/replace with new ones
    for (const route of collection.routes) {
      const key = `${route.from}|${route.to}`;
      const existingIdx = existing.routes.findIndex(
        (r) => `${r.from}|${r.to}` === key,
      );
      // Replace if new route succeeded or existing didn't exist
      if (existingIdx === -1) {
        existing.routes.push(route);
      } else if (route.trucks.length > 0) {
        existing.routes[existingIdx] = route;
      }
    }
    // Merge corridor summaries: replace with newer data
    for (const corridor of collection.corridors) {
      const cIdx = existing.corridors.findIndex((c) => c.name === corridor.name);
      if (cIdx === -1) {
        existing.corridors.push(corridor);
      } else {
        existing.corridors[cIdx] = corridor;
      }
    }
    // Update metadata
    existing.routesAttempted = Math.max(existing.routesAttempted, collection.routesAttempted);
    existing.routesSucceeded = existing.routes.filter((r) => r.error === null).length;
    existing.durationMs = collection.durationMs;
    existing.timestamp = collection.timestamp;
  }

  atomicWrite(filePath, history);
}

function atomicWrite(filePath: string, history: HistoryFile): void {
  const tmpPath = filePath + '.tmp';
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(tmpPath, JSON.stringify(history, null, 2));
  renameSync(tmpPath, filePath);
}
