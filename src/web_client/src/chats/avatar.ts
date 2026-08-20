// Chat avatar: colored circle with an initial (like Telegram when no photo).

const PALETTE = [
  '#e17076',
  '#7bc862',
  '#65aadd',
  '#a695e7',
  '#ee7aae',
  '#6ec9cb',
  '#f0a44a',
];

export function colorFor(s: string): string {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initialFor(s: string): string {
  const t = s.trim();
  return t ? t[0].toUpperCase() : '#';
}
