import { describe, it, expect } from 'vitest';
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig, TruckPrice } from '../../src/types.js';

const ROOT = join(import.meta.dirname, '../..');
const config: AppConfig = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf-8'));

describe('scrape one route (SF → Sacramento)', () => {
  it('navigates U-Haul, fills form, and extracts truck prices', async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    }).then(ctx => ctx.newPage());

    try {
      // Navigate to truck rentals page
      await page.goto('https://www.uhaul.com/Truck-Rentals/', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Fill pickup
      await page.locator(config.selectors.pickupInput).click();
      await page.locator(config.selectors.pickupInput).fill('San Francisco, CA');
      await page.waitForTimeout(2000);

      const pickupItem = page.locator(config.selectors.autocompleteItem).first();
      if ((await pickupItem.count()) > 0) {
        await pickupItem.click();
      } else {
        await page.locator(config.selectors.pickupInput).press('Enter');
      }
      await page.waitForTimeout(1000);

      // Fill dropoff
      await page.locator(config.selectors.dropoffInput).click();
      await page.locator(config.selectors.dropoffInput).fill('Sacramento, CA');
      await page.waitForTimeout(2000);

      const dropoffItem = page.locator(config.selectors.autocompleteItem).first();
      if ((await dropoffItem.count()) > 0) {
        await dropoffItem.click();
      } else {
        await page.locator(config.selectors.dropoffInput).press('Enter');
      }
      await page.waitForTimeout(1000);

      // Fill date (14 days from now)
      const d = new Date();
      d.setDate(d.getDate() + 14);
      const dateStr = String(d.getMonth() + 1).padStart(2, '0') + '/'
        + String(d.getDate()).padStart(2, '0') + '/' + d.getFullYear();

      const dateInput = page.locator(config.selectors.dateInput);
      await dateInput.click();
      await dateInput.fill('');
      await dateInput.pressSequentially(dateStr, { delay: 50 });
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Submit
      await Promise.all([
        page.waitForURL('**/Reservations/**', { timeout: 30000 }),
        page.locator(config.selectors.submitButton).click(),
      ]);
      await page.waitForLoadState('networkidle', { timeout: 30000 });
      await page.waitForTimeout(3000);

      // Verify we're on the results page
      expect(page.url()).toContain('/Reservations/');

      // Extract trucks
      const trucks: TruckPrice[] = await page.evaluate((priceSelector: string) => {
        const results: { name: string; price: number }[] = [];
        const headers = document.querySelectorAll('h3');
        for (const h of headers) {
          const name = h.textContent?.trim() || '';
          if (!name.includes("' Truck")) { continue; }
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
      }, config.selectors.truckPrice);

      // Validate results
      expect(trucks.length).toBeGreaterThanOrEqual(1);
      console.log('Trucks found:', trucks);

      // Should have recognizable truck names
      const truckNames = trucks.map(t => t.name);
      const hasKnownTruck = truckNames.some(n =>
        n.includes("10'") || n.includes("15'") || n.includes("20'") || n.includes("26'")
      );
      expect(hasKnownTruck).toBe(true);

      // Prices should be reasonable (between $30 and $5000)
      for (const t of trucks) {
        expect(t.price).toBeGreaterThan(30);
        expect(t.price).toBeLessThan(5000);
      }
    } finally {
      await browser.close();
    }
  }, 60000); // 60s timeout for this test
});
