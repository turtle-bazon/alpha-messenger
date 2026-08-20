import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Голосовые и видео сообщения (#34). Запись идёт через MediaRecorder — в
// headless-chromium подставляем фейковые камеру/микрофон и автогрант пермишенов.
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

// A удерживает 🎙 → панель записи с таймером; отпускание — отправка.
// B получает голосовое вживую, play/pause работает.
test('голосовое сообщение: запись удержанием и воспроизведение у собеседника', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  // При пустом вводе на месте «Отправить» — кнопка микрофона.
  const mic = pageA.getByTestId('mic-btn');
  await expect(mic).toBeVisible();

  // Hold ≥250мс запускает запись; держим ~1.5с, чтобы набрать длительность.
  const box = await mic.boundingBox();
  if (!box) throw new Error('no mic button box');
  await pageA.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pageA.mouse.down();
  await expect(pageA.getByTestId('rec-bar')).toBeVisible();
  await expect(pageA.getByTestId('rec-timer')).toContainText('0:0', { timeout: 3000 });
  await pageA.waitForTimeout(1200);
  await pageA.mouse.up();

  // Панель записи закрылась, пузырь голосового появился у отправителя.
  await expect(pageA.getByTestId('rec-bar')).toHaveCount(0);
  await expect(pageA.getByTestId('voice-bubble')).toHaveCount(1);

  // У B голосовое доставлено вживую.
  await expect(pageB.getByTestId('voice-bubble')).toHaveCount(1);

  // B нажимает play → кнопка переходит в «Пауза» (аудио реально играет).
  const playBtn = pageB.getByTestId('voice-play');
  await playBtn.click();
  await expect(playBtn).toHaveAttribute('aria-label', 'Пауза');
  // Стоп.
  await playBtn.click();
  await expect(playBtn).toHaveAttribute('aria-label', 'Воспроизвести');

  // Превью в списке чатов у B — «Голосовое».
  await expect(
    pageB.getByTestId('chat-item').filter({ hasText: a.username }),
  ).toContainText('🎤');

  await ctxA.close();
  await ctxB.close();
});

// Свайп влево во время записи — отмена: пузыря нет ни у A, ни у B.
test('голосовое сообщение: свайп влево отменяет запись', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  const mic = pageA.getByTestId('mic-btn');
  const box = await mic.boundingBox();
  if (!box) throw new Error('no mic button box');
  const cy = box.y + box.height / 2;
  await pageA.mouse.move(box.x + box.width / 2, cy);
  await pageA.mouse.down();
  await expect(pageA.getByTestId('rec-bar')).toBeVisible();
  await pageA.waitForTimeout(1000);

  // Свайп влево дальше порога (-80px).
  await pageA.mouse.move(box.x + box.width / 2 - 120, cy, { steps: 8 });
  await expect(pageA.getByTestId('rec-hint')).toContainText('отмена');
  await pageA.mouse.up();

  // Ничего не отправилось.
  await expect(pageA.getByTestId('voice-bubble')).toHaveCount(0);
  await expect(pageB.getByTestId('voice-bubble')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

// Клик по 🎙 переключает режим на видео; hold открывает модалку камеры,
// запись → стоп → отправка; у B видео открывается в плеере.
test('видеосообщение: запись в модалке и воспроизведение у собеседника', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await expect(pageB.getByTestId('conversation-open')).toBeVisible();

  const mic = pageA.getByTestId('mic-btn');

  // Клик — toggle режима voice→video.
  await mic.click();
  await expect(mic).toHaveAttribute('aria-label', /Видео/);

  // Hold — модалка камеры, запись стартует сама.
  const box = await mic.boundingBox();
  if (!box) throw new Error('no mic button box');
  await pageA.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await pageA.mouse.down();
  await pageA.waitForTimeout(500);
  await pageA.mouse.up();
  const modal = pageA.getByTestId('video-recorder');
  await expect(modal).toBeVisible();
  await expect(pageA.getByTestId('video-rec-timer')).toBeVisible({ timeout: 10_000 });

  // Немного пишем и останавливаем вручную.
  await pageA.waitForTimeout(1500);
  await pageA.getByTestId('video-rec-stop').click();

  // Превью записанного → отправка.
  await expect(pageA.getByTestId('video-rec-preview')).toBeVisible();
  await pageA.getByTestId('video-rec-send').click();
  await expect(modal).toHaveCount(0);

  // У B видео-пузырь доставлен вживую; клик открывает плеер.
  const videoBubble = pageB.getByTestId('message-video');
  await expect(videoBubble).toHaveCount(1);
  await videoBubble.click();
  await expect(pageB.getByTestId('media-viewer-video')).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
