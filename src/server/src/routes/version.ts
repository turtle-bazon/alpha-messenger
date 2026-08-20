import { FastifyInstance } from 'fastify';

// version.json serves the git hash of the current build. The client checks it
// every 5 minutes and reloads on mismatch (auto-update without Ctrl+Shift+R).
// The hash is passed at Docker build time via the GIT_HASH build arg.

const GIT_HASH = process.env.GIT_HASH || 'dev';

export async function versionRoutes(app: FastifyInstance): Promise<void> {
  app.get('/version.json', async () => ({
    version: GIT_HASH,
  }));
}
