import { expect, test, type Page } from '@playwright/test';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

async function createGroupViaUi(
  page: Page,
  title: string,
  usernames: string[],
): Promise<void> {
  for (const u of usernames) await createDirectViaUi(page, u);
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();
  await page.getByTestId('new-group-title').fill(title);
  for (const u of usernames) {
    await page.getByTestId('new-group-option').filter({ hasText: u }).click();
  }
  await page.getByTestId('new-group-submit').click();
  await expect(page.getByTestId('new-chat-dialog')).toHaveCount(0);
}

// Задача #21: в группе у чужих сообщений показывается имя автора (над первым в
// серии) и аватар (у последнего в серии); у своих — нет. В личном чате ни имени,
// ни аватара отправителя нет.
test('идентификация отправителя: имя и аватар в группе, ничего в личке', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const a = await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  // B заводит группу с A и пишет два сообщения подряд (одна серия).
  await createGroupViaUi(pageB, 'Команда', [a.username]);
  await pageB.getByTestId('chat-item').filter({ hasText: 'Команда' }).click();
  await pageB.getByTestId('conversation-open').waitFor();
  await pageB.getByTestId('message-input').fill('от B раз');
  await pageB.getByTestId('message-input').press('Enter');
  await pageB.getByTestId('message-input').fill('от B два');
  await pageB.getByTestId('message-input').press('Enter');

  // A открывает группу и отвечает.
  await pageA.getByTestId('chat-item').filter({ hasText: 'Команда' }).click();
  await pageA.getByTestId('conversation-open').waitFor();
  await expect(
    pageA.getByTestId('message').filter({ hasText: 'от B два' }),
  ).toBeVisible();
  await pageA.getByTestId('message-input').fill('от A');
  await pageA.getByTestId('message-input').press('Enter');
  await expect(
    pageA.getByTestId('message').filter({ hasText: 'от A' }),
  ).toBeVisible();

  // Имя автора — над первым сообщением серии B (ровно один на серию).
  await expect(pageA.getByTestId('bubble-sender')).toHaveCount(1);
  await expect(pageA.getByTestId('bubble-sender')).toHaveText(b.username);
  // Аватар автора — у последнего сообщения серии B.
  await expect(pageA.locator('.bubble-avatar')).toHaveCount(1);
  // У своего сообщения имени автора нет.
  await expect(
    pageA
      .getByTestId('message')
      .filter({ hasText: 'от A' })
      .getByTestId('bubble-sender'),
  ).toHaveCount(0);

  // Личный чат: B пишет A в direct — у A ни имени, ни аватара отправителя.
  await pageB.getByTestId('chat-item').filter({ hasText: a.username }).click();
  await pageB.getByTestId('conversation-open').waitFor();
  await pageB.getByTestId('message-input').fill('в личке');
  await pageB.getByTestId('message-input').press('Enter');

  // В списке A личный чат подписан именем собеседника (B).
  await pageA.getByTestId('chat-item').filter({ hasText: b.username }).click();
  await pageA.getByTestId('conversation-open').waitFor();
  await expect(
    pageA.getByTestId('message').filter({ hasText: 'в личке' }),
  ).toBeVisible();
  await expect(pageA.getByTestId('bubble-sender')).toHaveCount(0);
  await expect(pageA.locator('.bubble-avatar')).toHaveCount(0);

  await ctxA.close();
  await ctxB.close();
});
