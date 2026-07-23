export async function syncPanel({ config = {}, status = "local", onConfigured = () => {}, onDisable = () => {}, onReminders = null } = {}) {
  const { newRecoveryKey, recoveryKey, registerPasskey, signInWithPasskey } = await import("./auth.js");
  const panel = document.createElement("section");
  panel.className = "sync-panel";
  const title = document.createElement("h2"); title.textContent = "Sync";
  const state = document.createElement("p"); state.className = "sync-status";
  const endpoint = input("Sync endpoint", config.endpoint || "http://localhost:8787");
  const username = input("Passkey name (optional)", "things-user");
  const recovery = input("Recovery key (paste to import)", ""); recovery.input.type = "password";
  const actions = document.createElement("div"); actions.className = "sync-actions";
  const register = button("Register passkey", async () => {
    const result = await registerPasskey(endpoint.input.value, username.input.value);
    let key = result.key;
    let exported = result.recoveryKey;
    if (!key) {
      const generated = await newRecoveryKey();
      key = generated.key; exported = generated.recoveryKey;
      state.textContent = "Passkey PRF is unavailable. Save the recovery key and import it on another device.";
    }
    recovery.input.value = exported;
    await onConfigured({ endpoint: endpoint.input.value, room: result.room, token: result.token, refreshToken: result.refreshToken, vapidPublicKey: result.vapidPublicKey }, key, exported);
  });
  const login = button("Sign in with passkey", async () => {
    const result = await signInWithPasskey(endpoint.input.value, config.room || "");
    let key = result.key;
    let exported = result.recoveryKey || recovery.input.value.trim();
    if (!key) {
      if (!exported) throw new Error("A recovery key is required when passkey PRF is unavailable");
      key = await recoveryKey(exported);
    }
    await onConfigured({ endpoint: endpoint.input.value, room: result.room, token: result.token, refreshToken: result.refreshToken, vapidPublicKey: result.vapidPublicKey }, key, exported);
  });
  const copy = button("Copy recovery key", async () => {
    if (!recovery.input.value) throw new Error("Register or import a recovery key first");
    await navigator.clipboard.writeText(recovery.input.value);
    state.textContent = "Recovery key copied. Store it somewhere safe.";
  });
  const importButton = button("Import recovery key", async () => {
    const value = recovery.input.value.trim();
    if (!value) throw new Error("Paste a recovery key first");
    await recoveryKey(value);
    state.textContent = "Recovery key is valid. Sign in to enable sync.";
  });
  const reminders = onReminders ? button("Enable Reminders", async () => {
    if (!("Notification" in globalThis)) throw new Error("Notifications are not supported");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("Notification permission was not granted");
    await onReminders({ ...config, endpoint: endpoint.input.value, vapidPublicKey: config.vapidPublicKey });
    state.textContent = "Reminders enabled";
  }) : null;
  const disable = button("Sign out / disable sync", onDisable);
  actions.append(register, login, copy, importButton, ...(reminders ? [reminders] : []), disable);
  panel.append(title, state, endpoint.row, username.row, recovery.row, actions);
  setStatus(status);
  return panel;

  function setStatus(value) { state.textContent = value === "local" ? "Local-only (no account or network)" : `Sync: ${value}`; }
  function button(label, action) {
    const item = document.createElement("button"); item.className = "pill-btn"; item.type = "button"; item.textContent = label;
    item.onclick = () => Promise.resolve(action()).catch(error => { state.textContent = error.message; });
    return item;
  }
  function input(label, value) {
    const row = document.createElement("label"); row.className = "sync-field";
    const caption = document.createElement("span"); caption.textContent = label;
    const item = document.createElement("input"); item.value = value; row.append(caption, item); return { row, input: item };
  }
}
