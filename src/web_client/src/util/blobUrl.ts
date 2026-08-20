// Object-URL cache for full-size blobs. <img src> can't send an Authorization
// header, so the file is fetched (with the token) into a Blob and then wrapped
// in URL.createObjectURL. Cached by blobId so showing the same image again
// doesn't hit the network. blobId is a content hash, so the cache is always valid.
//
// v1: object URLs live until the end of the session (no revoke). Long sessions
// with thousands of images will need an LRU with revoke — noted as a follow-up (see plan).

import { fetchBlob } from '../api/rest';

const cache = new Map<string, Promise<string>>();

export function blobObjectUrl(blobId: string): Promise<string> {
  let p = cache.get(blobId);
  if (!p) {
    p = fetchBlob(blobId)
      .then((b) => URL.createObjectURL(b))
      .catch((err) => {
        cache.delete(blobId); // don't cache failure — allow retry
        throw err;
      });
    cache.set(blobId, p);
  }
  return p;
}
