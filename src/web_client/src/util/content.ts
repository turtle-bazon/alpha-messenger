// Конверт содержимого сообщения. Тело (шифр-)сообщения — это сериализованный
// объект с дискриминатором t: 'text' | 'image'. Текст и картинка — варианты
// одного формата. Картинка для v1 лежит прямо в теле (малая медиа, см.
// architecture.md): inline под жёстким потолком размера, без отдельного
// медиа-хранилища. Крупные фото/видео — будущая версия с content-addressed
// блобами.
//
// Поверх encodeText/decodeText: в v1 шифрования нет (base64 от UTF-8 JSON),
// реальное шифрование позже встанет тем же интерфейсом без смены вызовов.

import { decodeText, encodeText } from './text';

export interface TextContent {
  kind: 'text';
  text: string;
}

export interface ImageContent {
  kind: 'image';
  mime: string;
  dataB64: string; // base64 байтов изображения
  width: number;
  height: number;
  caption: string;
}

export type MessageContent = TextContent | ImageContent;

export function encodeContent(c: MessageContent): string {
  const body =
    c.kind === 'image'
      ? {
          t: 'image',
          mime: c.mime,
          data: c.dataB64,
          w: c.width,
          h: c.height,
          cap: c.caption,
        }
      : { t: 'text', text: c.text };
  return encodeText(JSON.stringify(body));
}

export function decodeContent(b64: string): MessageContent {
  const raw = decodeText(b64);
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o && o.t === 'image' && typeof o.data === 'string') {
      return {
        kind: 'image',
        mime: typeof o.mime === 'string' ? o.mime : 'image/jpeg',
        dataB64: o.data,
        width: typeof o.w === 'number' ? o.w : 0,
        height: typeof o.h === 'number' ? o.h : 0,
        caption: typeof o.cap === 'string' ? o.cap : '',
      };
    }
    if (o && o.t === 'text' && typeof o.text === 'string') {
      return { kind: 'text', text: o.text };
    }
  } catch {
    /* не JSON — это легаси/обычный текст */
  }
  return { kind: 'text', text: raw };
}

export function imageDataUrl(c: ImageContent): string {
  return `data:${c.mime};base64,${c.dataB64}`;
}

// Краткое превью для списка чатов: для картинки — без раскодирования блоба.
export function previewText(c: MessageContent): string {
  if (c.kind === 'image') return c.caption ? `📷 ${c.caption}` : '📷 Фото';
  return c.text;
}
