import { test } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTheme } from './helpers';

/**
 * Before and after, on the same screens, at the same widths, in both themes.
 *
 * "Before" is the original concept file opened straight off disk, so the
 * comparison is against the real thing rather than a description of it.
 *
 * Run with:  npm run shots -w @pms/web
 * Output:    apps/web/screenshots/
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONCEPT = resolve(HERE, '../../../source/reefer-readiness-pms.html');

const AFTER = [
  { path: '/depot', name: 'depot-command' },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/tomorrow', name: 'tomorrows-work' },
  { path: '/pipeline', name: 'readiness-pipeline' },
  { path: '/fleet', name: 'all-containers' },
];

/** The concept was a single page with a client-side view switcher. */
const BEFORE = [
  { view: 'depot', name: 'depot-command' },
  { view: 'dashboard', name: 'dashboard' },
  { view: 'tomorrow', name: 'tomorrows-work' },
  { view: 'pipeline', name: 'readiness-pipeline' },
  { view: 'fleet', name: 'all-containers' },
];

test.describe('after — the rebuilt app', () => {
  for (const theme of ['light', 'dark'] as const) {
    for (const screen of AFTER) {
      test(`${screen.name} · ${theme}`, async ({ page }, testInfo) => {
        const device = testInfo.project.name;
        await page.goto(screen.path);
        await setTheme(page, theme);
        await page.waitForTimeout(400);
        await page.screenshot({
          path: `screenshots/after/${device}-${theme}/${screen.name}.png`,
          fullPage: true,
        });
      });
    }
  }

  test('container drawer · light', async ({ page }, testInfo) => {
    await page.goto('/fleet');
    await setTheme(page, 'light');
    await page.locator('.dt-rowlink').first().click();
    await page.waitForTimeout(500);
    await page.screenshot({
      path: `screenshots/after/${testInfo.project.name}-light/container-drawer.png`,
    });
  });
});

test.describe('before — the original concept', () => {
  test.skip(!existsSync(CONCEPT), 'source/reefer-readiness-pms.html is not present');

  for (const screen of BEFORE) {
    test(`${screen.name}`, async ({ page }, testInfo) => {
      const width = page.viewportSize()?.width ?? 1440;
      await page.goto(pathToFileURL(CONCEPT).href);

      // Below 1000px the concept hides its sidebar with nothing to replace it,
      // so on a phone there is no way to reach any view but the default. That
      // is itself the finding, so the capture records the state as it is.
      if (width >= 1000) {
        await page.locator(`.navitem[data-view="${screen.view}"]`).click({ force: true });
      } else if (screen.view !== BEFORE[0]?.view) {
        test.skip(true, 'the concept has no mobile navigation — only the default view is reachable');
      }

      await page.waitForTimeout(400);
      await page.screenshot({
        path: `screenshots/before/${testInfo.project.name}/${screen.name}.png`,
        fullPage: true,
      });
    });
  }
});
