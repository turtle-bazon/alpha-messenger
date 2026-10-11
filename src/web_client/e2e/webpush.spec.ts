import { expect, test, type BrowserContext, type CDPSession, type Page } from '@playwright/test';
import { pushSubscriptions } from './helpers/db';
import { registerViaUi } from './helpers/ui';

// Web Push (браузер / приложение на экране «Домой» iPhone). Настоящий
// push-сервис (FCM, Apple) из headless-браузера недоступен, поэтому:
//  * pushManager.subscribe подменён — браузер «подписывается» фейковым
//    endpoint'ом, а вот передача подписки серверу настоящая;
//  * push доставляется в service worker через CDP
//    (ServiceWorker.deliverPushMessage) — дальше всё как в жизни: воркер
//    рисует уведомление и сообщает странице о тестовом push.
// Серверную половину (шифрование, VAPID, ответы push-сервиса) проверяет
// src/server/test/webpush.test.ts.

const ORIGIN = 'http://localhost:5173';

// The headless shell reports Notification.permission 'denied' even when the
// permission is granted (Permissions API says 'granted'), so the client would
// never subscribe. Full Chromium in new headless mode behaves like a browser.
test.use({ channel: 'chromium' });

async function webPushContext(browser: import('@playwright/test').Browser): Promise<BrowserContext> {
  const ctx = await browser.newContext({ locale: 'ru-RU' });
  await ctx.grantPermissions(['notifications'], { origin: ORIGIN });
  await ctx.addInitScript(() => {
    let sub: unknown = null;
    const proto = PushManager.prototype as unknown as Record<string, unknown>;
    proto.subscribe = async (opts: { applicationServerKey: Uint8Array }) => {
      const endpoint = `https://push.invalid/${crypto.randomUUID()}`;
      sub = {
        endpoint,
        options: { applicationServerKey: opts.applicationServerKey },
        toJSON: () => ({ endpoint, keys: { p256dh: 'BKey', auth: 'auth' } }),
        unsubscribe: async () => {
          sub = null;
          return true;
        },
      };
      return sub;
    };
    proto.getSubscription = async () => sub;
  });
  return ctx;
}

// Registration id of the page's service worker, for CDP push delivery.
async function workerRegistrationId(page: Page): Promise<{ cdp: CDPSession; id: string }> {
  const cdp = await page.context().newCDPSession(page);
  const ids: string[] = [];
  cdp.on('ServiceWorker.workerRegistrationUpdated', (e) => {
    for (const r of e.registrations) {
      if (!r.isDeleted && r.scopeURL.startsWith(ORIGIN)) ids.push(r.registrationId);
    }
  });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => ids.length).toBeGreaterThan(0);
  return { cdp, id: ids[ids.length - 1] };
}

async function shownNotifications(page: Page): Promise<{ title: string; body: string }[]> {
  return page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    const list = await reg.getNotifications();
    return list.map((n) => ({ title: n.title, body: n.body }));
  });
}

async function openNotificationSettings(page: Page): Promise<void> {
  await page.getByTestId('settings-btn').click();
  await page.getByTestId('settings-notifications').click();
}

test('PWA: манифест и service worker на месте', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', './manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  const res = await page.request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = await res.json();
  expect(manifest.display).toBe('standalone');
  expect((await page.request.get('/sw.js')).ok()).toBe(true);
  expect((await page.request.get('/icons/icon-192.png')).ok()).toBe(true);
});

