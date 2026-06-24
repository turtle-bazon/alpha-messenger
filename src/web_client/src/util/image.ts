// Подготовка изображения для inline-отправки: поворот, уменьшение и кодирование
// в JPEG так, чтобы итоговый ciphertext не превышал потолок малой медиа.
// Всё, что не влезает, ужимается по качеству и размеру (см. architecture.md —
// inline только для мелочи, крупное уйдёт в отдельное хранилище в будущем).

import { encodeContent, type ImageContent } from './content';

const MAX_DIM = 1280; // стартовый предел по большей стороне
const MAX_CIPHERTEXT = 128 * 1024; // потолок итогового тела (символов base64)

// Рисует изображение в canvas с поворотом (0/90/180/270) и масштабом так,
// чтобы большая сторона не превышала maxDim.
function renderCanvas(
  img: HTMLImageElement,
  rotation: number,
  maxDim: number,
): HTMLCanvasElement {
  const rot = ((rotation % 360) + 360) % 360;
  const swap = rot === 90 || rot === 270;
  const scale = Math.min(
    1,
    maxDim / Math.max(img.naturalWidth, img.naturalHeight),
  );
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));

  const canvas = document.createElement('canvas');
  canvas.width = swap ? h : w;
  canvas.height = swap ? w : h;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((rot * Math.PI) / 180);
    ctx.drawImage(img, -w / 2, -h / 2, w, h);
  }
  return canvas;
}

function encodeJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
  caption: string,
): ImageContent {
  const url = canvas.toDataURL('image/jpeg', quality);
  const dataB64 = url.slice(url.indexOf(',') + 1);
  return {
    kind: 'image',
    mime: 'image/jpeg',
    dataB64,
    width: canvas.width,
    height: canvas.height,
    caption,
  };
}

// Готовит ImageContent под потолок: сперва снижаем качество, затем размер.
export function produceImageContent(
  img: HTMLImageElement,
  rotation: number,
  caption: string,
): ImageContent {
  let maxDim = MAX_DIM;
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = renderCanvas(img, rotation, maxDim);
    let last: ImageContent | null = null;
    for (const q of [0.72, 0.55, 0.4]) {
      last = encodeJpeg(canvas, q, caption);
      if (encodeContent(last).length <= MAX_CIPHERTEXT) return last;
    }
    maxDim = Math.round(maxDim * 0.75);
    if (maxDim < 64 && last) return last; // дальше ужимать некуда
  }
  // Фолбэк: максимально ужатый вариант.
  return encodeJpeg(renderCanvas(img, rotation, 64), 0.4, caption);
}
