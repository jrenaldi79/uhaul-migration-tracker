import { type Page } from 'playwright';
import { chromium as stealthChromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

// Apply stealth patches to avoid bot detection
stealthChromium.use(StealthPlugin());
const chromium = stealthChromium;
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AppConfig,
  Collection,
  CorridorConfig,
  CorridorSummary,
  RouteResult,
  TruckPrice,
} from './types.js';
import { calculateMpi, classifySignal, selectReferencePrice } from './mpi.js';
import {
  computeBaseline,
  classifySignalWithBaseline,
  computeSeasonalFactor,
  computeNormalizedMpi,
} from './baselines.js';
import { readHistory, upsertCollection } from './storage.js';
import { randomDelay, getLookupDate, log, logError, formatDate } from './utils.js';

const ROOT = join(import.meta.dirname, '..');
const CONFIG_PATH = join(ROOT, 'config.json');
const DATA_PATH = join(ROOT, 'data', 'history.json');

function loadConfig(): AppConfig {
  return JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
}

async function checkForCaptcha(page: Page): Promise<boolean> {
  const url = page.url();
  return url.includes('/Captcha') || url.includes('/captcha');
}

async function scrapeRoute(
  page: Page,
  from: string,
  to: string,
  lookupDate: string,
  config: AppConfig,
): Promise<{ trucks: TruckPrice[]; error: string | null; captcha?: boolean }> {
  const s = config.selectors;

  try {
    await page.goto('https://www.uhaul.com/Truck-Rentals/', {
      waitUntil: 'domcontentloaded',
      timeout: config.collection.timeoutMs,
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    // Check if initial page load hit a CAPTCHA
    if (await checkForCaptcha(page)) {
      return { trucks: [], error: 'CAPTCHA detected', captcha: true };
    }

    // Fill pickup location
    await page.locator(s.pickupInput).click();
    await page.locator(s.pickupInput).fill(from);
    await page.waitForTimeout(2000);

    const pickupItem = page.locator(s.autocompleteItem).first();
    if ((await pickupItem.count()) > 0) {
      await pickupItem.click();
    } else {
      await page.locator(s.pickupInput).press('Enter');
    }
    await page.waitForTimeout(1000);

    // Fill dropoff location
    await page.locator(s.dropoffInput).click();
    await page.locator(s.dropoffInput).fill(to);
    await page.waitForTimeout(2000);

    const dropoffItem = page.locator(s.autocompleteItem).first();
    if ((await dropoffItem.count()) > 0) {
      await dropoffItem.click();
    } else {
      await page.locator(s.dropoffInput).press('Enter');
    }
    await page.waitForTimeout(1000);

    // Fill date (MM/DD/YYYY via pressSequentially)
    const dateInput = page.locator(s.dateInput);
    await dateInput.click();
    await dateInput.fill('');
    await dateInput.pressSequentially(lookupDate, { delay: 50 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // Submit and wait for results
    await Promise.all([
      page.waitForURL('**/Reservations/**', { timeout: config.collection.timeoutMs }),
      page.locator(s.submitButton).click(),
    ]).catch(async () => {
      // Navigation may have gone to CAPTCHA instead of results
    });

    // Check if we landed on a CAPTCHA page
    if (await checkForCaptcha(page)) {
      return { trucks: [], error: 'CAPTCHA detected', captcha: true };
    }

    await page.waitForLoadState('networkidle', { timeout: config.collection.timeoutMs });
    await page.waitForTimeout(3000);

    // Extract trucks from results page
    const trucks: TruckPrice[] = await page.evaluate((priceSelector: string) => {
      const results: { name: string; price: number }[] = [];
      const headers = document.querySelectorAll('h3');

      for (const h of headers) {
        const name = h.textContent?.trim() || '';
        if (!name.includes("' Truck")) { continue; }

        // Walk up to find the price element
        let container: HTMLElement | null = h.parentElement;
        for (let depth = 0; depth < 10 && container; depth++) {
          const priceEl = container.querySelector(priceSelector);
          if (priceEl) {
            const priceText = priceEl.textContent?.trim() || '0';
            const price = Math.round(parseFloat(priceText.replace(/[^0-9.]/g, '')) || 0);
            if (price > 0) {
              results.push({ name, price });
            }
            break;
          }
          container = container.parentElement;
        }
      }
      return results;
    }, s.truckPrice);

    return { trucks, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { trucks: [], error: message };
  }
}

async function waitForCaptchaSolve(page: Page): Promise<void> {
  log('captcha', '🔒 CAPTCHA detected! A browser window will open — please solve it.');
  log('captcha', 'Waiting for you to complete the CAPTCHA...');

  // Poll until user solves the CAPTCHA (URL no longer contains /Captcha)
  while (await checkForCaptcha(page)) {
    await new Promise((r) => setTimeout(r, 2000));
  }
  log('captcha', '✅ CAPTCHA solved! Resuming collection...');
  // Give the page a moment to settle
  await page.waitForTimeout(2000);
}

// Shared browser state so CAPTCHA handler can relaunch headed
let activeContext: import('playwright').BrowserContext | null = null;
let activePage: Page | null = null;
let isHeaded = false;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const CDP_URL = 'http://localhost:9222';
let useConnect = false;

async function launchBrowser(headed: boolean): Promise<Page> {
  if (useConnect) {
    // Connect to user's real Chrome via CDP
    log('collector', 'Connecting to existing Chrome on port 9222...');
    const { chromium: pw } = await import('playwright');
    const browser = await pw.connectOverCDP(CDP_URL);
    activeContext = browser.contexts()[0] || await browser.newContext();
    activePage = await activeContext.newPage();
    return activePage;
  }
  const browser = await chromium.launch({ headless: !headed });
  activeContext = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: UA,
  });
  activePage = await activeContext.newPage();
  return activePage;
}

async function relaunchHeaded(): Promise<Page> {
  log('captcha', 'Relaunching browser in headed mode for CAPTCHA...');
  if (!useConnect && activeContext) {
    await activeContext.browser()?.close().catch(() => {});
  }
  isHeaded = true;
  return launchBrowser(true);
}

async function scrapeRouteWithRetry(
  page: Page,
  from: string,
  to: string,
  lookupDate: string,
  config: AppConfig,
  routeLabel: string,
): Promise<{ trucks: TruckPrice[]; error: string | null }> {
  for (let attempt = 1; attempt <= config.collection.maxRetries; attempt++) {
    const result = await scrapeRoute(activePage ?? page, from, to, lookupDate, config);

    // Handle CAPTCHA: relaunch headed, let user solve, then retry
    if (result.captcha) {
      const headedPage = isHeaded ? (activePage ?? page) : await relaunchHeaded();
      await headedPage.goto('https://www.uhaul.com/Truck-Rentals/', { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (await checkForCaptcha(headedPage)) {
        await waitForCaptchaSolve(headedPage);
      }
      // Retry this route on the (now headed) page
      const retry = await scrapeRoute(headedPage, from, to, lookupDate, config);
      if (retry.trucks.length > 0) {
        log(routeLabel, `Success after CAPTCHA solve: ${retry.trucks.length} trucks`);
        return retry;
      }
      return retry;
    }

    if (result.trucks.length > 0) {
      log(routeLabel, `Success on attempt ${attempt}: ${result.trucks.length} trucks`);
      return result;
    }

    if (attempt < config.collection.maxRetries) {
      log(routeLabel, `Attempt ${attempt} failed: ${result.error ?? 'no trucks'}. Retrying...`);
      await new Promise((r) => setTimeout(r, config.collection.retryBackoffMs));
    } else {
      logError(routeLabel, `All ${config.collection.maxRetries} attempts failed: ${result.error}`);
      return result;
    }
  }

  return { trucks: [], error: 'Max retries exhausted' };
}

function buildCorridorSummaries(
  routes: RouteResult[],
  corridors: CorridorConfig[],
  historicalMpiByName: Map<string, (number | null)[]>,
  config: AppConfig,
): CorridorSummary[] {
  return corridors.map((corridor) => {
    const outRoute = routes.find(
      (r) => r.corridor === corridor.name && r.direction === 'outbound',
    );
    const inRoute = routes.find(
      (r) => r.corridor === corridor.name && r.direction === 'inbound',
    );

    const outboundPrice = outRoute?.referencePrice ?? null;
    const inboundPrice = inRoute?.referencePrice ?? null;
    const mpi = calculateMpi(outboundPrice, inboundPrice);

    // Compute baseline from historical data
    const historicalMpis = historicalMpiByName.get(corridor.name) ?? [];
    const allMpis = [...historicalMpis, mpi];
    const baseline = computeBaseline(allMpis, config.baselines.minDataPoints);

    // Determine signal
    let signal = classifySignal(mpi);
    let signalSource: 'flat_threshold' | 'corridor_baseline' = 'flat_threshold';
    if (baseline.active) {
      signal = classifySignalWithBaseline(mpi, baseline);
      signalSource = 'corridor_baseline';
    }

    // Seasonal normalization
    const currentMonth = new Date().getMonth() + 1;
    const totalDays = historicalMpis.length;
    const monthlyAverages = new Map<number, number>();
    const seasonalFactor = computeSeasonalFactor(currentMonth, totalDays, monthlyAverages);
    const normalizedMpi = computeNormalizedMpi(mpi, seasonalFactor);

    return {
      name: corridor.name,
      label: corridor.label,
      outboundPrice,
      inboundPrice,
      mpi,
      signal,
      outboundTruck: outRoute?.referenceTruck ?? '',
      inboundTruck: inRoute?.referenceTruck ?? '',
      baseline,
      signalSource,
      seasonalFactor,
      normalizedMpi,
    };
  });
}

function formatLookupDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}

async function main(): Promise<void> {
  const startTime = Date.now();
  const config = loadConfig();
  const headed = process.argv.includes('--headed');
  useConnect = process.argv.includes('--connect');
  // --skip N: skip the first N corridors (for resuming partial runs)
  const skipIdx = process.argv.indexOf('--skip');
  const skipCount = skipIdx !== -1 ? parseInt(process.argv[skipIdx + 1] || '0', 10) : 0;

  isHeaded = headed || useConnect;
  const mode = useConnect ? 'connect to Chrome' : headed ? 'headed' : 'headless';
  log('collector', `Starting collection (${mode} mode)${skipCount ? `, skipping first ${skipCount} corridors` : ''}`);

  await launchBrowser(headed);

  const lookupDate = formatLookupDate(config.collection.lookupDateOffsetDays);
  const lookupDateIso = getLookupDate(config.collection.lookupDateOffsetDays);
  log('collector', `Lookup date: ${lookupDate} (${lookupDateIso})`);

  // Load historical data for baselines
  const history = readHistory(DATA_PATH);
  const historicalMpiByName = new Map<string, (number | null)[]>();
  for (const collection of history.collections) {
    for (const corridor of collection.corridors) {
      const existing = historicalMpiByName.get(corridor.name) ?? [];
      existing.push(corridor.mpi);
      historicalMpiByName.set(corridor.name, existing);
    }
  }

  const routes: RouteResult[] = [];
  let routesSucceeded = 0;
  const corridorsToRun = config.corridors.slice(skipCount);
  const totalRoutes = corridorsToRun.length * 2;

  for (const corridor of corridorsToRun) {
    for (const direction of ['outbound', 'inbound'] as const) {
      const route = corridor[direction];
      const routeLabel = `${route.from} → ${route.to}`;
      log(routeLabel, 'Scraping...');

      const result = await scrapeRouteWithRetry(
        activePage!, route.from, route.to, lookupDate, config, routeLabel,
      );

      const ref = selectReferencePrice(
        result.trucks,
        config.collection.referenceTruckPreference,
      );

      routes.push({
        from: route.from,
        to: route.to,
        corridor: corridor.name,
        direction,
        lookupDate: lookupDateIso,
        trucks: result.trucks,
        referencePrice: ref.price,
        referenceTruck: ref.truck,
        source: 'playwright',
        error: result.error,
      });

      if (result.trucks.length > 0) { routesSucceeded++; }

      // Delay between routes (skip after last one)
      const isLast =
        corridor === corridorsToRun[corridorsToRun.length - 1] &&
        direction === 'inbound';
      if (!isLast) {
        await randomDelay(config.collection.delayBetweenRoutesMs);
      }
    }

    // Save after each corridor completes (both directions) so data survives crashes
    if (routesSucceeded > 0) {
      saveProgress();
    }
  }

  function saveProgress(): void {
    const completedCorridors = corridorsToRun.filter((c) =>
      routes.some((r) => r.corridor === c.name),
    );
    const corridorSummaries = buildCorridorSummaries(
      routes, completedCorridors, historicalMpiByName, config,
    );
    const collection: Collection = {
      date: formatDate(new Date()),
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      routesAttempted: totalRoutes,
      routesSucceeded,
      routes,
      corridors: corridorSummaries,
    };
    upsertCollection(DATA_PATH, collection);
    log('collector', `Progress saved: ${routesSucceeded}/${totalRoutes} routes (${completedCorridors.length} corridors)`);
  }

  // Graceful shutdown — save whatever we have
  let shuttingDown = false;
  function handleShutdown(): void {
    if (shuttingDown) {return;}
    shuttingDown = true;
    log('collector', 'Interrupted — saving progress before exit...');
    if (routesSucceeded > 0) { saveProgress(); }
    if (useConnect) {
      // Just close our tab, not the whole browser
      activePage?.close().catch(() => {});
    } else {
      activeContext?.close().catch(() => {});
    }
    process.exit(0);
  }
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  if (useConnect) {
    await activePage?.close().catch(() => {});
  } else {
    await activeContext!.close();
  }

  log('collector', `Done: ${routesSucceeded}/${totalRoutes} routes`);

  const completedCorridors = corridorsToRun.filter((c) =>
    routes.some((r) => r.corridor === c.name),
  );
  const corridorSummaries = buildCorridorSummaries(
    routes, completedCorridors, historicalMpiByName, config,
  );
  for (const c of corridorSummaries) {
    const src = c.signalSource === 'corridor_baseline' ? ' [baseline]' : '';
    log('summary', `${c.label}: MPI=${c.mpi?.toFixed(2) ?? 'N/A'} (${c.signal}${src}) OUT=$${c.outboundPrice ?? 'N/A'} IN=$${c.inboundPrice ?? 'N/A'}`);
  }

  process.exit(0);
}

main();
