import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// #68 — Markdown в сообщениях и кликабельные ссылки.
// Проверяем рендер inline-форматирования и автодетект URL.

test('markdown: bold, italic, code, strikethrough', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Отправляем сообщение с markdown
  await page.getByTestId('message-input').fill('жирный **текст** и _курсив_ и `код` и ~~зачёркнутый~~');
  await page.getByTestId('message-send').click();

  // Проверяем рендер
  const msg = page.locator('[data-testid="message"]').last();
  await expect(msg.locator('strong')).toContainText('текст');
  await expect(msg.locator('em')).toContainText('курсив');
  await expect(msg.locator('code')).toContainText('код');
  await expect(msg.locator('del')).toContainText('зачёркнутый');
});

test('автодетект URL: ссылка кликабельна', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  await page.getByTestId('message-input').fill('смотри https://example.com/page?q=1');
  await page.getByTestId('message-send').click();

  const link = page.locator('.message-link').last();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://example.com/page?q=1');
  await expect(link).toContainText('https://example.com/page?q=1');
});

test('markdown-ссылка: [текст](url)', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  await page.getByTestId('message-input').fill('[Яндекс](https://ya.ru)');
  await page.getByTestId('message-send').click();

  const link = page.locator('.message-link').last();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://ya.ru');
  await expect(link).toContainText('Яндекс');
});

test('код не парсится как markdown', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  await page.getByTestId('message-input').fill('`**не жирный**`');
  await page.getByTestId('message-send').click();

  const msg = page.locator('[data-testid="message"]').last();
  await expect(msg.locator('code')).toContainText('**не жирный**');
  await expect(msg.locator('strong')).toHaveCount(0);
});
