import { Readable } from 'node:stream';

// Хранилище непрозрачных блобов, адресуемых по content-hash (sha256 hex).
// Сервер не интерпретирует содержимое: только кладёт по ключу и отдаёт по ключу.
export interface BlobStore {
  // Подготовка драйвера: каталог для fs, бакет для s3. Идемпотентно.
  init(): Promise<void>;
  // Есть ли блоб с таким id (для дедупликации — не перезаписываем существующий).
  has(id: string): Promise<boolean>;
  // Финализирует уже подготовленный временный файл под ключ id. Реализация
  // вправе забрать (move) srcPath; после вызова он может не существовать.
  putFile(id: string, srcPath: string, size: number): Promise<void>;
  // Поток содержимого либо null, если блоба нет.
  get(id: string): Promise<Readable | null>;
}
