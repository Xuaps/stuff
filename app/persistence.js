import { LEGACY_STORAGE_KEY, normalizeState } from "./store.js";

const DATABASE_NAME = "things-web-v1";
const MIGRATION_KEY = "localStorage-v1-migrated";
const STORES = ["tasks", "projects", "areas", "headings", "meta"];

export function createDexiePersistence({ name = DATABASE_NAME, legacyStorage } = {}) {
  if (legacyStorage === undefined) {
    try { legacyStorage = globalThis.localStorage; } catch { legacyStorage = null; }
  }
  const open = openDatabase(name);
  return {
    async load() {
      const db = await open;
      const [tasks, projects, areas, headings, marker] = await Promise.all(
        ["tasks", "projects", "areas", "headings", "meta"].map(store => readAll(db, store)),
      ).then(([tasks, projects, areas, headings, meta]) => [tasks, projects, areas, headings, meta.find(item => item.key === MIGRATION_KEY)]);
      if (!marker) {
        const hasIndexedData = tasks.length || projects.length || areas.length || headings.length;
        if (!hasIndexedData) {
          const legacy = readLegacy(legacyStorage);
          if (legacy) {
            const migrated = normalizeState(legacy);
            await saveRecords(db, migrated);
            removeLegacy(legacyStorage);
            await put(db, "meta", { key: MIGRATION_KEY, value: Date.now() });
            return migrated;
          }
        }
        await put(db, "meta", { key: MIGRATION_KEY, value: Date.now() });
      }
      return normalizeState({ tasks, projects, areas, headings });
    },
    async save(state) { await saveRecords(await open, normalizeState(state)); },
    async clear() {
      const db = await open;
      await transaction(db, STORES, "readwrite", stores => stores.forEach(store => stores[store].clear()));
    },
  };
}

function openDatabase(name) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error("IndexedDB is unavailable"));
    const request = indexedDB.open(name, 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of ["tasks", "projects", "areas", "headings"]) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readAll(db, name) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(name, "readonly").objectStore(name).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
function put(db, name, value) {
  return new Promise((resolve, reject) => {
    const request = db.transaction(name, "readwrite").objectStore(name).put(value);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
function transaction(db, names, mode, action) {
  return new Promise((resolve, reject) => {
    // A single transaction is required for atomic local snapshots.
    const tx = db.transaction(names, mode);
    const handles = Object.fromEntries(names.map(name => [name, tx.objectStore(name)]));
    action(handles);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });
}
async function saveRecords(db, state) {
  await transaction(db, ["tasks", "projects", "areas", "headings"], "readwrite", stores => {
    for (const name of ["tasks", "projects", "areas", "headings"]) {
      stores[name].clear();
      for (const record of state[name]) stores[name].put(record);
    }
  });
}
function readLegacy(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch { return null; }
}
function removeLegacy(storage) { try { storage?.removeItem(LEGACY_STORAGE_KEY); } catch {} }
