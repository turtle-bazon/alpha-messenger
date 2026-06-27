import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { AddressInfo } from 'node:net';
import { buildApp } from '../src/app';
import { pool } from '../src/db';
import { runMigrations } from '../src/migrate';
import { auth, registerUser } from './helpers';

const app = buildApp();

// Локальная фикстура-сайт: OG-страница, её картинка, plain-текст и редирект.
const PNG_1x1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC',
  'base64',
);
const HTML = `<!doctype html><html><head>
<title>Plain Title</title>
<meta property="og:title" content="OG Заголовок &amp; тест">
<meta property="og:description" content="Описание страницы">
<meta property="og:site_name" content="Example Site">
<meta property="og:image" content="/img.png">
</head><body>hi</body></html>`;

const site = http.createServer((req, res) => {
  if (req.url === '/page') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(HTML);
  } else if (req.url === '/img.png') {
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end(PNG_1x1);
  } else if (req.url === '/plain') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('just text');
  } else if (req.url === '/redirect') {
    res.writeHead(302, { location: '/page' });
    res.end();
  } else {
    res.writeHead(404);
    res.end();
  }
});

let base = '';

before(async () => {
  await runMigrations();
  await app.ready();
  await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => site.close(() => resolve()));
  await pool.end();
});

function unfurl(token: string, url: string) {
  return app.inject({
    method: 'POST',
    url: '/api/unfurl',
    headers: auth(token),
    payload: { url },
  });
}

test('unfurl: OG-страница -> метаданные + картинка превью', async () => {
  process.env.UNFURL_ALLOW_PRIVATE = '1';
  const a = await registerUser(app);

  const res = await unfurl(a.token, `${base}/page`);
  assert.equal(res.statusCode, 200);
  const { preview } = res.json();
  assert.ok(preview, 'превью есть');
  assert.equal(preview.url, `${base}/page`);
  assert.equal(preview.title, 'OG Заголовок & тест'); // entity раскрыт
  assert.equal(preview.description, 'Описание страницы');
  assert.equal(preview.siteName, 'Example Site');
  assert.equal(preview.image.mime, 'image/png');
  assert.equal(
    Buffer.from(preview.image.dataBase64, 'base64').length,
    PNG_1x1.length,
  );
});

test('unfurl: редирект на OG-страницу разворачивается', async () => {
  process.env.UNFURL_ALLOW_PRIVATE = '1';
  const a = await registerUser(app);
  const res = await unfurl(a.token, `${base}/redirect`);
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().preview, 'после редиректа превью получено');
});

test('unfurl: не-HTML страница -> превью нет', async () => {
  process.env.UNFURL_ALLOW_PRIVATE = '1';
  const a = await registerUser(app);
  const res = await unfurl(a.token, `${base}/plain`);
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().preview, null);
});

test('unfurl: приватный адрес блокируется (SSRF)', async () => {
  delete process.env.UNFURL_ALLOW_PRIVATE; // защита включена
  const a = await registerUser(app);
  const res = await unfurl(a.token, `${base}/page`); // 127.0.0.1 -> блок
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().preview, null);
  process.env.UNFURL_ALLOW_PRIVATE = '1';
});

test('unfurl: не-http URL -> 400', async () => {
  const a = await registerUser(app);
  for (const bad of ['ftp://example.com', 'not a url', 'file:///etc/passwd']) {
    const res = await unfurl(a.token, bad);
    assert.equal(res.statusCode, 400, bad);
  }
});

test('unfurl: без токена -> 401', async () => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/unfurl',
    payload: { url: `${base}/page` },
  });
  assert.equal(res.statusCode, 401);
});
