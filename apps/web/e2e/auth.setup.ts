import { expect, test as setup } from '@playwright/test';
import { sel } from './helpers';

const STATE = 'e2e/.auth/user.json';

/**
 * Signs in once and saves the session, so every other spec starts on a screen
 * rather than on the login form. This also proves the login flow itself.
 */
setup('sign in as the depot manager', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();

  await sel.email(page).fill('sitaram@reeferready.example');
  await sel.password(page).fill('readiness');
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page.getByRole('heading', { level: 1, name: 'Depot Command' })).toBeVisible();
  await page.context().storageState({ path: STATE });
});
