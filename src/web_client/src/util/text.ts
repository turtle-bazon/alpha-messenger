// Преобразование текста сообщения в/из base64. Тело сообщения для сервера —
// непрозрачный ciphertext (в v1 шифрования нет, это base64 от UTF-8; см.
// encryption.md). Здесь же позже встанет реальное шифрование без смены вызовов.

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
