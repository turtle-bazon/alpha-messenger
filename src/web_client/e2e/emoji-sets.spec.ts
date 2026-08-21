import { expect, test } from '@playwright/test';
import { makePng } from './helpers/media';
import { registerViaApi, type ApiUser } from './helpers/api';
import { createDirectViaUi, loginViaUi, registerViaUi } from './helpers/ui';

const API = process.env.E2E_API_URL ?? 'http://localhost:3000';

// Создаёт пак-набор картинок-эмодзи напрямую через REST от имени пользователя.
async function createEmojiPackViaApi(
  user: ApiUser,
  title: string,
  tiles: number,
): Promise<void> {
  const res = await fetch(`${API}/api/sticker-packs`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${user.token}`,
    },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error(`pack create failed: ${res.status}`);
  const pack = (await res.json()) as { packId: string };

  for (let i = 0; i < tiles; i++) {
    // Разные цвета, чтобы блобы были разными
    const png = makePng(32 + i, 32);
    const up = await fetch(`${API}/api/blobs`, {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        authorization: `Bearer ${user.token}`,
      },
      body: new Uint8Array(png),
    });
    if (!up.ok) throw new Error(`blob upload failed: ${up.status}`);
    const { blobId } = (await up.json()) as { blobId: string };
    const item = await fetch(`${API}/api/sticker-packs/${pack.packId}/items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify({ blobId }),
    });
    if (!item.ok) throw new Error(`item add failed: ${item.status}`);
  }
}

// #62: наборы картинок-эмодзи. Пак, установленный у пользователя, появляется
// в EmojiPicker отдельной вкладкой; клик по плитке отправляет компактный
// стикер-сообщение (тот же путь, что у стикеров).
test('пак эмодзи доступен в пикере и отправляется', async ({ browser }) => {
  const ctxA = await browser.newContext({ locale: 'ru-RU' });
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  // A — через API (чтобы создать пак), затем логин через UI.
  const a = await registerViaApi();
  await loginViaUi(pageA, a.username, a.password);
  await createEmojiPackViaApi(a, 'Набор A', 3);

  const b = await registerViaUi(pageB);
  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // Открываем пикер эмодзи (панель медиа, вкладка эмодзи).
  await pageA.getByTestId('emoji-btn').click();
  await expect(pageA.getByTestId('emoji-picker')).toBeVisible();

  // Пак появился чипом рядом с категориями — переключаемся на него.
  const chip = pageA.getByTestId('emoji-pack-chip').first();
  await expect(chip).toBeVisible();
  await chip.click();

  // Плитки пака видны; клик по первой отправляет сообщение-картинку.
  const tile = pageA.getByTestId('emoji-img-tile').first();
  await expect(tile).toBeVisible();
  await tile.click();

  await expect(pageA.getByTestId('message-image')).toHaveCount(1);
  await expect(pageB.getByTestId('message-image')).toHaveCount(1);

  // Панель закрылась после выбора.
  await expect(pageA.getByTestId('media-panel')).toHaveCount(0);
});
