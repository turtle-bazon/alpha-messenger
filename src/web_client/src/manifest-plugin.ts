import type { Plugin } from 'vite';
import { readdirSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Vite-плагин: после сборки генерирует manifest.json в dist/.
 * Манифест содержит версию (BUILD_HASH) и список всех файлов бандла.
 * Android-клиент скачивает манифест для определения необходимости обновления.
 */
export function clientManifest(): Plugin {
  return {
    name: 'client-manifest',
    closeBundle() {
      const outDir = join(process.cwd(), 'dist');
      const files: string[] = [];

      function scan(dir: string) {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            scan(full);
          } else {
            files.push(relative(outDir, full));
          }
        }
      }

      scan(outDir);

      const manifest = {
        version: process.env.BUILD_HASH || 'dev',
        files,
      };

      writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest));
    },
  };
}
