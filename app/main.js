import { createStore } from "./store.js";
import { mount } from "./views.js";

const SYNC_SETTINGS = "things-web-sync-settings";
let settings = readSettings();
let syncPersistence = null;
let syncKey = null;
let syncRecoveryKey = null;
let reminderSync = null;
let syncStatus = settings ? "starting" : "local";
const { createDexiePersistence } = await import("./persistence.js");
const localPersistence = createDexiePersistence();
const localState = await localPersistence.load();
let persistence = localPersistence;

if (settings) {
  try {
    const [{ createEncryptedSyncPersistence }, crypto, auth] = await Promise.all([
      import("./sync.js"), import("../sync/crypto.js"), import("./auth.js"),
    ]);
    const recoveryKey = settings.recoveryKey || await auth.loadDeviceRecoveryKey(settings.room);
    const key = await crypto.importRoomKey(recoveryKey);
    syncKey = key;
    syncRecoveryKey = recoveryKey;
    syncPersistence = createEncryptedSyncPersistence({
      ...settings, key, seedState: localState,
      onStatus: value => { syncStatus = value; },
      onToken: credentials => {
        settings = { ...settings, ...credentials };
        saveSettings(settings);
      },
    });
    persistence = syncPersistence;
    syncPersistence.connect();
  } catch (error) {
    console.warn("Sync settings ignored; using local data", error);
    localStorage.removeItem(SYNC_SETTINGS);
    syncStatus = "local";
  }
}

const store = await createStore({ persistence });
mount(store, {
  syncPanel: async () => {
    const { syncPanel } = await import("./sync-ui.js");
    return syncPanel({
      config: settings || {},
      status: syncPersistence?.status() || syncStatus,
      onConfigured: async (next, key, recoveryKey) => {
        const auth = await import("./auth.js");
        if (recoveryKey) await auth.saveDeviceRecoveryKey(next.room, recoveryKey);
        saveSettings({ ...next, recoveryKey: undefined });
        location.reload();
      },
      onDisable: () => { localStorage.removeItem(SYNC_SETTINGS); location.reload(); },
      onReminders: syncPersistence ? async config => {
        const reminders = await enableReminders(config, store);
        reminderSync = reminders.syncJobs;
        store.subscribe(() => reminderSync?.().catch(error => console.warn("Reminder scheduling failed", error)));
      } : null,
    });
  },
});

if (navigator.serviceWorker) {
  navigator.serviceWorker.register("./sw.js").then(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (settings?.room && syncRecoveryKey) registration.active?.postMessage({ type: "sync-key", room: settings.room, key: syncRecoveryKey });
  }).catch(error => console.warn("Things Web service worker failed", error));
}

const params = new URLSearchParams(location.search);
const sharePath = new URL("./share", document.baseURI).pathname;
if (location.pathname === sharePath) {
  const title = params.get("title")?.trim();
  const text = params.get("text")?.trim();
  const url = params.get("url")?.trim();
  if (title || text || url) {
    await store.addTask({ title: title || text || url || "Shared item", notes: [text, url].filter(Boolean).join("\n"), when: "inbox" });
    history.replaceState(null, "", new URL("./", document.baseURI));
  }
} else if (params.get("action") === "new") document.querySelector(".new-task-input")?.focus();

function readSettings() {
  try { return JSON.parse(localStorage.getItem(SYNC_SETTINGS) || "null"); } catch { return null; }
}
function saveSettings(value) {
  const next = { ...value };
  delete next.recoveryKey;
  localStorage.setItem(SYNC_SETTINGS, JSON.stringify(next));
}

async function enableReminders(config, store) {
  const { createPushClient } = await import("./push.js");
  const push = createPushClient(config.endpoint, {
    token: config.token,
    refreshToken: config.refreshToken,
    onToken: credentials => {
      Object.assign(config, credentials);
      settings = { ...settings, ...credentials };
      saveSettings(settings);
    },
  });
  const subscription = await push.subscribe(config.vapidPublicKey);
  const jobs = new Map();
  const previous = new Map();
  for (const job of await push.list()) jobs.set(job.jobKey, job);
  let reconciliation = Promise.resolve();
  const syncJobs = () => {
    reconciliation = reconciliation.catch(() => {}).then(async () => {
      const desired = new Map();
      for (const task of store.tasks()) {
        if (!task.deadline) continue;
        const jobKey = await push.jobKey(task.id, syncRecoveryKey || syncKey);
        const sendAt = new Date(`${task.deadline}T09:00:00`).getTime();
        desired.set(jobKey, { task, signature: `${sendAt}:${task.title}` });
      }
      for (const [jobKey, job] of jobs) {
        if (!desired.has(jobKey)) {
          await push.cancel(job.id);
          jobs.delete(jobKey);
          previous.delete(jobKey);
        }
      }
      for (const [jobKey, { task, signature }] of desired) {
        if (previous.get(jobKey) === signature && jobs.has(jobKey)) continue;
        const jobId = await push.schedule(task.id, config.room, syncRecoveryKey || syncKey, new Date(`${task.deadline}T09:00:00`).getTime(), { title: "Things deadline", body: task.title });
        jobs.set(jobKey, { id: jobId, jobKey });
        previous.set(jobKey, signature);
      }
    });
    return reconciliation;
  };
  await syncJobs();
  return { subscription, syncJobs };
}
