import { createReadStream } from 'node:fs';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { config } from '../config';
import { BlobStore } from './types';

// Content-addressed раскладка: <root>/ab/cd/<hash>. Шардинг по первым байтам
// хэша держит число файлов в каталоге умеренным даже при миллионах блобов.
export class FsBlobStore implements BlobStore {
  private root = config.fsBlobDir;

  private pathFor(id: string): string {
    return join(this.root, id.slice(0, 2), id.slice(2, 4), id);
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(config.blobTmpDir, { recursive: true });
  }

  async has(id: string): Promise<boolean> {
    try {
      await stat(this.pathFor(id));
      return true;
    } catch {
      return false;
    }
  }

  async putFile(id: string, srcPath: string): Promise<void> {
    const dest = this.pathFor(id);
    await mkdir(dirname(dest), { recursive: true });
    try {
      // tmp и хранилище под одним корнем → переименование атомарно и дёшево.
      await rename(srcPath, dest);
    } catch {
      // Разные ФС (EXDEV) — копируем; гонка (файл уже появился) — не ошибка.
      if (await this.has(id)) return;
      await copyFile(srcPath, dest);
      await unlink(srcPath).catch(() => undefined);
    }
  }

  async get(id: string): Promise<Readable | null> {
    if (!(await this.has(id))) return null;
    return createReadStream(this.pathFor(id));
  }
}
