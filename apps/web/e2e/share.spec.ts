import { type Browser, type BrowserContext, type Page, expect, test } from '@playwright/test';

// Contexts are closed after every test so devices from one test never linger on the same "Wi-Fi".
const open: BrowserContext[] = [];
test.afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

async function page(browser: Browser, opts: { width?: number; dark?: boolean } = {}): Promise<Page> {
  const ctx = await browser.newContext({
    viewport: { width: opts.width ?? 1200, height: 900 },
    colorScheme: opts.dark ? 'dark' : 'light',
    acceptDownloads: true,
  });
  open.push(ctx);
  return ctx.newPage();
}

async function shareText(p: Page, text: string) {
  await p.getByPlaceholder('Paste or type text to share…').fill(text);
  await p.keyboard.press('Control+Enter');
}

test.describe('Private Share', () => {
  test('two devices share encrypted text instantly', async ({ browser }) => {
    const a = await page(browser);
    await a.goto('/private');
    await a.waitForURL(/\/s\/[A-Za-z0-9_-]{43}#k=/);
    await expect(a.getByText('End-to-end encrypted').first()).toBeVisible();
    const b = await page(browser, { width: 390 });
    await b.goto(a.url());
    await expect(a.getByText(/is here/)).toBeVisible();
    await shareText(b, 'hello from phone https://example.com');
    await expect(a.getByText('hello from phone')).toBeVisible();
    await expect(a.locator('a[href="https://example.com"]')).toHaveAttribute('rel', /noopener/);
  });

  test('a link without its key shows the friendly message', async ({ browser }) => {
    const a = await page(browser);
    await a.goto('/private');
    await a.waitForURL(/#k=/);
    const b = await page(browser);
    await b.goto(a.url().split('#')[0]);
    await expect(b.getByText('missing its last part')).toBeVisible();
  });

  test('extends up to the maximum', async ({ browser }) => {
    const a = await page(browser);
    await a.goto('/private');
    await a.waitForURL(/#k=/);
    const extend = a.getByRole('button', { name: /Extend/ });
    await extend.click();
    // Minutes round up, so 4 h can read "3 h 59 min" or "4 h 0 min".
    await expect(a.getByText(/Ends in (3 h 5\d|4 h 0) min/)).toBeVisible(); // 2 h + 2 h
    await extend.click();
    await expect(a.getByText(/Ends in (5 h 5\d|6 h 0) min/)).toBeVisible(); // capped at 6 h
    await expect(extend).toBeDisabled();
  });
});

test.describe('Rooms', () => {
  test('join by code, lock blocks new joins', async ({ browser }) => {
    const a = await page(browser);
    await a.goto('/room/new');
    await a.waitForURL(/\/r\//);
    const code = (await a.locator('section.card span.font-mono').first().textContent())?.trim() ?? '';
    expect(code).toMatch(/^\d{6}$/);

    const b = await page(browser);
    await b.goto('/join');
    await b.locator('#digits input').first().fill(code); // pasting fills all six and submits
    await b.waitForURL(/\/r\//);
    await shareText(b, 'room hello');
    await expect(a.getByText('room hello')).toBeVisible();

    await a.getByRole('switch').check();
    await expect(a.getByText('Room locked')).toBeVisible();
    const c = await page(browser);
    await c.goto(`/j/${code}`);
    await expect(c.getByText('This room is locked')).toBeVisible();

    // A wrong code says so.
    await c.goto('/join');
    await c.locator('#digits input').first().fill(code === '000000' ? '111111' : '000000');
    await expect(c.getByText('No room with that code')).toBeVisible();
  });
});

test.describe('Wi-Fi Share', () => {
  test('files go directly between two devices on the same network', async ({ browser }) => {
    const a = await page(browser);
    const b = await page(browser);
    await a.goto('/');
    await b.goto('/');
    await expect(a.getByText(/is here/)).toBeVisible();
    const bytes = Buffer.alloc(3 * 1024 * 1024, 42);
    await a.setInputFiles('input[type=file]', { name: 'direct.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await expect(b.getByText(/Received from .* never uploaded/)).toBeVisible({ timeout: 30_000 });
    // Other tabs on the same local network may receive it too.
    await expect(a.getByText(/Sent directly to/).first()).toBeVisible();
    const [dl] = await Promise.all([b.waitForEvent('download'), b.getByRole('button', { name: 'Save', exact: true }).click()]);
    expect(dl.suggestedFilename()).toBe('direct.bin');
  });
});

test.describe('Layout', () => {
  test('360 px wide, dark mode, no horizontal scroll', async ({ browser }) => {
    const p = await page(browser, { width: 360, dark: true });
    await p.goto('/room/new');
    await p.waitForURL(/\/r\//);
    await expect(p.getByRole('heading', { name: 'Share files' })).toBeVisible();
    expect(await p.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(true);
    expect(await p.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await expect(p.getByRole('navigation', { name: 'Sharing modes' }).last()).toBeVisible();
  });

  test('content pages make no script requests and set no cookies', async ({ browser }) => {
    const p = await page(browser);
    const scripts: string[] = [];
    p.on('request', (r) => r.resourceType() === 'script' && scripts.push(r.url()));
    await p.goto('/how-it-works');
    await expect(p.getByRole('heading', { name: 'How Dropzy works' })).toBeVisible();
    // In dev, Vite injects CSS through scripts; the production build inlines it.
    expect(scripts.filter((u) => !u.includes('/@') && !u.includes('node_modules') && !u.endsWith('.css'))).toEqual([]);
    expect(await p.context().cookies()).toEqual([]);
    const ld = await p.locator('script[type="application/ld+json"]').first().textContent();
    expect(JSON.parse(ld ?? '{}')['@type']).toBe('FAQPage');
  });
});
