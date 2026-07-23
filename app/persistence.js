import Dexie from "https://cdn.jsdelivr.net/npm/dexie@4/+esm";
import { LEGACY_STORAGE_KEY, normalizeState } from "./store.js";

const DATABASE_NAME = "things-web-v1";
const MIGRATION_KEY = "localStorage-v1-migrated";

export function createDexiePersistence({ name = DATABASE_NAME, legacyStorage } = {}) {
  if (legacyStorage === undefined) {
    try {
      legacyStorage = globalThis.localStorage;
    } catch {
      legacyStorage = null;
    }
  }
  const db = new Dexie(name);
  db.version(1).stores({
    tasks: "id, projectId, done, doneAt, pos, tombstone",
    projects: "id, areaId, done, pos, tombstone",
    areas: "id, pos, tombstone",
    meta: "key",
  });

  return {
    async load() {
      const [tasks, projects, areas, marker] = await Promise.all([
        db.tasks.toArray(),
        db.projects.toArray(),
        db.areas.toArray(),
        db.meta.get(MIGRATION_KEY),
      ]);

      if (!marker) {
        const hasIndexedData = tasks.length || projects.length || areas.length;
        if (!hasIndexedData) {
          const legacy = readLegacy(legacyStorage);
          if (legacy) {
            const migrated = normalizeState(legacy);
            await saveRecords(db, migrated);
            removeLegacy(legacyStorage);
            await db.meta.put({ key: MIGRATION_KEY, value: Date.now() });
            return migrated;
          }
        }
        await db.meta.put({ key: MIGRATION_KEY, value: Date.now() });
      }

      return normalizeState({ tasks, projects, areas });
    },

    async save(state) {
      await saveRecords(db, normalizeState(state));
    },

    // Useful for a clean manual reset and harmless to the store API.
    async clear() {
      await db.transaction("rw", db.tasks, db.projects, db.areas, db.meta, async () => {
        await Promise.all([db.tasks.clear(), db.projects.clear(), db.areas.clear(), db.meta.clear()]);
      });
    },
  };
}

async function saveRecords(db, state) {
  await db.transaction("rw", db.tasks, db.projects, db.areas, async () => {
    await Promise.all([db.tasks.clear(), db.projects.clear(), db.areas.clear()]);
    await Promise.all([
      state.tasks.length ? db.tasks.bulkPut(state.tasks) : undefined,
      state.projects.length ? db.projects.bulkPut(state.projects) : undefined,
      state.areas.length ? db.areas.bulkPut(state.areas) : undefined,
    ]);
  });
}

function readLegacy(storage) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function removeLegacy(storage) {
  try {
    storage?.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // A private-mode storage object can reject removal; the migration marker
    // still prevents duplicate imports.
  }
}
