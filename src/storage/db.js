// IndexedDB access. Only the service worker writes; extension pages go through messages.

const DB_NAME = 'tabpilot';
export const DB_VERSION = 1;
export const STORES = ['workspaces', 'sessions', 'recoverySnapshots', 'tabMetadata'];

// Each entry upgrades the schema from version (n - 1) to n. Never edit a released entry; add a new one.
const MIGRATIONS = {
  1(db) {
    db.createObjectStore('workspaces', { keyPath: 'id' });
    db.createObjectStore('sessions', { keyPath: 'id' });
    db.createObjectStore('recoverySnapshots', { keyPath: 'id' });
    db.createObjectStore('tabMetadata', { keyPath: 'key' });
  },
};

let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (event) => {
        for (let v = event.oldVersion + 1; v <= DB_VERSION; v++) MIGRATIONS[v](req.result, req.transaction);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(new Error(`Could not open the database: ${req.error?.message || 'unknown error'}`)); };
      req.onblocked = () => { dbPromise = null; reject(new Error('Database upgrade is blocked by another open TabPilot page. Close it and retry.')); };
    });
  }
  return dbPromise;
}

const asPromise = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

/** Runs fn inside a transaction; resolves with fn's result only after the transaction commits. */
async function run(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(new Error(`Storage error: ${tx.error?.message || 'unknown error'}`));
    tx.onabort = () => reject(new Error(`Storage write aborted: ${tx.error?.message || 'quota exceeded or storage unavailable'}`));
    Promise.resolve(fn(tx)).then((r) => { result = r; }, (e) => { try { tx.abort(); } catch { /* already done */ } reject(e); });
  });
}

export const db = {
  getAll: (store) => run([store], 'readonly', (tx) => asPromise(tx.objectStore(store).getAll())),
  get: (store, key) => run([store], 'readonly', (tx) => asPromise(tx.objectStore(store).get(key))),
  put: (store, value) => run([store], 'readwrite', (tx) => { tx.objectStore(store).put(value); return value; }),
  putMany: (store, values) => run([store], 'readwrite', (tx) => { const s = tx.objectStore(store); values.forEach((v) => s.put(v)); }),
  delete: (store, key) => run([store], 'readwrite', (tx) => { tx.objectStore(store).delete(key); }),
  deleteMany: (store, keys) => run([store], 'readwrite', (tx) => { const s = tx.objectStore(store); keys.forEach((k) => s.delete(k)); }),
  /** Clears the given stores and writes new contents in one atomic transaction. */
  replace: (contents) => run(Object.keys(contents), 'readwrite', (tx) => {
    for (const [store, values] of Object.entries(contents)) {
      const s = tx.objectStore(store);
      s.clear();
      values.forEach((v) => s.put(v));
    }
  }),
};
