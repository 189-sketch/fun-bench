import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

export function createStore(directory = process.env.DATA_DIR || 'data') {
  const dir = resolve(directory);
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, 'encryption.key');
  if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
  const key = readFileSync(keyPath);
  const db = new DatabaseSync(join(dir, 'funbench.sqlite'));
  db.exec(
    'PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, owner TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));',
  );
  const put = db.prepare(
    'INSERT INTO records(kind,id,owner,data) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',
  );
  return {
    get(kind, id) {
      const row = db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id);
      return row ? JSON.parse(row.data) : null;
    },
    all(kind, owner) {
      const rows =
        owner === undefined
          ? db.prepare('SELECT data FROM records WHERE kind=?').all(kind)
          : db.prepare('SELECT data FROM records WHERE kind=? AND owner=?').all(kind, owner);
      return rows.map((r) => JSON.parse(r.data));
    },
    put(kind, item, owner) {
      put.run(kind, item.id, owner, JSON.stringify(item));
      return item;
    },
    remove(kind, id, owner) {
      return db
        .prepare('DELETE FROM records WHERE kind=? AND id=? AND owner=?')
        .run(kind, id, owner).changes;
    },
    encrypt(value) {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return [iv, cipher.getAuthTag(), encrypted].map((v) => v.toString('base64')).join('.');
    },
    decrypt(value) {
      const [iv, tag, encrypted] = value.split('.').map((v) => Buffer.from(v, 'base64'));
      const cipher = createDecipheriv('aes-256-gcm', key, iv);
      cipher.setAuthTag(tag);
      return Buffer.concat([cipher.update(encrypted), cipher.final()]).toString('utf8');
    },
    close() {
      db.close();
    },
  };
}
