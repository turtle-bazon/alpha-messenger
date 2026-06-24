import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Минимальный валидный PNG (1×1) для подстановки в file input.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

// Item 18: прикрепление изображения, простой редактор и отправка inline-картинки.
// Картинка едет прямо в теле сообщения и доходит до собеседника вживую по WS.
test('отправка изображения через редактор доходит до собеседника', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  // Чат A↔B, оба открыли переписку.
  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // A прикрепляет изображение → открывается редактор.
  await pageA.getByTestId('image-input').setInputFiles({
    name: 'pic.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_1x1, 'base64'),
  });
  await expect(pageA.getByTestId('image-editor')).toBeVisible();

  // Поворот, подпись и отправка.
  await pageA.getByTestId('image-rotate').click();
  await pageA.getByTestId('image-caption').fill('фото-привет');
  await pageA.getByTestId('image-send').click();

  // Редактор закрылся, у A картинка в переписке (перекодирована в JPEG).
  await expect(pageA.getByTestId('image-editor')).toHaveCount(0);
  await expect(pageA.getByTestId('message-image')).toHaveAttribute(
    'src',
    /^data:image\//,
  );

  // У B картинка доставлена вживую, вместе с подписью.
  await expect(pageB.getByTestId('message-image')).toHaveAttribute(
    'src',
    /^data:image\//,
  );
  await expect(pageB.getByTestId('messages')).toContainText('фото-привет');

  // В списке чатов превью последнего сообщения — «фото».
  await expect(
    pageB.getByTestId('chat-item').filter({ hasText: a.username }),
  ).toContainText('📷');
});
