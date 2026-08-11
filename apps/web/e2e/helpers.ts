import { expect, type Page } from '@playwright/test';

/**
 * Selectors used in more than one spec, in one place — so a label change
 * breaks one line rather than fifteen.
 */
export const sel = {
  email: (page: Page) => page.locator('input[name="email"]'),
  password: (page: Page) => page.locator('input[name="password"]'),
  fleetSearch: (page: Page) => page.getByLabel('Search containers', { exact: true }),
  // The palette's dialog and its input share an accessible name, so the role
  // is what distinguishes them.
  paletteInput: (page: Page) =>
    page.getByRole('combobox', { name: 'Search containers, screens and actions' }),
};

export async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/');
  await sel.email(page).fill(email);
  await sel.password(page).fill('readiness');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Depot Command' })).toBeVisible();
}

export async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((value) => {
    localStorage.setItem('pms-theme', value);
    document.documentElement.setAttribute('data-theme', value);
  }, theme);
  await page.waitForTimeout(150);
}

/**
 * Asserts a toast appeared. Scoped to `.toast` because the toast primitive
 * also renders a hidden copy into a live region for screen readers, so the
 * text legitimately exists twice in the document.
 */
export async function expectToast(page: Page, text: string): Promise<void> {
  await expect(page.locator('.toast', { hasText: text })).toBeVisible();
}

/** Opens a specific container's drawer by unit number. */
export async function openContainer(page: Page, query: string): Promise<void> {
  await page.goto('/fleet');
  await sel.fleetSearch(page).fill(query);
  await page.locator('.dt-rowlink').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
}
