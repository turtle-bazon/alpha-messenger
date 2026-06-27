import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Item 32 / превью ссылок. Сервер сам разворачивает URL (его логика покрыта
// серверным тестом unfurl.test.ts); здесь — клиентский путь: набор URL → карточка
// в композере → отправка → доставка карточки собеседнику по WS → крестик снимает
// превью. Ответ /api/unfurl перехватываем в браузере (dev-сервер в Docker не
// достучится до фикстуры на хосте), что и делает сценарий детерминированным.

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';
const TEST_URL = 'https://example.com/article';

// Перехват разворачивания ссылки: на любой POST /api/unfurl возвращаем готовое
// превью с TEST_URL и крошечной картинкой.
async function stubUnfurl(page: import('@playwright/test').Page): Promise<void> {
  await page.route('**/api/unfurl', async (route) => {
    await route.fulfill({
      json: {
        preview: {
          url: TEST_URL,
          title: 'Заголовок статьи',
          description: 'Краткое описание статьи для превью.',
          siteName: 'Example',
          image: { mime: 'image/png', dataBase64: PNG_1x1 },
        },
      },
    });
  });
}

test('превью ссылки: карточка в композере, отправка и доставка собеседнику', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await stubUnfurl(pageA);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // A набирает сообщение со ссылкой — над полем появляется карточка превью.
  await pageA.getByTestId('message-input').fill(`смотри: ${TEST_URL}`);
  const card = pageA.getByTestId('composer-link-preview');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Заголовок статьи');
  await expect(card).toContainText('Example');

  // Отправка → карточка ушла из композера, превью в пузыре у A.
  await pageA.getByTestId('message-send').click();
  await expect(pageA.getByTestId('composer-link-preview')).toHaveCount(0);
  const linkA = pageA.getByTestId('message-link');
  await expect(linkA).toBeVisible();
  await expect(linkA).toContainText('Заголовок статьи');
  await expect(linkA).toHaveAttribute('href', TEST_URL);

  // B получает карточку вживую по WS (превью вшито в сообщение, B не дёргает unfurl).
  const linkB = pageB.getByTestId('message-link');
  await expect(linkB).toBeVisible();
  await expect(linkB).toContainText('Заголовок статьи');
  await expect(linkB).toContainText('Краткое описание');
  await expect(linkB).toHaveAttribute('href', TEST_URL);
});

test('превью ссылки: крестик снимает превью, ссылка уходит без карточки', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await stubUnfurl(pageA);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  await pageA.getByTestId('message-input').fill(`без превью: ${TEST_URL}`);
  await expect(pageA.getByTestId('composer-link-preview')).toBeVisible();

  // Снимаем превью крестиком — карточка пропадает и больше не всплывает.
  await pageA.getByTestId('composer-link-dismiss').click();
  await expect(pageA.getByTestId('composer-link-preview')).toHaveCount(0);

  // Отправляем — сообщение доходит, но карточки-превью нет ни у кого.
  await pageA.getByTestId('message-send').click();
  await expect(pageB.getByTestId('messages')).toContainText('без превью');
  await expect(pageA.getByTestId('message-link')).toHaveCount(0);
  await expect(pageB.getByTestId('message-link')).toHaveCount(0);
});
