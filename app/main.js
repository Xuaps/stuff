import { createStore } from "./store.js";
import { createDexiePersistence } from "./persistence.js";
import { mount } from "./views.js";

const store = await createStore({ persistence: createDexiePersistence() });
mount(store);

if (navigator.serviceWorker) {
  navigator.serviceWorker.register("./sw.js").catch(error => console.warn("Things Web service worker failed", error));
}

const params = new URLSearchParams(location.search);
const sharePath = new URL("./share", document.baseURI).pathname;
if (location.pathname === sharePath) {
  const title = params.get("title")?.trim();
  const text = params.get("text")?.trim();
  const url = params.get("url")?.trim();
  if (title || text || url) {
    await store.addTask({
      title: title || text || url || "Shared item",
      notes: [text, url].filter(Boolean).join("\n"),
      when: "inbox",
    });
    history.replaceState(null, "", new URL("./", document.baseURI));
  }
} else if (params.get("action") === "new") {
  document.querySelector(".new-task-input")?.focus();
}