test('проверка уведомлений: тестовый push дошёл до устройства', async ({ browser }) => {
  const ctx = await webPushContext(browser);
  const page = await ctx.newPage();
  const me = await registerViaUi(page);

  // Разрешение уже есть — клиент сам подписывается и отдаёт подписку серверу.
  await expect
    .poll(async () => (await pushSubscriptions(me.username)).map((s) => s.provider))
    .toEqual(['webpush']);
  const [stored] = await pushSubscriptions(me.username);
  expect(JSON.parse(stored.endpoint).endpoint).toMatch(/^https:\/\/push\.invalid\//);

  const { cdp, id } = await workerRegistrationId(page);
  // Push-сервис «принял» (ответ сервера подменён: до push.invalid сервер не
  // достучится), а само уведомление доставляем воркеру — как сделал бы сервис.
  await page.route('**/api/push/test', async (route) => {
    const req = route.request().postDataJSON() as { testId: string; title: string; body: string };
    expect(req.title).toBe('Проверка уведомлений');
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: ORIGIN,
      registrationId: id,
      data: JSON.stringify({ type: 'test', testId: req.testId, title: req.title, body: req.body }),
    });
    await route.fulfill({
      json: {
        results: [{ subscriptionId: '1', provider: 'webpush', success: true, statusCode: 201, removed: false }],
      },
    });
  });

  await openNotificationSettings(page);
  await page.getByTestId('push-test').click();
  const result = page.getByTestId('push-test-result');
  await expect(result).toHaveAttribute('data-verdict', 'ok');
  await expect(result).toContainText('дошло до этого устройства');
  await expect
    .poll(() => shownNotifications(page))
    .toContainEqual({ title: 'Проверка уведомлений', body: 'Уведомления на этом устройстве работают' });

  await ctx.close();
});

test('проверка уведомлений: push-сервис отклонил подписку', async ({ browser }) => {
  const ctx = await webPushContext(browser);
  const page = await ctx.newPage();
  await registerViaUi(page);
  await page.route('**/api/push/test', (route) =>
    route.fulfill({
      json: {
        results: [
          { subscriptionId: '1', provider: 'webpush', success: false, statusCode: 410, removed: true },
        ],
      },
    }),
  );
  await openNotificationSettings(page);
  await page.getByTestId('push-test').click();
  const result = page.getByTestId('push-test-result');
  await expect(result).toHaveAttribute('data-verdict', 'fail');
  await expect(result).toContainText('HTTP 410');
  await ctx.close();
});

test('push о новом сообщении: воркер рисует уведомление с текстом', async ({ browser }) => {
  const ctx = await webPushContext(browser);
  const page = await ctx.newPage();
  const me = await registerViaUi(page);
  await expect.poll(async () => (await pushSubscriptions(me.username)).length).toBe(1);
  const { cdp, id } = await workerRegistrationId(page);

  const b64 = (o: unknown): string => Buffer.from(JSON.stringify(o)).toString('base64');
  const deliver = (data: unknown) =>
    cdp.send('ServiceWorker.deliverPushMessage', {
      origin: ORIGIN,
      registrationId: id,
      data: JSON.stringify(data),
    });

  // Личный чат: заголовок — отправитель, тело — текст сообщения.
  await deliver({
    type: 'message', chatId: 'c1', messageId: '101', title: 'alice', sender: null,
    ciphertext: b64({ t: 'msg', text: 'привет из push', atts: [] }), isReply: false,
  });
  // Группа: заголовок — группа, в теле — «отправитель: …»; фото — локализованная
  // подпись из строк, которые страница передала воркеру.
  await deliver({
    type: 'message', chatId: 'c2', messageId: '102', title: 'Команда', sender: 'bob',
    ciphertext: b64({ t: 'msg', text: '', atts: [{ k: 'image', blob: 'x', cap: '' }] }), isReply: false,
  });
  // Сообщение слишком велико для push — содержимого нет, но уведомление есть.
  await deliver({
    type: 'message', chatId: 'c1', messageId: '103', title: 'alice', sender: null,
    ciphertext: null, isReply: false,
  });

  await expect.poll(() => shownNotifications(page)).toEqual(
    expect.arrayContaining([
      { title: 'alice', body: 'привет из push' },
      { title: 'Команда', body: 'bob: 📷 Фото' },
      { title: 'alice', body: 'Новое сообщение' },
    ]),
  );
  await ctx.close();
});
