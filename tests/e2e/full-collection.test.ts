import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, unlinkSync, copyFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HistoryFile } from '../../src/types.js';

const ROOT = join(import.meta.dirname, '../..');
const DATA_PATH = join(ROOT, 'data', 'history.json');
const BACKUP_PATH = DATA_PATH + '.e2e-backup';

describe('full collection E2E', () => {
  // Backup existing history before test
  const hadExistingData = existsSync(DATA_PATH);
  if (hadExistingData) {
    copyFileSync(DATA_PATH, BACKUP_PATH);
  }

  afterAll(() => {
    // Restore backup if it existed
    if (existsSync(BACKUP_PATH)) {
      copyFileSync(BACKUP_PATH, DATA_PATH);
      unlinkSync(BACKUP_PATH);
    }
  });

  it('runs the collector and produces valid history.json', () => {
    // Remove existing data so we get a clean run
    if (existsSync(DATA_PATH)) {
      unlinkSync(DATA_PATH);
    }

    // Run the collector (headless)
    let exitCode = 0;
    let stdout = '';
    try {
      stdout = execFileSync('npx', ['tsx', 'src/collector.ts'], {
        cwd: ROOT,
        encoding: 'utf-8',
        timeout: 600000, // 10 minute timeout
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err: unknown) {
      const execErr = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = execErr.status ?? 1;
      stdout = execErr.stdout ?? '';
      console.error('Collector stderr:', execErr.stderr);
    }

    console.log('Collector output:\n', stdout);

    // Should have collected at least some routes (allow partial success)
    // Exit code 0 = at least 1 route succeeded
    // Exit code 1 = all routes failed
    expect(exitCode).toBe(0);

    // history.json should exist now
    expect(existsSync(DATA_PATH)).toBe(true);

    // Parse and validate
    const raw = readFileSync(DATA_PATH, 'utf-8');
    const history: HistoryFile = JSON.parse(raw);

    expect(history.version).toBe(1);
    expect(history.collections).toHaveLength(1);

    const collection = history.collections[0];

    // Should have attempted all 14 routes
    expect(collection.routesAttempted).toBe(14);

    // At least some routes should have succeeded
    expect(collection.routesSucceeded).toBeGreaterThan(0);
    console.log(`Routes: ${collection.routesSucceeded}/${collection.routesAttempted} succeeded`);

    // Should have route results
    expect(collection.routes.length).toBe(14);

    // Each successful route should have trucks
    const successfulRoutes = collection.routes.filter(r => r.error === null);
    for (const route of successfulRoutes) {
      expect(route.trucks.length).toBeGreaterThan(0);
      expect(route.referencePrice).not.toBeNull();
      expect(route.referenceTruck).toBeTruthy();
      expect(route.source).toBe('playwright');

      // Prices should be reasonable
      for (const truck of route.trucks) {
        expect(truck.price).toBeGreaterThan(30);
        expect(truck.price).toBeLessThan(5000);
        expect(truck.name).toContain("'");
      }
    }

    // Should have corridor summaries
    expect(collection.corridors).toHaveLength(7);

    for (const corridor of collection.corridors) {
      expect(corridor.name).toBeTruthy();
      expect(corridor.label).toBeTruthy();
      expect(corridor.signalSource).toMatch(/^(flat_threshold|corridor_baseline)$/);

      // Baseline should be inactive (first collection, < 14 data points)
      expect(corridor.baseline.active).toBe(false);
      expect(corridor.baseline.dataPoints).toBeLessThanOrEqual(1);

      // Seasonal should be null (no historical data)
      expect(corridor.seasonalFactor).toBeNull();
      expect(corridor.normalizedMpi).toBeNull();

      // If both prices exist, MPI should be computed
      if (corridor.outboundPrice !== null && corridor.inboundPrice !== null) {
        expect(corridor.mpi).not.toBeNull();
        expect(corridor.mpi).toBeGreaterThan(0);
        expect(corridor.signal).toMatch(/^(outbound_pressure|inbound_pressure|balanced)$/);
      }
    }

    // Duration should be reasonable (30s to 10 min)
    expect(collection.durationMs).toBeGreaterThan(30000);
    expect(collection.durationMs).toBeLessThan(600000);

    // Date and timestamp should be today
    const today = new Date().toISOString().split('T')[0];
    expect(collection.date).toBe(today);
    expect(collection.timestamp).toBeTruthy();
  }, 600000); // 10 minute timeout

  it('dashboard serves collected data', async () => {
    // Skip if no data was collected
    if (!existsSync(DATA_PATH)) {
      console.log('Skipping dashboard test - no data collected');
      return;
    }

    // Start server in background
    const { spawn } = await import('node:child_process');
    const server = spawn('npx', ['tsx', 'src/server.ts'], {
      cwd: ROOT,
      stdio: 'pipe',
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    try {
      // Test /health endpoint
      const healthRes = await fetch('http://localhost:3847/health');
      expect(healthRes.ok).toBe(true);
      const health = await healthRes.json();
      expect(health.status).toBe('ok');
      expect(health.dataPoints).toBeGreaterThan(0);

      // Test /api/data endpoint
      const dataRes = await fetch('http://localhost:3847/api/data');
      expect(dataRes.ok).toBe(true);
      const data = await dataRes.json();
      expect(data.version).toBe(1);
      expect(data.collections.length).toBeGreaterThan(0);

      // Test /api/latest endpoint
      const latestRes = await fetch('http://localhost:3847/api/latest');
      expect(latestRes.ok).toBe(true);
      const latest = await latestRes.json();
      expect(latest).not.toBeNull();
      expect(latest.corridors).toHaveLength(7);

      // Test /api/corridors endpoint
      const corridorsRes = await fetch('http://localhost:3847/api/corridors');
      expect(corridorsRes.ok).toBe(true);
      const corridors = await corridorsRes.json();
      expect(Object.keys(corridors).length).toBe(7);

      // Test dashboard HTML
      const htmlRes = await fetch('http://localhost:3847/');
      expect(htmlRes.ok).toBe(true);
      const html = await htmlRes.text();
      expect(html).toContain('Bay Area Migration Tracker');
      expect(html).toContain('Chart.js');

      console.log('Dashboard API tests passed');
    } finally {
      server.kill();
    }
  }, 30000);
});
