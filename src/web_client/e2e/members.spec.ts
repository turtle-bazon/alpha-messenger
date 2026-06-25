import { expect, test } from '@playwright/test';
import { registerViaApi } from './helpers/api';
import { createDirectViaUi, registerViaUi } from './helpers/ui';

// Утилита: A создаёт группу через UI. Участников выбирают из знакомых (тех, с кем
// уже есть личный чат) — поэтому сперва заводим личные чаты, затем отмечаем их в
// списке кандидатов вкладки «Новая группа».
async function createGroupViaUi(
  page: import('@playwright/test').Page,
  title: string,
  usernames: string[],
): Promise<void> {
  for (const u of usernames) {
    await createDirectViaUi(page, u);
  }
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();
  await page.getByTestId('new-group-title').fill(title);
  for (const u of usernames) {
    await page.getByTestId('new-group-option').filter({ hasText: u }).click();
  }
  await page.getByTestId('new-group-submit').click();
  await expect(page.getByTestId('new-chat-dialog')).toHaveCount(0);
}

// Проверка фичи присутствия: статус собеседника в заголовке direct-чата,
// живо реагирующий на онлайн/офлайн (два контекста).
test('заголовок direct: статус собеседника в сети/не в сети', async ({
  browser,
}) => {
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  await registerViaUi(pageA);
  const b = await registerViaUi(pageB);

  // A создаёт direct с B — оба сейчас онлайн
  await createDirectViaUi(pageA, b.username);
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();

  // Заголовок A показывает собеседника «в сети»
  await expect(pageA.getByTestId('conv-subtitle')).toHaveText('в сети');

  // B уходит (закрываем контекст) — A вживую видит «не в сети»
  await ctxB.close();
  await expect(pageA.getByTestId('conv-subtitle')).toHaveText('не в сети');

  await ctxA.close();
});

// Проверка фичи для группы: заголовок показывает число участников и онлайн.
test('заголовок группы: число участников и онлайн', async ({ page }) => {
  const b = await registerViaApi();
  const c = await registerViaApi();
  await registerViaUi(page);

  await createGroupViaUi(page, 'Команда', [b.username, c.username]);
  await page.getByTestId('chat-item').first().click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // 3 участника всего; в сети только сам создатель (B и C через API, без WS)
  await expect(page.getByTestId('conv-subtitle')).toHaveText(
    '3 участника, 1 в сети',
  );
});

// Добавление участника создателем (как в Telegram). A создаёт группу с B,
// затем добавляет живого клиента C — у C группа появляется в списке, у A растёт
// счётчик участников. Не-создатель C формы добавления не видит.
test('окно участников: добавление участника создателем', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const ctxC = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageC = await ctxC.newPage();

  await registerViaUi(pageA); // создатель
  const b = await registerViaApi();
  const c = await registerViaUi(pageC); // живой клиент, добавим его позже

  // A создаёт группу пока только с B
  await createGroupViaUi(pageA, 'Экипаж', [b.username]);
  await pageA.getByTestId('chat-item').first().click();
  await expect(pageA.getByTestId('conversation-open')).toBeVisible();
  await expect(pageA.getByTestId('conv-subtitle')).toContainText('2 участника');

  // C пока не видит этой группы
  await expect(
    pageC.getByTestId('chat-item').filter({ hasText: 'Экипаж' }),
  ).toHaveCount(0);

  // A открывает окно участников и добавляет C по username
  await pageA.getByTestId('conv-header-info').click();
  await expect(pageA.getByTestId('members-dialog')).toBeVisible();
  await expect(pageA.getByTestId('member-row')).toHaveCount(2);
  await pageA.getByTestId('member-add-input').fill(c.username);
  await pageA.getByTestId('member-add-submit').click();

  // Список вырос до трёх, среди них C
  await expect(pageA.getByTestId('member-row')).toHaveCount(3);
  await expect(pageA.getByTestId('members-list')).toContainText(c.username);
  await pageA.getByTestId('members-close').click();

  // Заголовок A обновился до 3 участников
  await expect(pageA.getByTestId('conv-subtitle')).toContainText('3 участника');

  // У C группа появилась в списке вживую, он может её открыть
  const cItem = pageC.getByTestId('chat-item').filter({ hasText: 'Экипаж' });
  await expect(cItem).toHaveCount(1);
  await cItem.click();
  await expect(pageC.getByTestId('conversation-open')).toBeVisible();

  // C — не создатель: формы добавления в окне участников нет
  await pageC.getByTestId('conv-header-info').click();
  await expect(pageC.getByTestId('members-dialog')).toBeVisible();
  await expect(pageC.getByTestId('member-add-input')).toHaveCount(0);

  await ctxA.close();
  await ctxC.close();
});

// Отдельный сценарий окна: открыть диалог участников и проверить его содержимое,
// затем — удаление участника создателем.
test('окно участников: открытие, список и удаление создателем', async ({
  page,
}) => {
  const b = await registerViaApi();
  const c = await registerViaApi();
  const me = await registerViaUi(page);

  await createGroupViaUi(page, 'Проект', [b.username, c.username]);
  await page.getByTestId('chat-item').first().click();
  await expect(page.getByTestId('conversation-open')).toBeVisible();

  // Клик по заголовку открывает окно участников
  await expect(page.getByTestId('members-dialog')).toHaveCount(0);
  await page.getByTestId('conv-header-info').click();
  await expect(page.getByTestId('members-dialog')).toBeVisible();

  // В списке три участника: я (создатель) + B + C
  await expect(page.getByTestId('member-row')).toHaveCount(3);
  await expect(page.getByTestId('members-list')).toContainText(me.username);
  await expect(page.getByTestId('members-list')).toContainText(b.username);
  await expect(page.getByTestId('members-list')).toContainText(c.username);

  // Создатель видит кнопки удаления для других (не для создателя): 2 кнопки
  await expect(page.getByTestId('member-remove')).toHaveCount(2);

  // Удаляем B — строка исчезает, остаётся 2 участника
  const bRow = page.getByTestId('member-row').filter({ hasText: b.username });
  await bRow.getByTestId('member-remove').click();
  await expect(page.getByTestId('member-row')).toHaveCount(2);
  await expect(page.getByTestId('members-list')).not.toContainText(b.username);

  // Закрытие окна
  await page.getByTestId('members-close').click();
  await expect(page.getByTestId('members-dialog')).toHaveCount(0);

  // Заголовок чата обновился: участников стало 2
  await expect(page.getByTestId('conv-subtitle')).toContainText('2 участника');
});
