// Beth's Books sync API — a Cloudflare Pages Function backed by D1.
//
// Needs, in the Pages project settings:
//   • a D1 database binding named  DB
//   • a secret / environment variable named  SYNC_KEY  (the passphrase typed into the app)
//
// GET  /api/sync            → check the key; returns { ok, seq, epoch }
// POST /api/sync { since, epoch, changes:[{store,id,data,updatedAt}] }
//                           → stores newer changes (last edit wins), returns everything changed since `since`.

const STORES = new Set(['books', 'genres', 'shelves', 'meta']);
const MAX_CHANGES = 5000;
const MAX_RECORD = 200_000; // bytes of JSON per record

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

let ready = false;
async function ensureSchema(db) {
  if (ready) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS records (
      store TEXT NOT NULL, id TEXT NOT NULL, data TEXT, updated_at TEXT NOT NULL,
      deleted INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, PRIMARY KEY (store, id))`),
    db.prepare('CREATE INDEX IF NOT EXISTS records_seq ON records (seq)'),
    db.prepare('CREATE TABLE IF NOT EXISTS counter (id INTEGER PRIMARY KEY CHECK (id = 1), v INTEGER NOT NULL, epoch TEXT NOT NULL)'),
    db.prepare('INSERT OR IGNORE INTO counter (id, v, epoch) VALUES (1, 0, ?)').bind(crypto.randomUUID()),
  ]);
  ready = true;
}

async function keyMatches(given, expected) {
  // Compare digests so the check takes the same time whatever the input.
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, expected].map(s => crypto.subtle.digest('SHA-256', enc.encode(s))));
  const x = new Uint8Array(a), y = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

export async function onRequest({ request, env }) {
  if (!env.DB || !env.SYNC_KEY) {
    return json({ error: 'not_configured', message: 'Sync is not set up on the server yet (needs the DB binding and SYNC_KEY).' }, 503);
  }
  const given = request.headers.get('x-sync-key') || '';
  if (!given || !(await keyMatches(given, env.SYNC_KEY))) return json({ error: 'unauthorised' }, 401);

  const db = env.DB;
  await ensureSchema(db);

  if (request.method === 'GET') {
    const c = await db.prepare('SELECT v, epoch FROM counter WHERE id = 1').first();
    const n = await db.prepare("SELECT COUNT(*) AS n FROM records WHERE store = 'books' AND deleted = 0").first();
    return json({ ok: true, seq: c.v, epoch: c.epoch, books: n.n });
  }
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const changes = Array.isArray(body.changes) ? body.changes : [];
  if (changes.length > MAX_CHANGES) return json({ error: 'too_many_changes' }, 413);
  for (const c of changes) {
    if (!c || !STORES.has(c.store) || typeof c.id !== 'string' || !c.id || c.id.length > 100 ||
        typeof c.updatedAt !== 'string' || (c.data != null && (typeof c.data !== 'string' || c.data.length > MAX_RECORD))) {
      return json({ error: 'bad_change' }, 400);
    }
  }

  const counter = await db.prepare('SELECT v, epoch FROM counter WHERE id = 1').first();
  // A client that last synced against a different database starts again from the beginning.
  let since = body.epoch === counter.epoch ? Math.max(0, Number(body.since) || 0) : 0;

  if (changes.length) {
    // Reserve a block of sequence numbers atomically, then write the changes.
    const r = await db.prepare('UPDATE counter SET v = v + ? WHERE id = 1 RETURNING v').bind(changes.length).first();
    const start = r.v - changes.length;
    const upsert = db.prepare(`INSERT INTO records (store, id, data, updated_at, deleted, seq) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT (store, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at, deleted = excluded.deleted, seq = excluded.seq
      WHERE excluded.updated_at >= records.updated_at`);
    const stmts = changes.map((c, i) => upsert.bind(c.store, c.id, c.data ?? null, c.updatedAt, c.data == null ? 1 : 0, start + i + 1));
    for (let i = 0; i < stmts.length; i += 100) await db.batch(stmts.slice(i, i + 100));
  }

  const rows = await db.prepare('SELECT store, id, data, updated_at, deleted, seq FROM records WHERE seq > ? ORDER BY seq').bind(since).all();
  const out = rows.results || [];
  const seq = out.length ? out[out.length - 1].seq : since;
  return json({
    epoch: counter.epoch,
    seq,
    changes: out.map(r => ({ store: r.store, id: r.id, data: r.deleted ? null : r.data, updatedAt: r.updated_at })),
  });
}
