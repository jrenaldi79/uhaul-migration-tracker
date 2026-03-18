import express from 'express';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHistory } from './storage.js';
import type { AppConfig } from './types.js';
import { log } from './utils.js';

const ROOT = join(import.meta.dirname, '..');
const CONFIG_PATH = join(ROOT, 'config.json');
const DATA_PATH = join(ROOT, 'data', 'history.json');
const PUBLIC_PATH = join(ROOT, 'public');

const config: AppConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
const app = express();

app.use(express.static(PUBLIC_PATH));

// Full history
app.get('/api/data', (_req, res) => {
  const history = readHistory(DATA_PATH);
  res.json(history);
});

// Most recent collection
app.get('/api/latest', (_req, res) => {
  const history = readHistory(DATA_PATH);
  const latest = history.collections[history.collections.length - 1] ?? null;
  res.json(latest);
});

// Corridor time series (optimized for charting)
app.get('/api/corridors', (_req, res) => {
  const history = readHistory(DATA_PATH);
  const corridorNames = config.corridors.map((c) => c.name);

  const series: Record<string, { date: string; mpi: number | null; normalizedMpi: number | null }[]> = {};
  for (const name of corridorNames) {
    series[name] = [];
  }

  for (const collection of history.collections) {
    for (const corridor of collection.corridors) {
      if (series[corridor.name]) {
        series[corridor.name].push({
          date: collection.date,
          mpi: corridor.mpi,
          normalizedMpi: corridor.normalizedMpi,
        });
      }
    }
  }

  res.json(series);
});

// Health check
app.get('/health', (_req, res) => {
  const history = readHistory(DATA_PATH);
  const latest = history.collections[history.collections.length - 1];
  res.json({
    status: 'ok',
    lastCollection: latest?.date ?? null,
    dataPoints: history.collections.length,
  });
});

const port = config.dashboard.port;
app.listen(port, () => {
  log('server', 'Dashboard running at http://localhost:' + port);
});
