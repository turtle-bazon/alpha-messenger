// Message text to/from base64 conversion. For the server the message body is
// an opaque ciphertext (v1 has no encryption — it's base64 of UTF-8; see
// encryption.md). Real encryption will slot in here later without changing callers.

export function decodeText(b64: string): string {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

export function encodeText(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
