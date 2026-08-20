// Prepare an image for sending via blob: rotation + two render variants —
// full-size JPEG (goes to the blob store, fetched on demand) and a tiny
// thumbnail (stored inline in the message body for instant preview in the
// bubble). See status/plans/blob-client-images.md.

const FULL_MAX_DIM = 2560; // cap for the longer side of the full-size variant
const FULL_QUALITY = 0.85;
const THUMB_MAX_DIM = 320; // cap for the thumbnail's longer side
const THUMB_QUALITY = 0.5;

export interface PreparedImage {
  full: Blob; // full-size JPEG for blob upload
  thumb: string; // base64 of the tiny JPEG (without the data: prefix)
  mime: string;
  width: number; // dimensions of the full-size variant
  height: number;
}

// Draws the image onto a canvas with rotation (0/90/180/270) and scaling so
// the longer side doesn't exceed maxDim.
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

const LINK_THUMB_MAX_DIM = 320; // cap for the link preview image (#32)
const LINK_THUMB_QUALITY = 0.6;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

// Turns link preview image bytes (base64 + mime, as returned by the server)
// into a tiny inline-JPEG thumbnail. A data-URL doesn't "taint" the canvas
// (own origin), so toDataURL is available. On any failure — '' (the card
// renders without an image).
export async function imageBytesToThumb(
  dataBase64: string,
  mime: string,
): Promise<string> {
  try {
    const img = await loadImage(`data:${mime};base64,${dataBase64}`);
    const canvas = renderCanvas(img, 0, LINK_THUMB_MAX_DIM);
    const url = canvas.toDataURL('image/jpeg', LINK_THUMB_QUALITY);
    return url.slice(url.indexOf(',') + 1);
  } catch {
    return '';
  }
}

// Prepares the full-size blob and thumbnail from a rendered <img>, honoring rotation.
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

// Poster frame for video messages (#34): from a video blob — a tiny inline
// JPEG (base64 without prefix) + real dimensions. The video loads into an
// offscreen <video>, the frame is taken at ~0.1s. On any failure — thumb ''
// and zero dimensions (the bubble shows a placeholder).
export async function videoPosterFrame(
  blob: Blob,
): Promise<{ thumb: string; width: number; height: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const video = document.createElement('video');
    video.muted = true;
    video.src = url;
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('video load failed'));
      setTimeout(() => reject(new Error('video load timeout')), 5000);
    });
    video.currentTime = Math.min(0.1, video.duration || 0.1);
    await new Promise<void>((resolve, reject) => {
      video.onseeked = () => resolve();
      video.onerror = () => reject(new Error('video seek failed'));
      setTimeout(() => reject(new Error('video seek timeout')), 5000);
    });
    const scale = Math.min(1, 320 / Math.max(video.videoWidth, video.videoHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
    return {
      thumb: dataUrl.slice(dataUrl.indexOf(',') + 1),
      width: video.videoWidth,
      height: video.videoHeight,
    };
  } catch {
    return { thumb: '', width: 0, height: 0 };
  } finally {
    URL.revokeObjectURL(url);
  }
}
