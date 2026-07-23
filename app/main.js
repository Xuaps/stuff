import { createStore } from "./store.js";
import { createDexiePersistence } from "./persistence.js";
import { mount } from "./views.js";

const store = await createStore({ persistence: createDexiePersistence() });
mount(store);
