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

test("today includes the date boundary and overdue tasks, but not tomorrow", async () => {
  const store = await createStore({
    persistence: createMemoryPersistence(),
    today: () => "2025-05-15",
  });
  await store.addTask({ title: "Today", when: "2025-05-15" });
  await store.addTask({ title: "Overdue", when: "2025-05-14" });
  await store.addTask({ title: "Tomorrow", when: "2025-05-16" });

  assert.deepEqual(store.tasksForList("today").map(task => task.title), ["Today", "Overdue"]);
  assert.deepEqual(store.tasksForList("upcoming").map(task => task.title), ["Tomorrow"]);
});

test("today keeps evening tasks in the evening section", async () => {
  const store = await createStore({
    persistence: createMemoryPersistence(),
    today: () => "2025-05-15",
  });
  await store.addTask({ title: "Day task", when: "2025-05-15" });
  await store.addTask({ title: "Evening task", when: "2025-05-15", evening: true });

  const tasks = store.tasksForList("today");
  assert.deepEqual(tasks.filter(task => !task.evening).map(task => task.title), ["Day task"]);
  assert.deepEqual(tasks.filter(task => task.evening).map(task => task.title), ["Evening task"]);
});

test("upcoming tasks are ordered chronologically for date grouping", async () => {
  const store = await createStore({
    persistence: createMemoryPersistence(),
    today: () => "2025-05-15",
  });
  await store.addTask({ title: "Later", when: "2025-05-20" });
  await store.addTask({ title: "Soon", when: "2025-05-16" });
  await store.addTask({ title: "Middle", when: "2025-05-18" });

  assert.deepEqual(store.tasksForList("upcoming").map(task => task.title), ["Soon", "Middle", "Later"]);
});

test("someday tasks stay out of actionable lists", async () => {
  const store = await createStore({
    persistence: createMemoryPersistence(),
    today: () => "2025-05-15",
  });
  const someday = await store.addTask({ title: "Parked", when: "someday" });
  const inbox = await store.addTask({ title: "Inbox", when: "inbox" });
  const project = await store.addProject("Project");
  await store.updateTask(someday.id, { projectId: project.id });
  await store.updateTask(inbox.id, { projectId: project.id });

  assert.deepEqual(store.tasksForList("someday").map(task => task.title), ["Parked"]);
  assert.equal(store.tasksForList("inbox").some(task => task.id === someday.id), false);
  assert.equal(store.tasksForList("today").some(task => task.id === someday.id), false);
  assert.equal(store.tasksForList("upcoming").some(task => task.id === someday.id), false);
  assert.equal(store.tasksForList("anytime").some(task => task.id === someday.id), false);
});

test("anytime excludes future scheduling while retaining project inbox tasks", async () => {
  const store = await createStore({
    persistence: createMemoryPersistence(),
    today: () => "2025-05-15",
  });
  const project = await store.addProject("Project");
  const future = await store.addTask({ title: "Future", when: "2025-05-20", projectId: project.id });
  const projectInbox = await store.addTask({ title: "Project inbox", when: "inbox", projectId: project.id });
  const looseInbox = await store.addTask({ title: "Loose inbox", when: "inbox" });

  assert.deepEqual(store.tasksForList("anytime").map(task => task.title), ["Project inbox"]);
  assert.equal(store.tasksForList("upcoming").some(task => task.id === future.id), true);
  assert.equal(store.tasksForList("inbox").some(task => task.id === looseInbox.id), true);
});

test("toggleToday schedules a task for today and toggles it back to inbox", async () => {
  const store = await createStore({
    persistence: createMemoryPersistence(),
    today: () => "2025-05-15",
  });
  const task = await store.addTask({ title: "Plan this", when: "2025-05-20", evening: true });

  await store.toggleToday(task.id);
  assert.equal(store.taskById(task.id).when, "2025-05-15");
  assert.equal(store.taskById(task.id).evening, false);
  assert.deepEqual(store.tasksForList("today").map(item => item.id), [task.id]);
  assert.deepEqual(store.tasksForList("upcoming"), []);

  await store.toggleToday(task.id);
  assert.equal(store.taskById(task.id).when, "inbox");
  assert.equal(store.taskById(task.id).evening, false);
  assert.deepEqual(store.tasksForList("inbox").map(item => item.id), [task.id]);
});
