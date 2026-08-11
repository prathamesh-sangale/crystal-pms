import { expect, test } from '@playwright/test';
import { openContainer, sel, signIn } from './helpers';

test('opening a container from the board deep-links to it', async ({ page }) => {
  await page.goto('/pipeline');
  await page.locator('.kcard').first().click();

  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  await expect(page).toHaveURL(/container=/);

  // The URL alone must be enough to reopen it.
  const url = page.url();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await page.goto(url);
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('ticking a task saves and the checklist reflects it', async ({ page }) => {
  await openContainer(page, 'HLXU');
  const drawer = page.getByRole('dialog');

  const firstTask = drawer.getByRole('checkbox').first();
  const before = await firstTask.getAttribute('data-state');

  await firstTask.click();
  await expect(firstTask).not.toHaveAttribute('data-state', before ?? '');

  // Put it back, so the fixture stays as the screenshots expect it.
  await firstTask.click();
  await expect(firstTask).toHaveAttribute('data-state', before ?? '');
});

test('advancing a stage with open tasks names the consequence first', async ({ page }) => {
  await openContainer(page, 'HLXU');

  await page.getByRole('button', { name: 'Advance stage' }).click();

  const confirm = page.getByRole('dialog').filter({ hasText: 'still open' });
  await expect(confirm).toBeVisible();
  // The button says what will happen, not "OK".
  await expect(confirm.getByRole('button', { name: /^Advance to / })).toBeVisible();

  await confirm.getByRole('button', { name: 'Stay in this stage' }).click();
  await expect(confirm).toBeHidden();
});

test('registering and removing a container, end to end', async ({ page }) => {
  const id = 'TSTU 900 001-4';

  await page.goto('/fleet');
  await page.getByRole('button', { name: 'New container' }).click();

  const modal = page.getByRole('dialog');
  await modal.getByLabel('Container ID').fill(id);
  await modal.getByLabel('Customer / lessee').fill('Playwright Lines');
  await modal.getByLabel('Container type').selectOption('anteroom');

  // Choosing an anteroom reveals the configuration, because the mantrap
  // checklist differs between the two.
  await expect(modal.getByLabel('Anteroom configuration')).toBeVisible();
  await modal.getByLabel('Anteroom configuration').selectOption('external');

  await modal.getByRole('button', { name: 'Add to pipeline' }).click();

  // A toast confirms it, and the new unit's drawer opens.
  await expect(page.getByText('Container registered')).toBeVisible();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByText(id)).toBeVisible();
  await expect(drawer.getByText('Mantrap alarm system test')).toBeVisible();

  // Removing names the container in the button, per the design system.
  await drawer.getByRole('button', { name: 'Remove', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm.getByRole('button', { name: `Remove ${id}` })).toBeVisible();
  await confirm.getByRole('button', { name: `Remove ${id}` }).click();

  await expect(page.getByText('Container removed')).toBeVisible();
  await page.goto('/fleet');
  await sel.fleetSearch(page).fill('TSTU');
  await expect(page.getByText('No containers match this view')).toBeVisible();
});

test('the theme survives a reload with no hand-written dark styling', async ({ page }) => {
  await page.goto('/depot');
  await page.getByRole('button', { name: /Switch to the dark theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // The page background comes from the token block, not a dark-mode override.
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(11, 19, 48)'); // --bg in the dark token block

  await page.getByRole('button', { name: /Switch to the light theme/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test.describe('signed in as someone else', () => {
  // Drop the saved manager session, keeping every other project setting.
  test.use({ storageState: { cookies: [], origins: [] } });

  test('a read-only account is not offered actions it cannot perform', async ({ page }) => {
    await signIn(page, 'viewer@reeferready.example');
    await expect(page.getByRole('button', { name: 'New container' })).toHaveCount(0);

    await page.goto('/fleet');
    await page.locator('.dt-rowlink').first().click();
    const drawer = page.getByRole('dialog');
    await expect(drawer.getByRole('button', { name: 'Remove', exact: true })).toHaveCount(0);
    await expect(drawer.getByRole('checkbox').first()).toBeDisabled();
  });
});

test('a filtered-to-nothing table offers the way out', async ({ page }) => {
  await page.goto('/fleet');
  await sel.fleetSearch(page).fill('zzzznothing');

  await expect(page.getByText('No containers match this view')).toBeVisible();
  await page.getByRole('button', { name: 'Clear search and filters' }).click();
  await expect(page.locator('table.dt tbody tr').first()).toBeVisible();
});
