import { Provider, interactionPolicy } from 'oidc-provider';
import { FastifyInstance } from 'fastify';
import { pool } from './db';
import { verifyPassword, newToken } from './auth';

const DEFAULT_CLIENT_ID = process.env.OIDC_CLIENT_ID ?? 'alpha-messenger';
const DEFAULT_CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET ?? 'alpha-messenger-secret';
const DEFAULT_REDIRECT_URI =
  process.env.OIDC_REDIRECT_URI ?? 'http://localhost:8080/callback';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function createOidcProvider(issuer: string): any {
  const policy = interactionPolicy.base();
  policy.remove('consent');
  const provider = new Provider(issuer, {
    clients: [
      {
        client_id: DEFAULT_CLIENT_ID,
        client_secret: DEFAULT_CLIENT_SECRET,
        redirect_uris: [DEFAULT_REDIRECT_URI],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'openid profile email',
        token_endpoint_auth_method: 'client_secret_basic',
      },
    ],
    findAccount: async (_ctx: any, id: string) => {
      const { rows } = await pool.query(
        'SELECT user_id, username FROM accounts WHERE user_id = $1',
        [id],
      );
      if (rows.length === 0) return undefined;
      const user = rows[0];
      return {
        accountId: user.user_id,
        async claims() {
          return {
            sub: user.user_id,
            preferred_username: user.username,
            name: user.username,
          };
        },
      };
    },
    interactions: {
      policy,
      url: async (_ctx: any, interaction: any) =>
        `/oidc/interaction/${interaction.uid}`,
    },
    cookies: {
      keys: [
        process.env.OIDC_COOKIE_KEY ?? 'alpha-oidc-dev-cookie-key-change-me',
      ],
    },
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    claims: {
      openid: ['sub'],
      profile: ['name', 'preferred_username'],
    },
    features: {
      devInteractions: { enabled: false },
      registration: { enabled: true },
    },
  });

  return provider;
}

async function getSessionUserId(req: any): Promise<string | null> {
  const cookie = req.headers?.cookie ?? '';
  const m = cookie.match(/(?:^|;\s*)alpha_oidc_session=([^;]+)/);
  if (!m) return null;
  const token = decodeURIComponent(m[1]);
  const { rows } = await pool.query(
    'SELECT user_id FROM sessions WHERE token = $1',
    [token],
  );
  return rows.length ? rows[0].user_id : null;
}

async function authenticateUser(
  username: string,
  password: string,
): Promise<{ user_id: string } | null> {
  const { rows } = await pool.query(
    'SELECT user_id, password_hash FROM accounts WHERE username = $1',
    [username],
  );
  if (rows.length === 0) return null;
  const ok = await verifyPassword(rows[0].password_hash, password);
  return ok ? { user_id: rows[0].user_id } : null;
}

function renderLogin(uid: string, error?: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Alpha Messenger — Sign in</title></head>
<body style="font-family:sans-serif;max-width:420px;margin:40px auto;padding:0 16px">
  <h1>Sign in to Alpha Messenger</h1>
  ${error ? `<p style="color:#c00">${escapeHtml(error)}</p>` : ''}
  <form method="POST" action="/oidc/login">
    <input type="hidden" name="uid" value="${escapeHtml(uid)}" />
    <p><label>Username<br><input name="username" required autofocus></label></p>
    <p><label>Password<br><input type="password" name="password" required></label></p>
    <p><button type="submit">Sign in</button></p>
  </form>
</body>
</html>`;
}

export function registerOidc(
  app: FastifyInstance,
  provider: any,
): void {
  // Pass-through parsers: keep the raw body available on req.raw.body so that
  // oidc-provider (which reads the stream itself) can still access it.
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (req, body, done) => {
      const buf = Buffer.from(body as any ?? '', 'utf8');
      (req.raw as any).body = buf;
      if ((req.url ?? '').startsWith('/oidc')) {
        done(null, buf);
        return;
      }
      const params = new URLSearchParams(buf.toString('utf8'));
      const parsed: Record<string, string> = {};
      for (const [k, v] of params) parsed[k] = v;
      done(null, parsed);
    },
  );
  app.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      const buf = Buffer.from(body as any ?? '', 'utf8');
      (req.raw as any).body = buf;
      if ((req.url ?? '').startsWith('/oidc')) {
        done(null, buf);
        return;
      }
      if (buf.length === 0) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(buf.toString('utf8')));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );
  // Login form submission.
  app.post('/oidc/login', async (req, reply) => {
    const bodyBuf = Buffer.isBuffer(req.body)
      ? (req.body as Buffer)
      : Buffer.isBuffer((req.raw as any).body)
        ? ((req.raw as any).body as Buffer)
        : Buffer.alloc(0);
    const params = new URLSearchParams(bodyBuf.toString());
    const uid = params.get('uid') ?? '';
    const username = params.get('username') ?? '';
    const password = params.get('password') ?? '';
    const user = await authenticateUser(username, password);
    if (!user) {
      reply.type('text/html').send(renderLogin(uid, 'Invalid username or password'));
      return;
    }
    const deviceId = '00000000-0000-0000-0000-000000000099';
    await pool.query(
      'INSERT INTO devices (device_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [deviceId, user.user_id],
    );
    const token = newToken();
    await pool.query(
      'INSERT INTO sessions (token, user_id, device_id) VALUES ($1, $2, $3)',
      [token, user.user_id, deviceId],
    );
    reply.header(
      'Set-Cookie',
      `alpha_oidc_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax`,
    );
    reply.redirect(`/oidc/interaction/${encodeURIComponent(uid)}`);
  });

  // Interaction: auto-complete if a session exists, otherwise show login.
  app.get('/oidc/interaction/:uid', async (req, reply) => {
    const uid = (req.params as any).uid;
    const details = await provider.interactionDetails(req.raw, reply.raw);
    const userId = await getSessionUserId(req);
    if (userId) {
      // Grant the requested scopes (consent is skipped).
      const grant = new provider.Grant({
        accountId: userId,
        clientId: details.params.client_id,
      });
      if (details.params.scope) {
        grant.addOIDCScope(details.params.scope);
      }
      grant.addOIDCClaims(['name', 'preferred_username']);
      const grantId = await grant.save();
      const returnTo = await provider.interactionResult(req.raw, reply.raw, {
        login: { accountId: userId },
        consent: { grantId },
      }, { mergeWithLastSubmission: false });
      reply.redirect(returnTo);
      return;
    }
    reply.type('text/html').send(renderLogin(uid));
  });

  // Everything else under /oidc is handled by oidc-provider.
  app.all('/oidc/*', async (req, reply) => {
    // oidc-provider is a Koa app that expects to be mounted at the issuer's
    // mount path: the parent must strip that prefix before delegating.
    const originalUrl = req.raw.url;
    (req.raw as any).originalUrl = originalUrl;
    req.raw.url = (originalUrl || '').replace(/^\/oidc/, '') || '/';
    reply.hijack();
    const handler = provider.callback();
    await new Promise<void>((resolve) => {
      reply.raw.on('finish', () => resolve());
      handler(req.raw, reply.raw);
    });
    req.raw.url = originalUrl;
  });
}
