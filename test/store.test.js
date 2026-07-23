import test from "node:test";
import assert from "node:assert/strict";
import { createMemoryPersistence, createStore } from "../app/store.js";

test("inbox and logbook membership follows completion", async () => {
  let clock = 1000;
  const store = await createStore({
    persistence: createMemoryPersistence(),
    now: () => clock,
  });

  const task = await store.addTask({ title: "Capture an idea", when: "inbox" });
  assert.deepEqual(store.tasksForList("inbox").map(item => item.id), [task.id]);
  assert.deepEqual(store.tasksForList("logbook"), []);

  await store.completeTask(task.id);
  assert.equal(store.tasksForList("inbox").length, 0);
  assert.deepEqual(store.tasksForList("logbook").map(item => item.id), [task.id]);
  assert.equal(store.taskById(task.id).done, true);

  await store.completeTask(task.id, false);
  assert.deepEqual(store.tasksForList("inbox").map(item => item.id), [task.id]);
  assert.deepEqual(store.tasksForList("logbook"), []);
  assert.equal(store.taskById(task.id).doneAt, null);
});

test("logbook is ordered newest completion first", async () => {
  let clock = 1000;
  const store = await createStore({
    persistence: createMemoryPersistence(),
    now: () => clock,
  });

  const first = await store.addTask("First");
  const second = await store.addTask("Second");
  await store.completeTask(first.id);
  clock = 2000;
  await store.completeTask(second.id);

  assert.deepEqual(store.tasksForList("logbook").map(task => task.title), ["Second", "First"]);
});

test("state reloads through the injected persistence", async () => {
  const persistence = createMemoryPersistence();
  const firstStore = await createStore({ persistence });
  const task = await firstStore.addTask("Survive reload");
  await firstStore.completeTask(task.id);

  const reloadedStore = await createStore({ persistence });
  assert.deepEqual(reloadedStore.tasksForList("logbook").map(item => item.title), ["Survive reload"]);
});

test("records retain ids, positions, and tombstones", async () => {
  const persistence = createMemoryPersistence();
  const store = await createStore({ persistence });
  const task = await store.addTask("Keep its identity");
  await store.deleteTask(task.id);

  const saved = persistence.snapshot();
  assert.match(saved.tasks[0].pos, /^a/);
  assert.equal(saved.tasks[0].id, task.id);
  assert.equal(saved.tasks[0].tombstone, true);
  assert.equal(store.tasks().length, 0);
});
