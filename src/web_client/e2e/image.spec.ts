import { expect, test } from '@playwright/test';
import { makePng, sendImage } from './helpers/media';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Минимальный валидный PNG (1×1) для подстановки в file input.
const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC';

// Item 18 / блобы: прикрепление изображения, редактор и отправка. Полный файл
// уходит в блоб (POST /api/blobs), а в теле сообщения едет тонкий thumbnail —
// он и показывается в пузыре, доходя до собеседника вживую по WS.
test('отправка изображения через редактор доходит до собеседника', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ locale: 'ru-RU' });
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
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

// Полноразмер из блоба: клик по превью открывает lightbox, который тянет полный
// файл по GET /api/blobs/{id} (object URL). Собеседник тоже авторизован скачать
// блоб (членство в чате с неудалённым сообщением, ссылающимся на блоб).
test('полноразмерное изображение открывается из блоба по клику', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ locale: 'ru-RU' });
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  await pageA.getByTestId('image-input').setInputFiles({
    name: 'pic.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_1x1, 'base64'),
  });
  await expect(pageA.getByTestId('image-editor')).toBeVisible();
  await pageA.getByTestId('image-send').click();
  await expect(pageA.getByTestId('image-editor')).toHaveCount(0);

  // Отправитель: клик по превью открывает полноразмер из загруженного блоба.
  await pageA.getByTestId('message-image').click();
  await expect(pageA.getByTestId('media-viewer')).toBeVisible();
  await expect(pageA.getByTestId('media-viewer-img')).toHaveAttribute(
    'src',
    /^blob:/,
  );

  // Получатель: блоб скачивается по членству в чате — полноразмер тоже открывается.
  await expect(pageB.getByTestId('message-image')).toBeVisible();
  await pageB.getByTestId('message-image').click();
  await expect(pageB.getByTestId('media-viewer-img')).toHaveAttribute(
    'src',
    /^blob:/,
  );
});

// Item 17: вставка картинки из буфера (Ctrl/Cmd+V) в поле ввода открывает тот же
// редактор, что и прикрепление через 📎, и дальше едет тем же блоб-путём. Paste
// синтезируем: real-событие 'paste' с clipboardData, содержащим image-файл
// (clipboardData задаём через defineProperty — конструктор его не выставляет).
test('вставка изображения из буфера открывает редактор и отправляется', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ locale: 'ru-RU' });
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // Вставляем картинку в поле ввода A.
  const input = pageA.getByTestId('message-input');
  await input.click();
  await input.evaluate((el, data) => {
    const bin = atob(data);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const dt = new DataTransfer();
    dt.items.add(new File([arr], 'paste.png', { type: 'image/png' }));
    const ev = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'clipboardData', { value: dt });
    el.dispatchEvent(ev);
  }, PNG_1x1);

  // Открылся редактор → подпись и отправка.
  await expect(pageA.getByTestId('image-editor')).toBeVisible();
  await pageA.getByTestId('image-caption').fill('из-буфера');
  await pageA.getByTestId('image-send').click();
  await expect(pageA.getByTestId('image-editor')).toHaveCount(0);

  // Картинка у A и доставлена B вживую, вместе с подписью.
  await expect(pageA.getByTestId('message-image')).toHaveAttribute(
    'src',
    /^data:image\//,
  );
  await expect(pageB.getByTestId('message-image')).toHaveAttribute(
    'src',
    /^data:image\//,
  );
  await expect(pageB.getByTestId('messages')).toContainText('из-буфера');
});

// #87: маленькие и средние картинки не должны ограничиваться натуральной
// шириной inline-превью (~320px) — пузырь медиа тянется до стандартной ширины
// (480px), соотношение сторон сохраняется, на узких экранах сжимается.
test('изображение рендерится стандартной медиа-шириной (#87)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ locale: 'ru-RU' });
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // 640×400 — после масштабирования в стандартный бокс ровно 480×300.
  await sendImage(pageA, makePng(640, 400), 'широкое');

  // У отправителя и у получателя пузырь медиа ~480px, высота по пропорции.
  for (const page of [pageA, pageB]) {
    const img = page.getByTestId('message-image');
    await expect(img).toHaveAttribute('src', /^data:image\//);
    const box = (await img.boundingBox())!;
    assertBox(box, 480, 300);
  }
});

// Совсем маленькая картинка тоже растягивается до стандартной ширины
// (метаданные дают точный бокс, апскейл ограничен этим боксом).
test('маленькое изображение растягивается до медиа-ширины (#87)', async ({
  browser,
}) => {
  const ctxA = await browser.newContext({ locale: 'ru-RU' });
  const ctxB = await browser.newContext({ locale: 'ru-RU' });
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // 100×80 -> бокс 480×384.
  await sendImage(pageA, makePng(100, 80));

  for (const page of [pageA, pageB]) {
    const img = page.getByTestId('message-image');
    await expect(img).toHaveAttribute('src', /^data:image\//);
    assertBox((await img.boundingBox())!, 480, 384);
  }
});

function assertBox(
  box: { x: number; y: number; width: number; height: number },
  w: number,
  h: number,
): void {
  expect(Math.abs(box.width - w)).toBeLessThanOrEqual(2);
  expect(Math.abs(box.height - h)).toBeLessThanOrEqual(2);
}
