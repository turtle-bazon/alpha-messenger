// Конверт содержимого сообщения. Тело (шифр-)сообщения — это сериализованный
// объект: текст + массив вложений (attachments). Каждое вложение ссылается на
// блоб по content-hash (blobId) и несёт тонкий thumbnail для мгновенного превью
// в пузыре; полный файл тянется из блоба по требованию (см. doc/api.md — «Блобы»
// и status/plans/blob-client-images.md).
//
// Поверх encodeText/decodeText: в v1 шифрования нет (base64 от UTF-8 JSON),
// реальное шифрование позже встанет тем же интерфейсом без смены вызовов. Поле
// key у вложения зарезервировано под будущий ключ расшифровки блоба.
//
// Легаси: ранние сообщения кодировались как t:'text' либо t:'image' (картинка
// inline целиком в теле). decodeContent продолжает их читать (read-only);
// inline-данные легаси-картинки используются как thumbnail, blobId пустой.

import { decodeText, encodeText } from './text';

export interface ImageAttachment {
  kind: 'image';
  blobId: string; // sha256 блоба; '' у оптимистичного сообщения до загрузки
  mime: string;
  width: number;
  height: number;
  size: number; // байт полного блоба
  thumb: string; // base64 крошечного JPEG для inline-превью (без data: префикса)
  caption: string;
  key?: string; // зарезервировано: ключ расшифровки блоба (будущий E2EE)
}

// Превью ссылки (#32). Метаданные OpenGraph целиком в теле сообщения (ciphertext):
// сервер развернул ссылку один раз для отправителя, получатель только рендерит
// карточку — без повторного фетча и без утечки своего IP стороннему сайту. thumb —
// маленький inline-JPEG картинки превью (или '' если её нет), блоба тут нет.
export interface LinkAttachment {
  kind: 'link';
  url: string;
  title: string;
  description: string;
  siteName: string;
  thumb: string; // base64 крошечного JPEG (без data: префикса), '' если нет
}

export type Attachment = ImageAttachment | LinkAttachment;

// Сообщение — текст и/или вложения. Текст без вложений — обычное текстовое
// сообщение; вложения без текста — медиа; возможна и комбинация.
export interface MessageContent {
  text: string;
  attachments: Attachment[];
}

export function textContent(text: string): MessageContent {
  return { text, attachments: [] };
}

export function encodeContent(c: MessageContent): string {
  const body: Record<string, unknown> = { t: 'msg' };
  if (c.text) body.text = c.text;
  if (c.attachments.length) {
    body.atts = c.attachments.map((a) =>
      a.kind === 'image'
        ? {
            k: 'image',
            blob: a.blobId,
            mime: a.mime,
            w: a.width,
            h: a.height,
            size: a.size,
            thumb: a.thumb,
            ...(a.caption ? { cap: a.caption } : {}),
            ...(a.key ? { key: a.key } : {}),
          }
        : {
            k: 'link',
            url: a.url,
            title: a.title,
            ...(a.description ? { desc: a.description } : {}),
            ...(a.siteName ? { site: a.siteName } : {}),
            ...(a.thumb ? { thumb: a.thumb } : {}),
          },
    );
  }
  return encodeText(JSON.stringify(body));
}

function decodeAttachment(o: Record<string, unknown>): Attachment | null {
  if (o.k === 'link') {
    if (typeof o.url !== 'string' || typeof o.title !== 'string') return null;
    return {
      kind: 'link',
      url: o.url,
      title: o.title,
      description: typeof o.desc === 'string' ? o.desc : '',
      siteName: typeof o.site === 'string' ? o.site : '',
      thumb: typeof o.thumb === 'string' ? o.thumb : '',
    };
  }
  if (o.k !== 'image' && o.k !== undefined) return null;
  if (typeof o.thumb !== 'string' && typeof o.blob !== 'string') return null;
  return {
    kind: 'image',
    blobId: typeof o.blob === 'string' ? o.blob : '',
    mime: typeof o.mime === 'string' ? o.mime : 'image/jpeg',
    width: typeof o.w === 'number' ? o.w : 0,
    height: typeof o.h === 'number' ? o.h : 0,
    size: typeof o.size === 'number' ? o.size : 0,
    thumb: typeof o.thumb === 'string' ? o.thumb : '',
    caption: typeof o.cap === 'string' ? o.cap : '',
    ...(typeof o.key === 'string' ? { key: o.key } : {}),
  };
}

export function decodeContent(b64: string): MessageContent {
  const raw = decodeText(b64);
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    // Новый формат: текст + вложения.
    if (o && o.t === 'msg') {
      const atts = Array.isArray(o.atts)
        ? (o.atts as Record<string, unknown>[])
            .map(decodeAttachment)
            .filter((a): a is Attachment => a !== null)
        : [];
      return { text: typeof o.text === 'string' ? o.text : '', attachments: atts };
    }
    // Легаси: картинка inline целиком — данные становятся thumbnail, blobId пуст.
    if (o && o.t === 'image' && typeof o.data === 'string') {
      return {
        text: '',
        attachments: [
          {
            kind: 'image',
            blobId: '',
            mime: typeof o.mime === 'string' ? o.mime : 'image/jpeg',
            width: typeof o.w === 'number' ? o.w : 0,
            height: typeof o.h === 'number' ? o.h : 0,
            size: 0,
            thumb: o.data,
            caption: typeof o.cap === 'string' ? o.cap : '',
          },
        ],
      };
    }
    // Легаси: обычный текст.
    if (o && o.t === 'text' && typeof o.text === 'string') {
      return { text: o.text, attachments: [] };
    }
  } catch {
    /* не JSON — это легаси/обычный текст */
  }
  return { text: raw, attachments: [] };
}

// data-URL для inline-превью вложения (thumbnail).
export function thumbUrl(a: ImageAttachment): string {
  return `data:${a.mime};base64,${a.thumb}`;
}

// data-URL для картинки превью ссылки (всегда JPEG).
export function linkThumbUrl(a: LinkAttachment): string {
  return `data:image/jpeg;base64,${a.thumb}`;
}

// Краткое превью для списка чатов: для медиа — без раскодирования блоба. У превью
// ссылки текст (сам URL) есть в сообщении — показываем его как обычный текст.
export function previewText(c: MessageContent): string {
  const img = c.attachments.find((a): a is ImageAttachment => a.kind === 'image');
  if (img) {
    const cap = img.caption || c.text;
    return cap ? `📷 ${cap}` : '📷 Фото';
  }
  return c.text;
}
