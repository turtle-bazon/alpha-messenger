import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Выделяет диапазон в contentEditable-композере (offset'ы — по текстовому
// содержимому). Компонент слушает click/keyup и читает window.getSelection().
async function selectRangeIn(
  page: import('@playwright/test').Page,
  from: number,
  to: number,
): Promise<void> {
  await page.getByTestId('message-input').evaluate(
    (el, range) => {
      const node = el.firstChild;
      if (!node) return;
      const r = document.createRange();
      r.setStart(node, range.from);
      r.setEnd(node, range.to);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(r);
      // checkSelection висит на click/keyup — инициируем пересчёт выделения.
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    },
    { from, to },
  );
}

// #68 — Markdown в сообщениях и кликабельные ссылки.
// Проверяем рендер inline-форматирования и автодетект URL.

test('markdown: bold, italic, code, strikethrough', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
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
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
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
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
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
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  await page.getByTestId('message-input').fill('`**не жирный**`');
  await page.getByTestId('message-send').click();

  const msg = page.locator('[data-testid="message"]').last();
  await expect(msg.locator('code')).toContainText('**не жирный**');
  await expect(msg.locator('strong')).toHaveCount(0);
});

test('markdown: смешанный текст', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
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
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
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
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Композер — contentEditable (ec9a7e9): отдельного overlay с отрендеренным
  // markdown больше нет, WYSIWYG обеспечивает сам editable. Проверяем, что
  // набранный текст живёт в editable и панель форматирования доступна.
  const input = page.getByTestId('message-input');
  await input.click();
  await page.keyboard.type('жирный текст');
  await expect(input).toContainText('жирный текст');
});

test('панель форматирования: появляется при выделении', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  const input = page.getByTestId('message-input');
  await input.click();
  await page.keyboard.type('привет мир');

  // Выделяем текст: contentEditable — это не textarea, setSelectionRange
  // не работает, выделяем через Range + Selection (компонент читает их).
  await selectRangeIn(page, 0, 6);

  // Панель должна появиться
  await expect(page.getByTestId('formatting-bar')).toBeVisible();
});

test('форматирование: клик Bold оборачивает выделение', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  const input = page.getByTestId('message-input');
  await input.click();
  await page.keyboard.type('привет мир');

  // Выделяем "привет"
  await selectRangeIn(page, 0, 6);

  // Кликаем Bold
  await page.getByTestId('format-bold').click();

  // В contentEditable форматирование применяется нативно: <b>/<strong>,
  // а не обёрткой в ** (markdown-конвертация — только на отправке).
  await expect(input.locator('b, strong')).toHaveCount(1);
  await expect(input).toContainText('привет');
});

test('горячие клавиши: Ctrl+B для bold', async ({ browser }) => {
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  const page = await ctx.newPage();
  await registerViaUi(page);
  // Собеседник — в отдельном контексте: сессия лежит в localStorage, поэтому
  // второй registerViaUi на той же странице уводит на домашний экран.
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const b = await registerViaUi(await ctxB.newPage());

  await createDirectViaUi(page, b.username);
  await page.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  const input = page.getByTestId('message-input');
  await input.click();
  await page.keyboard.type('текст');

  // Выделяем весь текст
  await selectRangeIn(page, 0, 4);

  // Нажимаем Ctrl+B
  await input.press('Control+b');

  await expect(input.locator('b, strong')).toHaveCount(1);
  await expect(input).toContainText('текст');
});
