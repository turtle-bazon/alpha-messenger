import { expect, test } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Calls 1-on-1 (#81). WebRTC between two pages of one browser connects via host
// candidates (no STUN/TURN needed); fake media devices provide audio/video.
test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  },
});

// Full cycle: A calls B by audio → B accepts → both active → A hangs up.
test('аудиозвонок: вызов, ответ, соединение, сброс', async ({ browser }) => {
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

  // A starts an audio call from the chat header.
  await pageA.getByTestId('call-audio-btn').click();

  // A: outgoing phase.
  await expect(pageA.getByTestId('call-overlay')).toBeVisible();
  await expect(pageA.getByTestId('call-overlay')).toHaveAttribute('data-phase', 'outgoing');
  await expect(pageA.getByTestId('call-peer-name')).toHaveText(b.username);

  // B: incoming ring with caller name.
  await expect(pageB.getByTestId('call-overlay')).toBeVisible({ timeout: 10_000 });
  await expect(pageB.getByTestId('call-overlay')).toHaveAttribute('data-phase', 'incoming');
  await expect(pageB.getByTestId('call-peer-name')).toHaveText(a.username);

  // B accepts (audio).
  await pageB.getByTestId('call-accept').click();

  // Both sides reach 'active' (WebRTC connected via host candidates).
  await expect(pageA.getByTestId('call-overlay')).toHaveAttribute('data-phase', 'active', {
    timeout: 20_000,
  });
  await expect(pageB.getByTestId('call-overlay')).toHaveAttribute('data-phase', 'active', {
    timeout: 20_000,
  });

  // A hangs up → overlays close on both sides.
  await pageA.getByTestId('call-hangup').click();
  await expect(pageA.getByTestId('call-overlay')).toHaveCount(0);
  await expect(pageB.getByTestId('call-overlay')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});

// Decline: B rejects → A's outgoing call ends.
test('звонок отклонён получателем', async ({ browser }) => {
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

  await pageA.getByTestId('call-audio-btn').click();
  await expect(pageB.getByTestId('call-overlay')).toBeVisible({ timeout: 10_000 });
  await pageB.getByTestId('call-decline').click();

  await expect(pageA.getByTestId('call-overlay')).toHaveCount(0);
  await expect(pageB.getByTestId('call-overlay')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
