// Message content envelope. The (cipher-)message body is a serialized object:
// text + attachments array. Each attachment references a blob by content-hash
// (blobId) and carries a thin thumbnail for instant preview in the bubble; the
// full file is fetched from the blob on demand (see doc/api.md — "Blobs" and
// status/plans/blob-client-images.md).
//
// On top of encodeText/decodeText: v1 has no encryption (base64 of UTF-8 JSON);
// real encryption will later plug into the same interface without changing call
// sites. The attachment key field is reserved for a future blob decryption key.
//
// Legacy: early messages were encoded as t:'text' or t:'image' (image inline
// entirely in the body). decodeContent still reads them (read-only); legacy
// image inline data is used as thumbnail, blobId empty.

import { decodeText, encodeText } from './text';

export interface ImageAttachment {
  kind: 'image';
  blobId: string; // sha256 of the blob; '' on optimistic messages before upload
  mime: string;
  width: number;
  height: number;
  size: number; // bytes of the full blob
  thumb: string; // base64 tiny JPEG for inline preview (without data: prefix)
  caption: string;
  key?: string; // reserved: blob decryption key (future E2EE)
}

// Link preview (#32). OpenGraph metadata lives entirely in the message body
// (ciphertext): the server expanded the link once for the sender, the receiver
// just renders the card — no refetch and no IP leak to the third-party site.
// thumb is a small inline JPEG of the preview image (or '' if none); no blob here.
export interface LinkAttachment {
  kind: 'link';
  url: string;
  title: string;
  description: string;
  siteName: string;
  thumb: string; // base64 tiny JPEG (without data: prefix), '' if none
}

export interface StickerAttachment {
  kind: 'sticker';
  blobId: string;
}

// Voice message (#34). wave — loudness peaks 0..1 sampled during recording
// (AnalyserNode); stored in the message body so the waveform renders without
// decoding audio. duration in seconds (fractional).
export interface AudioAttachment {
  kind: 'audio';
  blobId: string;
  mime: string;
  duration: number;
  wave: number[];
  size: number;
}

// Video message (#34). thumb — tiny inline JPEG poster frame.
export interface VideoAttachment {
  kind: 'video';
  blobId: string;
  mime: string;
  duration: number;
  width: number;
  height: number;
  size: number;
  thumb: string; // base64 JPEG without data: prefix
}

export type Attachment =
  | ImageAttachment
  | LinkAttachment
  | StickerAttachment
  | AudioAttachment
  | VideoAttachment;

// Message — text and/or attachments. Text without attachments is a plain text
// message; attachments without text are media; a combination is possible too.
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
    body.atts = c.attachments.map((a) => {
      if (a.kind === 'image') {
        return {
          k: 'image',
          blob: a.blobId,
          mime: a.mime,
          w: a.width,
          h: a.height,
          size: a.size,
          thumb: a.thumb,
          ...(a.caption ? { cap: a.caption } : {}),
          ...(a.key ? { key: a.key } : {}),
        };
      }
      if (a.kind === 'sticker') {
        return { k: 'sticker', blob: a.blobId };
      }
      if (a.kind === 'audio') {
        return {
          k: 'audio',
          blob: a.blobId,
          mime: a.mime,
          dur: a.duration,
          wave: a.wave,
          size: a.size,
        };
      }
      if (a.kind === 'video') {
        return {
          k: 'video',
          blob: a.blobId,
          mime: a.mime,
          dur: a.duration,
          w: a.width,
          h: a.height,
          size: a.size,
          thumb: a.thumb,
        };
      }
      return {
        k: 'link',
        url: a.url,
        title: a.title,
        ...(a.description ? { desc: a.description } : {}),
        ...(a.siteName ? { site: a.siteName } : {}),
        ...(a.thumb ? { thumb: a.thumb } : {}),
      };
    });
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
  if (o.k === 'sticker') {
    if (typeof o.blob !== 'string') return null;
    return { kind: 'sticker', blobId: o.blob };
  }
  if (o.k === 'audio') {
    if (typeof o.blob !== 'string') return null;
    return {
      kind: 'audio',
      blobId: o.blob,
      mime: typeof o.mime === 'string' ? o.mime : 'audio/webm',
      duration: typeof o.dur === 'number' ? o.dur : 0,
      wave: Array.isArray(o.wave)
        ? (o.wave as unknown[]).filter((n): n is number => typeof n === 'number')
        : [],
      size: typeof o.size === 'number' ? o.size : 0,
    };
  }
  if (o.k === 'video') {
    if (typeof o.blob !== 'string') return null;
    return {
      kind: 'video',
      blobId: o.blob,
      mime: typeof o.mime === 'string' ? o.mime : 'video/webm',
      duration: typeof o.dur === 'number' ? o.dur : 0,
      width: typeof o.w === 'number' ? o.w : 0,
      height: typeof o.h === 'number' ? o.h : 0,
      size: typeof o.size === 'number' ? o.size : 0,
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
    // New format: text + attachments.
    if (o && o.t === 'msg') {
      const atts = Array.isArray(o.atts)
        ? (o.atts as Record<string, unknown>[])
            .map(decodeAttachment)
            .filter((a): a is Attachment => a !== null)
        : [];
      return { text: typeof o.text === 'string' ? o.text : '', attachments: atts };
    }
    // Legacy: image inline entirely — data becomes the thumbnail, blobId empty.
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
    // Legacy: plain text.
    if (o && o.t === 'text' && typeof o.text === 'string') {
      return { text: o.text, attachments: [] };
    }
  } catch {
    /* not JSON — legacy/plain text */
  }
  return { text: raw, attachments: [] };
}

// data-URL for the attachment inline preview (thumbnail).
export function thumbUrl(a: ImageAttachment): string {
  return `data:${a.mime};base64,${a.thumb}`;
}

// data-URL for the link preview image (always JPEG).
export function linkThumbUrl(a: LinkAttachment): string {
  return `data:image/jpeg;base64,${a.thumb}`;
}

// Short preview for the chat list: media without decoding the blob. For link
// previews the text (the URL itself) is in the message — shown as plain text.
export function previewText(c: MessageContent): string {
  const sticker = c.attachments.find((a): a is StickerAttachment => a.kind === 'sticker');
  if (sticker) return '🎯 Стикер';
  const audio = c.attachments.find((a): a is AudioAttachment => a.kind === 'audio');
  if (audio) return '🎤 Голосовое сообщение';
  const video = c.attachments.find((a): a is VideoAttachment => a.kind === 'video');
  if (video) return '🎥 Видео';
  const img = c.attachments.find((a): a is ImageAttachment => a.kind === 'image');
  if (img) {
    const cap = img.caption || c.text;
    return cap ? `📷 ${cap}` : '📷 Фото';
  }
  return c.text;
}
