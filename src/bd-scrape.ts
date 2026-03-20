import { chromium } from 'playwright-extra';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { readHistory } from './storage.js';
import { calculateMpi, classifySignal, selectReferencePrice } from './mpi.js';
import type { RouteResult, TruckPrice } from './types.js';

const ROOT = join(import.meta.dirname, '..');
const DATA_PATH = join(ROOT, 'data', 'history.json');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));
const CDP = 'wss://brd-customer-hl_e1f3975a-zone-scraping_browser:ibhxjk6gxyl7@brd.superproxy.io:9222';

const ROUTES = [
  { from: 'Phoenix, AZ', to: 'San Jose, CA', corridor: 'SJ-Phoenix', direction: 'inbound' as const },
  { from: 'Salt Lake City, UT', to: 'San Francisco, CA', corridor: 'SF-SaltLakeCity', direction: 'inbound' as const },
  { from: 'San Jose, CA', to: 'Salt Lake City, UT', corridor: 'SJ-SaltLakeCity', direction: 'outbound' as const },
  { from: 'Boise, ID', to: 'San Francisco, CA', corridor: 'SF-Boise', direction: 'inbound' as const },
];

async function scrapeOnRoute(from: string, to: string, dateStr: string): Promise<{ trucks: TruckPrice[]; error: string | null }> {
  // Try up to 8 times — Bright Data pool needs warmup
  for (let attempt = 1; attempt <= 8; attempt++) {
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
    try {
      console.log(`    attempt ${attempt}...`);
      browser = await chromium.connectOverCDP(CDP, { timeout: 60000 });
      const ctx = browser.contexts()[0] || await browser.newContext();
      const page = await ctx.newPage();

      await page.goto('https://www.uhaul.com/Truck-Rentals/', { waitUntil: 'domcontentloaded', timeout: 90000 });
      if (page.url().includes('Captcha'))
        {await page.waitForURL((u: URL) => !u.toString().includes('Captcha'), { timeout: 60000 });}

      await page.locator('#PickupLocation-TruckOnly').fill(from);
      await page.waitForSelector('.ui-autocomplete:visible li', { timeout: 5000 }).catch(() => {});
      const a1 = page.locator('.ui-autocomplete:visible li').first();
      if (await a1.count() > 0) {await a1.click();}
      else {await page.locator('#PickupLocation-TruckOnly').press('Enter');}

      await page.locator('#DropoffLocation-TruckOnly').click();
      await page.locator('#DropoffLocation-TruckOnly').fill(to);
      await page.waitForSelector('.ui-autocomplete:visible li', { timeout: 5000 }).catch(() => {});
      const a2 = page.locator('.ui-autocomplete:visible li').first();
      if (await a2.count() > 0) {await a2.click();}
      else {await page.locator('#DropoffLocation-TruckOnly').press('Enter');}

      await page.locator('#PickupDate').click();
      await page.locator('#PickupDate').fill('');
      await page.locator('#PickupDate').pressSequentially(dateStr, { delay: 30 });
      await page.keyboard.press('Escape');

      await Promise.all([
        page.waitForURL('**/Reservations/**', { timeout: 60000 }),
        page.locator('#getRates').click(),
      ]);

      if (page.url().includes('Captcha'))
        {await page.waitForURL((u: URL) => !u.toString().includes('Captcha'), { timeout: 60000 });}

      await page.waitForSelector('h3', { timeout: 10000 }).catch(() => {});

      const trucks: TruckPrice[] = await page.evaluate(() => {
        const r: { name: string; price: number }[] = [];
        for (const h of document.querySelectorAll('h3')) {
          const n = h.textContent?.trim() || '';
          if (!n.includes("' Truck")) {continue;}
          let el: HTMLElement | null = h.parentElement;
          for (let i = 0; i < 10 && el; i++) {
            const p = el.querySelector('b.block.text-3x');
            if (p) {
              const v = Math.round(parseFloat(p.textContent?.replace(/[^0-9.]/g, '') || '0') || 0);
              if (v > 0) {r.push({ name: n, price: v });}
              break;
            }
            el = el.parentElement;
          }
        }
        return r;
      });
      await browser.close();
      return { trucks, error: trucks.length === 0 ? 'no trucks found' : null };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message.substring(0, 80) : String(err);
      try { await browser?.close(); } catch { /* ignore */ }
      if (attempt === 8) {return { trucks: [], error: errMsg };}
      await new Promise(r => setTimeout(r, 5000));
    }
  }
  return { trucks: [], error: 'exhausted retries' };
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const d = new Date(); d.setDate(d.getDate() + CONFIG.collection.lookupDateOffsetDays);
  const dateStr = `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
  const lookupDateIso = d.toISOString().split('T')[0];

  console.log(`Bright Data — 4 missing routes (8 retries each), date: ${dateStr}\n`);

  let merged = 0;
  for (let i = 0; i < ROUTES.length; i++) {
    const r = ROUTES[i];
    console.log(`[${i+1}/4] ${r.from} → ${r.to}`);
    const result = await scrapeOnRoute(r.from, r.to, dateStr);
    const ref = selectReferencePrice(result.trucks, CONFIG.collection.referenceTruckPreference);

    if (result.trucks.length > 0) {
      console.log(`  ✓ ${result.trucks.length} trucks: ${result.trucks.map((t: TruckPrice) => `${t.name}=$${t.price}`).join(', ')}`);

      // Merge immediately into history
      const history = readHistory(DATA_PATH);
      const latest = history.collections[history.collections.length - 1];
      const route: RouteResult = {
        from: r.from, to: r.to, corridor: r.corridor, direction: r.direction,
        lookupDate: lookupDateIso, trucks: result.trucks,
        referencePrice: ref.price, referenceTruck: ref.truck,
        source: 'playwright', error: null,
      };
      const key = `${r.from}|${r.to}`;
      const idx = latest.routes.findIndex((x: RouteResult) => `${x.from}|${x.to}` === key);
      if (idx === -1) {latest.routes.push(route);} else {latest.routes[idx] = route;}

      // Update corridor summary
      const cIdx = latest.corridors.findIndex((c: { name: string }) => c.name === r.corridor);
      if (cIdx !== -1) {
        const outR = latest.routes.find((x: RouteResult) => x.corridor === r.corridor && x.direction === 'outbound' && x.error === null);
        const inR = latest.routes.find((x: RouteResult) => x.corridor === r.corridor && x.direction === 'inbound' && x.error === null);
        const op = outR?.referencePrice ?? null, ip = inR?.referencePrice ?? null;
        const mpi = calculateMpi(op, ip);
        latest.corridors[cIdx].outboundPrice = op;
        latest.corridors[cIdx].inboundPrice = ip;
        latest.corridors[cIdx].mpi = mpi;
        latest.corridors[cIdx].signal = classifySignal(mpi);
        if (outR) {latest.corridors[cIdx].outboundTruck = outR.referenceTruck;}
        if (inR) {latest.corridors[cIdx].inboundTruck = inR.referenceTruck;}
      }
      latest.routesSucceeded = latest.routes.filter((x: RouteResult) => x.error === null).length;

      const tmpPath = DATA_PATH + '.tmp';
      mkdirSync(dirname(DATA_PATH), { recursive: true });
      writeFileSync(tmpPath, JSON.stringify(history, null, 2));
      renameSync(tmpPath, DATA_PATH);
      merged++;
      console.log(`  [saved — ${latest.routesSucceeded}/${latest.routes.length} total]\n`);
    } else {
      console.log(`  ✗ ${result.error}\n`);
    }
  }

  console.log(`Done! Merged ${merged}/4 routes in ${Math.round((Date.now() - startTime) / 1000)}s`);
}

main().catch(e => console.error('Fatal:', e.message));
