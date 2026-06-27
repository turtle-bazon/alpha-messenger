// Подготовка изображения к отправке через блоб: поворот + два варианта рендера —
// полноразмерный JPEG (уходит в блоб, тянется по требованию) и крошечный
// thumbnail (лежит inline в теле сообщения для мгновенного превью в пузыре).
// См. status/plans/blob-client-images.md.

const FULL_MAX_DIM = 2560; // потолок большей стороны полноразмерного варианта
const FULL_QUALITY = 0.85;
const THUMB_MAX_DIM = 320; // потолок большей стороны thumbnail
const THUMB_QUALITY = 0.5;

export interface PreparedImage {
  full: Blob; // полноразмерный JPEG для загрузки в блоб
  thumb: string; // base64 крошечного JPEG (без data: префикса)
  mime: string;
  width: number; // размеры полноразмерного варианта
  height: number;
}

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

function toJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      quality,
    );
  });
}

// Готовит полноразмерный блоб и thumbnail из отрисованного <img> с учётом поворота.
export async function prepareImage(
  img: HTMLImageElement,
  rotation: number,
): Promise<PreparedImage> {
  const fullCanvas = renderCanvas(img, rotation, FULL_MAX_DIM);
  const full = await toJpegBlob(fullCanvas, FULL_QUALITY);

  const thumbCanvas = renderCanvas(img, rotation, THUMB_MAX_DIM);
  const url = thumbCanvas.toDataURL('image/jpeg', THUMB_QUALITY);
  const thumb = url.slice(url.indexOf(',') + 1);

  return {
    full,
    thumb,
    mime: 'image/jpeg',
    width: fullCanvas.width,
    height: fullCanvas.height,
  };
}
