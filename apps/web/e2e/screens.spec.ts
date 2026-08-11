import { expect, test } from '@playwright/test';

const SCREENS = [
  { path: '/depot', heading: 'Depot Command' },
  { path: '/dashboard', heading: 'Dashboard' },
  { path: '/tomorrow', heading: "Tomorrow's Work" },
  { path: '/pipeline', heading: 'Readiness Pipeline' },
  { path: '/timeline', heading: 'Stage Timeline' },
  { path: '/fleet', heading: 'All Containers' },
  { path: '/checklist', heading: 'Checklist Library' },
  { path: '/delayed', heading: 'Delayed / At Risk' },
];

test.describe('every screen loads and shows real content', () => {
  for (const screen of SCREENS) {
    test(screen.heading, async ({ page }) => {
      await page.goto(screen.path);
      await expect(page.getByRole('heading', { level: 1, name: screen.heading })).toBeVisible();
      // No screen may ship a blank area — each one either has content or an
      // explicit empty state.
      await expect(page.locator('.appcontent')).not.toBeEmpty();
    });
  }
});

test('the seeded board is the one the tests were written against', async ({ page }) => {
  await page.goto('/depot');
  await expect(page.getByText('Home depot fleet')).toBeVisible();
  // Four home-depot containers, three delayed network-wide, one ready.
  await page.goto('/delayed');
  await expect(page.locator('table.dt tbody tr')).toHaveCount(3);
});

test('the pipeline shows all ten stages at a legible size', async ({ page }) => {
  await page.goto('/pipeline');
  const columns = page.locator('.kcol');
  await expect(columns).toHaveCount(10);

  // Design system: Manrope is never set below 12px. The concept used 7.8px
  // here to force ten columns onto one screen.
  const size = await page
    .locator('.kcol-head h4')
    .first()
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(size).toBeGreaterThanOrEqual(12);
});

test('the design system scrollbar is not switched off by the standard properties', async ({
  page,
}) => {
  await page.goto('/pipeline');
  await expect(page.locator('.kanban')).toBeVisible();

  const state = await page.evaluate(() => {
    const el = document.querySelector('.kanban') as HTMLElement;
    const style = getComputedStyle(el);
    return {
      pseudoSupported: CSS.supports('selector(::-webkit-scrollbar)'),
      scrollbarWidth: style.scrollbarWidth,
      scrollbarColor: style.scrollbarColor,
    };
  });

  // Where ::-webkit-scrollbar exists, setting either standard property makes
  // the engine ignore the pseudo-elements entirely and fall back to the
  // platform scrollbar. They must stay at `auto`. (Measuring the rendered
  // width is no use here: headless Chromium draws overlay scrollbars, which
  // reserve no space whatever they look like.)
  if (state.pseudoSupported) {
    expect(state.scrollbarWidth, 'scrollbar-width must be left alone').toBe('auto');
    expect(state.scrollbarColor, 'scrollbar-color must be left alone').toBe('auto');
  } else {
    expect(state.scrollbarWidth).toBe('thin');
  }
});

test('the command palette opens centred, not at the foot of the page', async ({ page }) => {
  await page.goto('/depot');
  await expect(page.getByRole('heading', { level: 1, name: 'Depot Command' })).toBeVisible();
  await page.keyboard.press('ControlOrMeta+k');

  const panel = page.locator('.cmdk');
  await expect(panel).toBeVisible();

  const box = (await panel.boundingBox())!;
  const viewport = page.viewportSize()!;
  // The palette primitive renders its panel as a sibling of the scrim, so it
  // gets no centring for free and lands in normal flow if nothing positions it.
  expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(4);
  expect(box.y).toBeLessThan(viewport.height * 0.25);
  expect(box.y).toBeGreaterThan(0);
});

test('status is never colour alone — every pill carries an icon and a word', async ({ page }) => {
  await page.goto('/fleet');
  await expect(page.locator('table.dt tbody tr').first()).toBeVisible();

  const pills = page.locator('.pill');
  const count = await pills.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i += 1) {
    const pill = pills.nth(i);
    await expect(pill.locator('svg.ic')).toHaveCount(1);
    await expect(pill).not.toHaveText(/^\s*$/);
  }
});

test('exactly one navy hero block per screen', async ({ page }) => {
  for (const screen of SCREENS) {
    await page.goto(screen.path);
    await expect(page.locator('.herocard, .hero')).toHaveCount(
      screen.path === '/dashboard' ? 1 : 0
    );
  }
});

test('the sidebar stays white with a tinted active item', async ({ page }) => {
  await page.goto('/depot');
  const sidebar = page.locator('aside.side');
  const background = await sidebar.evaluate((el) => getComputedStyle(el).backgroundColor);
  const surface = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
  );
  // --surface is #FFFFFF in light mode; the rule is that it is never a navy fill.
  expect(surface).toBe('#FFFFFF');
  expect(background).toBe('rgb(255, 255, 255)');

  const active = page.locator('.navitem.on');
  await expect(active).toHaveCount(1);
  const activeBg = await active.evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(activeBg).toBe('rgb(234, 240, 251)'); // --accent-soft
});
