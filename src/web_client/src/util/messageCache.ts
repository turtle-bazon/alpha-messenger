// IndexedDB message cache (#70).
// Stores wire Message objects by chatId for instant display
// when reopening a chat. Limit: MAX_PER_CHAT messages per chat.

import type { Message } from '../api/types';

const DB_NAME = 'alpha_messenger';
const DB_VERSION = 1;
const STORE = 'messages';
const MAX_PER_CHAT = 200;

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'messageId' });
          store.createIndex('chatId', 'chatId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

/** Get a chat's messages from the cache (sorted by messageId asc). */
export async function getChatMessages(chatId: string): Promise<Message[]> {
  const db = await openDB();
  return new Promise<Message[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('chatId');
    const req = idx.getAll(IDBKeyRange.only(chatId));
    req.onsuccess = () => {
      const msgs = (req.result as (Message & { chatId: string })[])
        .sort((a, b) => Number(a.messageId) - Number(b.messageId));
      resolve(msgs);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Save/update messages in the cache (upsert by messageId). */
export async function putMessages(chatId: string, messages: Message[]): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const m of messages) {
      store.put({ ...m, chatId });
    }
    tx.oncomplete = () => {
      trimChat(db, chatId).then(resolve, reject);
    };
    tx.onerror = () => reject(tx.error);
  });
}

/** Update a single message in the cache (call on edit/delete/reaction). */
export async function patchMessage(
  chatId: string,
  messageId: string,
  patch: Partial<Message>,
): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(messageId);
    req.onsuccess = () => {
      const existing = req.result as (Message & { chatId: string }) | undefined;
      if (existing) {
        store.put({ ...existing, ...patch, chatId });
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Remove a single message from the cache. */
export async function removeMessage(messageId: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(messageId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Clear one chat's cache. */
export async function clearChat(chatId: string): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const idx = tx.objectStore(STORE).index('chatId');
    const req = idx.openCursor(IDBKeyRange.only(chatId));
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Clear the entire cache (on logout). */
export async function clearAll(): Promise<void> {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Keep at most MAX_PER_CHAT messages in a chat (drop the oldest). */
async function trimChat(db: IDBDatabase, chatId: string): Promise<void> {
  const msgs = await new Promise<(Message & { chatId: string })[]>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const idx = tx.objectStore(STORE).index('chatId');
    const req = idx.getAll(IDBKeyRange.only(chatId));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  if (msgs.length <= MAX_PER_CHAT) return;
  const sorted = msgs.sort((a, b) => Number(a.messageId) - Number(b.messageId));
  const toDelete = sorted.slice(0, sorted.length - MAX_PER_CHAT);
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const m of toDelete) {
    store.delete(m.messageId);
  }
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
