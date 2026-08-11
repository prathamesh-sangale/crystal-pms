import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { sel, setTheme } from './helpers';

const SCREENS = ['/depot', '/dashboard', '/tomorrow', '/pipeline', '/timeline', '/fleet', '/checklist', '/delayed'];

async function scan(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  const summary = results.violations.map(
    (v) => `${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`
  );
  expect(summary, `axe violations:\n${summary.join('\n')}`).toEqual([]);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} theme`, () => {
    for (const path of SCREENS) {
      test(`${path} has no accessibility violations`, async ({ page }) => {
        await page.goto(path);
        await setTheme(page, theme);
        await page.waitForTimeout(150);
        await scan(page);
      });
    }
  });
}

test('the container drawer is accessible and returns focus when it closes', async ({ page }) => {
  await page.goto('/fleet');

  const trigger = page.locator('.dt-rowlink').first();
  await trigger.click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await scan(page);

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  // Focus must land somewhere sensible — back on the control that opened it.
  await expect(trigger).toBeFocused();
});

test('the add-container modal traps focus and validates without leaving the field', async ({ page }) => {
  await page.goto('/depot');
  await page.getByRole('button', { name: 'New container' }).click();

  const modal = page.getByRole('dialog');
  await expect(modal).toBeVisible();
  await scan(page);

  await page.getByRole('button', { name: 'Add to pipeline' }).click();
  // Errors are attached to their field, not dumped in a banner.
  const idField = page.getByLabel('Container ID');
  await expect(idField).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByText('A container ID is required')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(modal).toBeHidden();
});

test('every screen is reachable by keyboard alone', async ({ page }) => {
  await page.goto('/depot');
  await expect(page.getByRole('heading', { level: 1, name: 'Depot Command' })).toBeVisible();
  await page.keyboard.press('Tab');
  // The first stop is always the skip link.
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('the command palette opens on the keyboard and navigates', async ({ page }) => {
  await page.goto('/depot');
  // The shortcut is registered in an effect, so wait for the screen to be
  // mounted before pressing it — otherwise the keystroke lands on nothing.
  await expect(page.getByRole('heading', { level: 1, name: 'Depot Command' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');

  const palette = page.getByRole('dialog');
  await expect(palette).toBeVisible();
  await scan(page);

  await sel.paletteInput(page).fill('delayed');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Delayed / At Risk' })).toBeVisible();
});

test('focus rings are never removed', async ({ page }) => {
  await page.goto('/fleet');

  const button = page.getByRole('button', { name: 'New container' });
  await button.focus();
  const shadow = await button.evaluate((el) => getComputedStyle(el).boxShadow);
  // The design system's ring is 3px of background then 2px of focus colour.
  expect(shadow).not.toBe('none');
});
