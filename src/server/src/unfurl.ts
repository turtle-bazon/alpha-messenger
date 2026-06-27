import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { config } from './config';

// Разворачивание ссылок (#32). Сервер сам тянет страницу (браузер не может —
// CORS) и отдаёт метаданные OpenGraph + байты картинки превью. Всё под жёсткой
// SSRF-защитой: только http/https, отказ на приватные адреса, перепроверка хоста
// на каждом редиректе, таймаут и потолки размера.

export interface UnfurlImage {
  mime: string;
  dataBase64: string;
}

export interface UnfurlResult {
  url: string;
  title: string;
  description?: string;
  siteName?: string;
  image?: UnfurlImage;
}

const UA = 'AlphaMessengerBot/1.0 (+link-preview)';

function ipv4Blocked(ip: string): boolean {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = p;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // частная 10/8
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // частная 172.16/12
  if (a === 192 && b === 168) return true; // частная 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && c === 0) return true; // 192.0.0.0/24
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4)
  return false;
}

function ipv6Blocked(ip: string): boolean {
  const x = ip.toLowerCase();
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4-mapped
  if (mapped) return ipv4Blocked(mapped[1]);
  if (x === '::1' || x === '::') return true; // loopback / unspecified
  if (/^f[cd][0-9a-f]{2}:/.test(x)) return true; // ULA fc00::/7
  if (/^fe[89ab][0-9a-f]:/.test(x)) return true; // link-local fe80::/10
  return false;
}

function ipBlocked(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Blocked(ip);
  if (v === 6) return ipv6Blocked(ip);
  return true; // не распознали — блокируем
}

// Резолвим хост и блокируем, если ХОТЬ ОДИН адрес приватный (защита от того, что
// домен резолвится сразу в публичный и приватный IP). Нерезолвимый — тоже блок.
async function hostBlocked(hostname: string): Promise<boolean> {
  if (config.unfurl.allowPrivate) return false;
  let ips: string[];
  try {
    if (isIP(hostname)) ips = [hostname];
    else ips = (await lookup(hostname, { all: true })).map((r) => r.address);
  } catch {
    return true;
  }
  if (ips.length === 0) return true;
  return ips.some(ipBlocked);
}

export function parseHttpUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u;
}

interface Fetched {
  res: Response;
  finalUrl: string;
}

// Фетч с ручным обходом редиректов: каждый хоп заново проверяем на приватность
// (защита от редиректа во внутреннюю сеть), считаем хопы, ставим таймаут.
async function fetchGuarded(raw: string, accept: string): Promise<Fetched | null> {
  let current = raw;
  for (let hop = 0; hop <= config.unfurl.maxRedirects; hop++) {
    const u = parseHttpUrl(current);
    if (!u) return null;
    if (await hostBlocked(u.hostname)) return null;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), config.unfurl.timeoutMs);
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { 'user-agent': UA, accept },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!loc) return null;
      try {
        current = new URL(loc, u).toString();
      } catch {
        return null;
      }
      continue;
    }
    if (res.status !== 200) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    return { res, finalUrl: u.toString() };
  }
  return null; // слишком много редиректов
}

// Вычитываем тело не больше maxBytes; сообщаем, обрезали ли (для картинок
// обрезанный результат бракуем, для HTML — парсим что есть).
async function readCapped(
  res: Response,
  maxBytes: number,
): Promise<{ buf: Buffer; truncated: boolean }> {
  if (!res.body) return { buf: Buffer.alloc(0), truncated: false };
  const chunks: Buffer[] = [];
  let total = 0;
  let truncated = false;
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
    total += chunk.length;
    if (total > maxBytes) {
      truncated = true;
      await res.body.cancel().catch(() => undefined);
      break;
    }
  }
  return { buf: Buffer.concat(chunks).subarray(0, maxBytes), truncated };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&(?:#39|apos);/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // amp последним, чтобы не раскрыть дважды
}

function metaAttr(tag: string, name: string): string | undefined {
  const m = tag.match(
    new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  if (!m) return undefined;
  return decodeEntities((m[2] ?? m[3] ?? m[4] ?? '').trim());
}

interface PageMeta {
  title?: string;
  description?: string;
  siteName?: string;
  imageUrl?: string;
}

export function extractMeta(html: string, baseUrl: string): PageMeta {
  const props: Record<string, string> = {};
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = m[0];
    const key = (metaAttr(tag, 'property') ?? metaAttr(tag, 'name'))?.toLowerCase();
    const content = metaAttr(tag, 'content');
    if (key && content && !(key in props)) props[key] = content;
  }

  let title = props['og:title'];
  if (!title) {
    const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (t) title = decodeEntities(t[1].trim());
  }
  const description = props['og:description'] ?? props['description'];
  const siteName = props['og:site_name'];

  let imageUrl: string | undefined =
    props['og:image'] ?? props['og:image:url'] ?? props['twitter:image'];
  if (imageUrl) {
    try {
      imageUrl = new URL(imageUrl, baseUrl).toString();
    } catch {
      imageUrl = undefined;
    }
  }
  return { title, description, siteName, imageUrl };
}

async function fetchImage(rawUrl: string): Promise<UnfurlImage | undefined> {
  const got = await fetchGuarded(rawUrl, 'image/*');
  if (!got) return undefined;
  const mime = (got.res.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (!mime.startsWith('image/')) {
    await got.res.body?.cancel().catch(() => undefined);
    return undefined;
  }
  const { buf, truncated } = await readCapped(got.res, config.unfurl.maxImageBytes);
  if (truncated || buf.length === 0) return undefined; // обрезанная картинка битая
  return { mime, dataBase64: buf.toString('base64') };
}

// Главная функция: вернуть превью или null (страница недоступна/заблокирована/
// без заголовка). Бросает только на заведомо неверном URL (не http/https) —
// роут отвечает на это 400.
export async function unfurl(rawUrl: string): Promise<UnfurlResult | null> {
  const u = parseHttpUrl(rawUrl);
  if (!u) throw new Error('invalid url');

  const page = await fetchGuarded(rawUrl, 'text/html,application/xhtml+xml');
  if (!page) return null;

  const ct = (page.res.headers.get('content-type') ?? '').toLowerCase();
  if (!ct.includes('text/html') && !ct.includes('application/xhtml')) {
    await page.res.body?.cancel().catch(() => undefined);
    return null;
  }

  const { buf } = await readCapped(page.res, config.unfurl.maxHtmlBytes);
  const meta = extractMeta(buf.toString('utf8'), page.finalUrl);
  const title = meta.title;
  if (!title) return null; // без заголовка карточка бессмысленна

  const image = meta.imageUrl ? await fetchImage(meta.imageUrl) : undefined;
  return {
    url: rawUrl, // ссылка ведёт на то, что набрал пользователь
    title,
    description: meta.description,
    siteName: meta.siteName,
    image,
  };
}
