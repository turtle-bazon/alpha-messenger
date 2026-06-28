import { randomUUID } from 'node:crypto';
import { expect, type Page } from '@playwright/test';
import { createInvite } from './db';

// Регистрация нового пользователя через UI и вход в приложение.
// Возвращает креды для последующего повторного входа в сценарии.
export async function registerViaUi(
  page: Page,
): Promise<{ username: string; password: string }> {
  const invite = await createInvite();
  const username = `u_${randomUUID().slice(0, 8)}`;
  const password = 'pw-secret-123';
  await page.goto(`/register?invite=${invite}`);
  await page.getByLabel('Имя пользователя').fill(username);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', { name: 'Создать аккаунт' }).click();
  await expect(page.getByTestId('app-home')).toBeVisible();
  return { username, password };
}

// Создание direct-чата через UI: синяя «+» открывает диалог, дальше — username.
export async function createDirectViaUi(
  page: Page,
  username: string,
): Promise<void> {
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-input').fill(username);
  await page.getByTestId('new-chat-submit').click();
  await expect(page.getByTestId('new-chat-dialog')).toHaveCount(0);
}

// Создание группы через UI: вкладка «Новая группа», название и выбор участников
// из списка знакомых (с кем уже есть личный чат). members — их username.
export async function createGroupViaUi(
  page: Page,
  title: string,
  members: string[],
): Promise<void> {
  await page.getByTestId('new-chat-button').click();
  await page.getByTestId('new-chat-tab-group').click();
  await page.getByTestId('new-group-title').fill(title);
  for (const m of members) {
    await page.getByTestId('new-group-option').filter({ hasText: m }).click();
  }
  await page.getByTestId('new-group-submit').click();
  await expect(page.getByTestId('new-chat-dialog')).toHaveCount(0);
}
