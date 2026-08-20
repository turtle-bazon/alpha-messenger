import type { Plugin } from 'vite';
import { readdirSync, writeFileSync } from 'fs';
import { join, relative } from 'path';

/**
 * Vite plugin: generates manifest.json in dist/ after the build.
 * The manifest contains the version (BUILD_HASH) and the list of all bundle files.
 * The Android client fetches the manifest to decide whether an update is needed.
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
