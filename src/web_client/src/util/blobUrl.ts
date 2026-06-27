// Кеш object-URL для полноразмерных блобов. <img src> не умеет слать заголовок
// Authorization, поэтому файл тянется через fetch (с токеном) в Blob, а затем
// оборачивается в URL.createObjectURL. Кешируем по blobId, чтобы повторный показ
// одной картинки не дёргал сеть. blobId — content-hash, так что кеш всегда валиден.
//
// v1: object-URL живут до конца сессии (без revoke). Для долгих сессий с тысячами
// картинок понадобится LRU с revoke — отмечено как follow-up (см. план).

import { fetchBlob } from '../api/rest';

const cache = new Map<string, Promise<string>>();

export function blobObjectUrl(blobId: string): Promise<string> {
  let p = cache.get(blobId);
  if (!p) {
    p = fetchBlob(blobId)
      .then((b) => URL.createObjectURL(b))
      .catch((err) => {
        cache.delete(blobId); // не кешируем неудачу — дать повтор
        throw err;
      });
    cache.set(blobId, p);
  }
  return p;
}
