import { FastifyInstance } from 'fastify';
import { pool } from '../db';

// Decode ciphertext (base64 JSON) into text for rendering.
function decodeCiphertext(b64: string): string {
  try {
    const json = JSON.parse(Buffer.from(b64, 'base64').toString('utf-8'));
    if (json.t === 'msg' && typeof json.text === 'string') return json.text;
    if (json.t === 'text' && typeof json.text === 'string') return json.text;
    return '';
  } catch {
    return '';
  }
}

// Escape HTML special characters.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderChannelHtml(opts: {
  title: string;
  description: string;
  username: string;
  posts: Array<{
    messageId: string;
    text: string;
    ts: string;
    viewCount: number;
    commentCount: number;
  }>;
}): string {
  const { title, description, username, posts } = opts;
  const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000';
  const channelUrl = `${siteUrl}/channel/${esc(username)}`;

  const postsHtml = posts.map((p) => {
    const commentLabel = p.commentCount > 0
      ? `💬 ${p.commentCount} комментари${p.commentCount % 10 === 1 && p.commentCount % 100 !== 11 ? 'й' : (p.commentCount % 10 >= 2 && p.commentCount % 10 <= 4 && (p.commentCount % 100 < 10 || p.commentCount % 100 >= 20) ? 'я' : 'ев')}`
      : '';
    return `
      <article class="post" id="post-${p.messageId}">
        <div class="post-text">${esc(p.text).replace(/\n/g, '<br>')}</div>
        <div class="post-meta">
          <time datetime="${p.ts}">${new Date(p.ts).toLocaleDateString('ru-RU')}</time>
          <span class="post-views">👁 ${p.viewCount}</span>
          ${commentLabel ? `<a href="${channelUrl}/${p.messageId}" class="post-comments">${commentLabel}</a>` : ''}
        </div>
      </article>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} — @${esc(username)}</title>
  <meta name="description" content="${esc(description || title)}">
  <link rel="alternate" type="application/rss+xml" title="${esc(title)}" href="${channelUrl}/feed">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #000; max-width: 680px; margin: 0 auto; padding: 20px; }
    .channel-header { text-align: center; padding: 24px 0; border-bottom: 1px solid #eee; margin-bottom: 24px; }
    .channel-title { font-size: 24px; font-weight: 700; }
    .channel-username { color: #888; font-size: 14px; margin-top: 4px; }
    .channel-desc { color: #555; margin-top: 8px; font-size: 15px; }
    .post { padding: 20px 0; border-bottom: 1px solid #f0f0f0; }
    .post-text { font-size: 16px; line-height: 1.5; white-space: pre-wrap; }
    .post-meta { margin-top: 10px; font-size: 13px; color: #888; display: flex; gap: 16px; align-items: center; }
    .post-views { color: #888; }
    .post-comments { color: #3396d4; text-decoration: none; }
    .post-comments:hover { text-decoration: underline; }
    .footer { text-align: center; padding: 32px 0; color: #aaa; font-size: 13px; }
  </style>
</head>
<body>
  <header class="channel-header">
    <h1 class="channel-title">${esc(title)}</h1>
    <div class="channel-username">@${esc(username)}</div>
    ${description ? `<div class="channel-desc">${esc(description)}</div>` : ''}
  </header>
  <main>
    ${postsHtml || '<p style="color:#888;text-align:center;padding:40px 0">No posts yet.</p>'}
  </main>
  <footer class="footer">
    <a href="${channelUrl}/feed" style="color:#3396d4;text-decoration:none">RSS</a>
  </footer>
</body>
</html>`;
}

function renderPostHtml(opts: {
  title: string;
  username: string;
  post: {
    messageId: string;
    text: string;
    ts: string;
    viewCount: number;
  };
  comments: Array<{
    messageId: string;
    senderUsername: string;
    text: string;
    ts: string;
  }>;
}): string {
  const { title, username, post, comments } = opts;
  const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000';
  const channelUrl = `${siteUrl}/channel/${esc(username)}`;

  const commentsHtml = comments.map((c) => `
    <div class="comment">
      <span class="comment-author">${esc(c.senderUsername)}</span>
      <span class="comment-text">${esc(c.text).replace(/\n/g, '<br>')}</span>
      <time class="comment-time" datetime="${c.ts}">${new Date(c.ts).toLocaleDateString('ru-RU')}</time>
    </div>`).join('\n');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(post.text.slice(0, 60))} — @${esc(username)}</title>
  <meta name="description" content="${esc(post.text.slice(0, 160))}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #000; max-width: 680px; margin: 0 auto; padding: 20px; }
    .back { color: #3396d4; text-decoration: none; font-size: 14px; display: inline-block; margin-bottom: 20px; }
    .post { padding-bottom: 20px; border-bottom: 1px solid #eee; }
    .post-text { font-size: 16px; line-height: 1.5; white-space: pre-wrap; }
    .post-meta { margin-top: 10px; font-size: 13px; color: #888; display: flex; gap: 16px; }
    .comments-header { margin: 24px 0 12px; font-size: 15px; font-weight: 600; color: #555; }
    .comment { padding: 10px 0; border-bottom: 1px solid #f5f5f5; }
    .comment-author { font-weight: 600; margin-right: 8px; }
    .comment-text { font-size: 14px; line-height: 1.4; }
    .comment-time { display: block; font-size: 12px; color: #aaa; margin-top: 4px; }
    .footer { text-align: center; padding: 32px 0; color: #aaa; font-size: 13px; }
  </style>
</head>
<body>
  <a class="back" href="${channelUrl}">← ${esc(title)}</a>
  <article class="post">
    <div class="post-text">${esc(post.text).replace(/\n/g, '<br>')}</div>
    <div class="post-meta">
      <time datetime="${post.ts}">${new Date(post.ts).toLocaleDateString('ru-RU')}</time>
      <span>👁 ${post.viewCount}</span>
    </div>
  </article>
  ${comments.length > 0 ? `
    <div class="comments-header">Комментарии (${comments.length})</div>
    ${commentsHtml}
  ` : '<p style="color:#888;margin-top:24px">Нет комментариев</p>'}
  <footer class="footer">
    <a href="${channelUrl}" style="color:#3396d4;text-decoration:none">← К каналу</a>
  </footer>
</body>
</html>`;
}

function renderRssFeed(opts: {
  title: string;
  description: string;
  username: string;
  siteUrl: string;
  posts: Array<{
    messageId: string;
    text: string;
    ts: string;
  }>;
}): string {
  const { title, description, username, siteUrl, posts } = opts;
  const channelUrl = `${siteUrl}/channel/${username}`;

  const items = posts.map((p) => `
    <item>
      <title>${esc(p.text.slice(0, 100) || 'Untitled')}</title>
      <link>${channelUrl}/${p.messageId}</link>
      <guid isPermaLink="false">${p.messageId}</guid>
      <pubDate>${new Date(p.ts).toUTCString()}</pubDate>
      <description><![CDATA[${esc(p.text).replace(/\n/g, '<br>')}]]></description>
    </item>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${esc(title)}</title>
    <link>${channelUrl}</link>
    <description>${esc(description || title)}</description>
    <language>ru</language>
    ${items}
  </channel>
</rss>`;
}

export async function channelWebRoutes(app: FastifyInstance): Promise<void> {
  // Channel page: /channel/:id/ — accepts both @handle and numeric chatId.
  app.get('/channel/:id/', async (req, reply) => {
    const { id } = req.params as { id: string };

    const chat = /^\d+$/.test(id)
      ? await pool.query(
          `SELECT chat_id, title, description, username FROM chats WHERE chat_id = $1`,
          [id],
        )
      : await pool.query(
          `SELECT chat_id, title, description, username FROM chats
           WHERE username = $1 AND username IS NOT NULL`,
          [id],
        );
    if (chat.rowCount === 0) return reply.code(404).send('Channel not found');
    const { chat_id: chatId, title, description, username } = chat.rows[0];

    // Private channels: no SSR page, the chatId link works only in the client.
    if (!username) return reply.code(404).send('Private channel');

    const label = title ?? username;
    const msgs = await pool.query(
      `SELECT message_id, ciphertext, created_at, view_count
       FROM messages
       WHERE chat_id = $1 AND deleted = false AND reply_to_message_id IS NULL
       ORDER BY message_id DESC LIMIT 100`,
      [chatId],
    );

    const posts = [];
    for (const r of msgs.rows) {
      const comments = await pool.query(
        'SELECT count(*)::int AS c FROM messages WHERE reply_to_message_id = $1 AND deleted = false',
        [r.message_id],
      );
      posts.push({
        messageId: String(r.message_id),
        text: decodeCiphertext((r.ciphertext as Buffer).toString('base64')),
        ts: r.created_at.toISOString(),
        viewCount: r.view_count as number,
        commentCount: comments.rows[0].c,
      });
    }

    const html = renderChannelHtml({ title: label, description: description ?? '', username, posts });
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(html);
  });

  // Single post with comments: /channel/:id/:postId
  app.get('/channel/:id/:postId', async (req, reply) => {
    const { id, postId } = req.params as { id: string; postId: string };
    if (!/^\d+$/.test(postId)) return reply.code(404).send('Not found');

    const chat = /^\d+$/.test(id)
      ? await pool.query(
          `SELECT chat_id, title, username FROM chats WHERE chat_id = $1`,
          [id],
        )
      : await pool.query(
          `SELECT chat_id, title, username FROM chats
           WHERE username = $1 AND username IS NOT NULL`,
          [id],
        );
    if (chat.rowCount === 0) return reply.code(404).send('Channel not found');
    const { chat_id: chatId, title, username } = chat.rows[0];
    if (!username) return reply.code(404).send('Private channel');
    const label = title ?? username;

    const postRes = await pool.query(
      `SELECT message_id, ciphertext, created_at, view_count
       FROM messages WHERE message_id = $1 AND chat_id = $2 AND deleted = false`,
      [postId, chatId],
    );
    if (postRes.rowCount === 0) return reply.code(404).send('Post not found');
    const postRow = postRes.rows[0];

    await pool.query('UPDATE messages SET view_count = view_count + 1 WHERE message_id = $1', [postRow.message_id]);

    const commentsRes = await pool.query(
      `SELECT m.message_id, m.ciphertext, m.created_at, a.username
       FROM messages m JOIN accounts a ON a.user_id = m.sender_id
       WHERE m.reply_to_message_id = $1 AND m.deleted = false
       ORDER BY m.message_id ASC`,
      [postRow.message_id],
    );

    const post = {
      messageId: String(postRow.message_id),
      text: decodeCiphertext((postRow.ciphertext as Buffer).toString('base64')),
      ts: postRow.created_at.toISOString(),
      viewCount: (postRow.view_count as number) + 1,
    };
    const comments = commentsRes.rows.map((r) => ({
      messageId: String(r.message_id),
      senderUsername: r.username as string,
      text: decodeCiphertext((r.ciphertext as Buffer).toString('base64')),
      ts: r.created_at.toISOString(),
    }));

    const html = renderPostHtml({ title: label, username: label, post, comments });
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(html);
  });

  // RSS feed: /channel/:chatId/rss
  app.get('/channel/:chatId/rss', async (req, reply) => {
    const { chatId } = req.params as { chatId: string };
    if (!/^\d+$/.test(chatId)) return reply.code(404).send('Not found');

    const chat = await pool.query(
      `SELECT chat_id, title, description, username FROM chats WHERE chat_id = $1`,
      [chatId],
    );
    if (chat.rowCount === 0) return reply.code(404).send('Channel not found');
    const { title, description, username } = chat.rows[0];
    const label = title ?? username ?? `Channel #${chatId}`;

    const msgs = await pool.query(
      `SELECT message_id, ciphertext, created_at
       FROM messages
       WHERE chat_id = $1 AND deleted = false AND reply_to_message_id IS NULL
       ORDER BY message_id DESC LIMIT 50`,
      [chatId],
    );

    const siteUrl = process.env.SITE_URL ?? 'http://localhost:3000';
    const posts = msgs.rows.map((r) => ({
      messageId: String(r.message_id),
      text: decodeCiphertext((r.ciphertext as Buffer).toString('base64')),
      ts: r.created_at.toISOString(),
    }));

    const xml = renderRssFeed({ title: label, description: description ?? '', username: label, siteUrl, posts });
    reply.header('content-type', 'application/rss+xml; charset=utf-8');
    return reply.send(xml);
  });
}
