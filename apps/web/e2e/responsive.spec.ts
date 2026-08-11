import { expect, test } from '@playwright/test';

test.describe('phone', () => {
  // Set here rather than relying on the project, so this file proves the
  // breakpoints whichever project runs it.
  test.use({ viewport: { width: 393, height: 852 } });

  test('the sidebar becomes a sheet that slides in over the screen', async ({ page }) => {
    await page.goto('/depot');

    // The permanent rail is gone, not just hidden with nothing to replace it.
    await expect(page.locator('.rail-slot')).toBeHidden();

    await page.getByRole('button', { name: 'Open navigation' }).click();
    const sheet = page.getByRole('dialog', { name: 'ReeferReady' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveClass(/navdrawer/);

    await sheet.getByRole('link', { name: /Delayed/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Delayed / At Risk' })).toBeVisible();
    await expect(sheet).toBeHidden();
  });

  test('a data table becomes one card per record with its key fields', async ({ page }) => {
    await page.goto('/fleet');

    // The header row is gone on a phone…
    await expect(page.locator('table.dt thead')).toBeHidden();

    const firstRow = page.locator('table.dt tbody tr').first();
    // …the record's own name leads the card…
    const lead = firstRow.locator('td[data-lead]');
    await expect(lead).toBeVisible();
    // …the remaining visible cells carry their own labels…
    const labelled = firstRow.locator('td[data-label]:not([data-lead]):not([data-secondary])');
    const visibleCount = await labelled.count();
    expect(visibleCount).toBeGreaterThanOrEqual(3);
    expect(visibleCount).toBeLessThanOrEqual(5);
    // …and the secondary columns drop out rather than wrapping.
    await expect(firstRow.locator('td[data-secondary]').first()).toBeHidden();
  });

  test('tapping a card opens the full record', async ({ page }) => {
    await page.goto('/fleet');
    await page.locator('.dt-rowlink').first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  test('nothing scrolls the page sideways', async ({ page }) => {
    for (const path of ['/depot', '/dashboard', '/tomorrow', '/fleet', '/timeline', '/delayed']) {
      await page.goto(path);
      await page.waitForTimeout(200);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${path} scrolls horizontally by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('the sidebar rail expands on hover without moving the content', async ({ page }) => {
    await page.goto('/depot');
    const rail = page.locator('aside.side.rail');
    const heading = page.getByRole('heading', { level: 1, name: 'Depot Command' });
    await expect(heading).toBeVisible();

    const collapsed = await rail.evaluate((el: HTMLElement) => el.getBoundingClientRect().width);
    const contentBefore = await heading.evaluate((el: HTMLElement) => el.getBoundingClientRect().left);
    expect(collapsed).toBe(64);

    await rail.hover();
    await expect
      .poll(() => rail.evaluate((el: HTMLElement) => Math.round(el.getBoundingClientRect().width)))
      .toBe(212);

    // The panel floats over the page; nothing underneath may shift.
    const contentAfter = await heading.evaluate((el: HTMLElement) => el.getBoundingClientRect().left);
    expect(contentAfter).toBe(contentBefore);
  });

  test('a keyboard reaches the nav, and the labels are always announced', async ({ page }) => {
    await page.goto('/depot');
    await expect(page.getByRole('heading', { level: 1, name: 'Depot Command' })).toBeVisible();

    // Collapsed, the label is faded — but it must still be the item's name.
    const link = page.getByRole('link', { name: /Readiness Pipeline/ });
    await expect(link).toBeVisible();

    // Focus opens the rail, so a keyboard user sees what a mouse user sees.
    await link.focus();
    await expect
      .poll(() =>
        page
          .locator('aside.side.rail')
          .evaluate((el: HTMLElement) => Math.round(el.getBoundingClientRect().width))
      )
      .toBe(212);
  });

  test('the kanban scrolls inside itself, never the page', async ({ page }) => {
    await page.goto('/pipeline');
    const pageOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(pageOverflow).toBeLessThanOrEqual(1);

    const boardScrolls = await page
      .locator('.kanban')
      .evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(boardScrolls).toBe(true);
  });

  test('tablet width keeps every screen usable', async ({ page }) => {
    await page.setViewportSize({ width: 834, height: 1112 });
    for (const path of ['/depot', '/tomorrow', '/fleet']) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${path} at tablet width`).toBeLessThanOrEqual(1);
    }
  });

  test('at 200% zoom the layout still works and no text is below the floor', async ({ page }) => {
    // Zoom is the same as halving the viewport at the same CSS pixel ratio.
    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto('/pipeline');

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(1);

    // 9px is the smallest size the design system documents anywhere — the
    // sidebar group label in section 21. (Everything else bottoms out at
    // 9.5px; that one label is the outlier.) Nothing may render below it,
    // which is what the concept's 7.8px kanban labels did.
    const tooSmall = await page.evaluate(() => {
      const offenders: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        // Only elements holding their own text, not containers.
        const ownText = Array.from(el.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? '')
          .join('')
          .trim();
        if (!ownText) continue;
        const size = Number.parseFloat(getComputedStyle(el).fontSize);
        if (size < 9) offenders.push(`${el.tagName}.${el.className} @ ${size}px — "${ownText.slice(0, 30)}"`);
      }
      return offenders;
    });
    expect(tooSmall).toEqual([]);
  });
});
