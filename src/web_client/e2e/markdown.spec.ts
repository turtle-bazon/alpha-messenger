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

test('markdown: смешанный текст', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  await page.getByTestId('message-input').fill('привет **мир** https://example.com');
  await page.getByTestId('message-send').click();

  const msg = page.locator('[data-testid="message"]').last();
  await expect(msg).toContainText('привет');
  await expect(msg.locator('strong')).toContainText('мир');
  await expect(msg.locator('.message-link')).toHaveAttribute('href', 'https://example.com');
});

test('italic: граница слова', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // variable_name не должен стать курсивом
  await page.getByTestId('message-input').fill('variable_name и _курсив_');
  await page.getByTestId('message-send').click();

  const msg = page.locator('[data-testid="message"]').last();
  await expect(msg.locator('em')).toHaveCount(1);
  await expect(msg.locator('em')).toContainText('курсив');
});

// ─── Панель форматирования (#69) ──────────────────────────────────────

test('WYSIWYG: markdown отображается в композере', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Вводим markdown — проверяем что overlay отображает отформатированный текст
  await page.getByTestId('message-input').fill('**жирный** и _курсив_');
  const overlay = page.locator('.composer-rendered');
  await expect(overlay).toContainText('жирный');
  await expect(overlay).toContainText('курсив');
});

test('панель форматирования: появляется при выделении', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  const input = page.getByTestId('message-input');
  await input.fill('привет мир');

  // Выделяем текст
  await input.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(0, 6);
    el.dispatchEvent(new Event('select'));
  });

  // Панель должна появиться
  await expect(page.getByTestId('formatting-bar')).toBeVisible();
});

test('форматирование: клик Bold оборачивает выделение', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  const input = page.getByTestId('message-input');
  await input.fill('привет мир');

  // Выделяем "привет"
  await input.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(0, 6);
    el.dispatchEvent(new Event('select'));
  });

  // Кликаем Bold
  await page.getByTestId('format-bold').click();

  // Проверяем что текст обёрнут
  await expect(input).toHaveValue('**привет** мир');
});

test('горячие клавиши: Ctrl+B для bold', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const a = await registerViaUi(page);
  const b = await registerViaUi(page);

  await createDirectViaUi(page, a.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  const input = page.getByTestId('message-input');
  await input.fill('текст');
  await input.focus();

  // Выделяем весь текст
  await input.evaluate((el: HTMLTextAreaElement) => {
    el.setSelectionRange(0, 4);
  });

  // Нажимаем Ctrl+B
  await input.press('Control+b');

  // Проверяем что текст обёрнут
  await expect(input).toHaveValue('**текст**');
});
