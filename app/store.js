const LEGACY_STORAGE_KEY = "things-web-v1";

export { LEGACY_STORAGE_KEY };

export const LISTS = Object.freeze([
  "inbox",
  "today",
  "upcoming",
  "anytime",
  "someday",
  "logbook",
]);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function emptyState() {
  return { tasks: [], projects: [], areas: [] };
}

export function todayStr(date = new Date()) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

/**
 * The store owns all writes. Persistence is deliberately a tiny interface so
 * this module stays usable in Node and can be tested without IndexedDB.
 */
export async function createStore({ persistence = createMemoryPersistence(), initialState, now = () => Date.now(), today = () => todayStr(), idFactory = createId } = {}) {
  const persisted = await persistence.load();
  let state = normalizeState(persisted ?? initialState ?? emptyState());
  const listeners = new Set();
  let writes = Promise.resolve();

  if (persisted == null && initialState != null) await persistence.save(state);

  const store = {
    getState: () => clone(state),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // Queries return copies so a view cannot mutate state by accident.
    tasks: () => active(state.tasks).sort(comparePos).map(clone),
    projects: () => active(state.projects).sort(comparePos).map(clone),
    areas: () => active(state.areas).sort(comparePos).map(clone),
    taskById: id => copyLive(state.tasks, id),
    projectById: id => copyLive(state.projects, id),
    areaById: id => copyLive(state.areas, id),
    allTags: () => [...new Set(active(state.tasks).flatMap(task => task.tags))].sort(),
    tasksForList: (name, options = {}) => tasksForList(state, name, currentToday(), options).map(clone),
    tasksForProject: (projectId, { includeDone = true } = {}) => active(state.tasks)
      .filter(task => task.projectId === projectId && (includeDone || !task.done))
      .sort(comparePos)
      .map(clone),
    tasksForTag: tag => active(state.tasks)
      .filter(task => !task.done && task.tags.includes(tag))
      .sort(comparePos)
      .map(clone),

    addTask: (input, fields = {}) => commit(draft => {
      const values = typeof input === "string" ? { ...fields, title: input } : { ...(input || {}) };
      const title = String(values.title ?? "").trim();
      if (!title) throw new TypeError("A task title is required");
      const task = normalizeTask({
        ...values,
        id: values.id || idFactory("task"),
        title,
        createdAt: values.createdAt ?? now(),
        pos: values.pos || nextPos(draft.tasks),
        done: false,
        doneAt: null,
        tombstone: false,
      }, draft.tasks.length);
      draft.tasks.push(task);
      return task;
    }),

    updateTask: (id, changes) => commit(draft => {
      const task = findLive(draft.tasks, id);
      if (!task) return null;
      const allowed = ["title", "notes", "projectId", "headingId", "tags", "when", "evening", "deadline"];
      for (const key of allowed) {
        if (!(key in (changes || {}))) continue;
        let value = changes[key];
        if (key === "title") {
          value = String(value ?? "").trim();
          if (!value) continue;
        }
        if (key === "tags") value = Array.isArray(value) ? value.map(String).map(tag => tag.trim()).filter(Boolean) : [];
        if (key === "projectId" || key === "headingId") value = value == null || value === "" ? null : String(value);
        if (key === "deadline") value = value || null;
        if (key === "when" && typeof value !== "string") continue;
        task[key] = value;
      }
      return task;
    }),

    toggleToday: id => commit(draft => {
      const task = findLive(draft.tasks, id);
      if (!task) return null;
      const date = currentToday();
      task.when = task.when === date ? "inbox" : date;
      task.evening = false;
      return task;
    }),

    completeTask: (id, completed = true) => commit(draft => {
      const task = findLive(draft.tasks, id);
      if (!task) return null;
      const done = Boolean(completed);
      task.done = done;
      task.doneAt = done ? (asTimestamp(now()) ?? Date.now()) : null;
      return task;
    }),

    deleteTask: id => commit(draft => {
      const task = findLive(draft.tasks, id);
      if (!task) return null;
      task.tombstone = true;
      return task;
    }),

    addProject: title => commit(draft => {
      const name = String(title ?? "").trim();
      if (!name) throw new TypeError("A project title is required");
      const project = normalizeProject({ id: idFactory("project"), title: name, pos: nextPos(draft.projects) }, draft.projects.length);
      draft.projects.push(project);
      return project;
    }),

    completeProject: (id, completed = true) => commit(draft => {
      const project = findLive(draft.projects, id);
      if (!project) return null;
      project.done = Boolean(completed);
      return project;
    }),

    deleteProject: id => commit(draft => {
      const project = findLive(draft.projects, id);
      if (!project) return null;
      project.tombstone = true;
      for (const task of draft.tasks) {
        if (task.projectId === id) task.tombstone = true;
      }
      return project;
    }),

    addArea: title => commit(draft => {
      const name = String(title ?? "").trim();
      if (!name) throw new TypeError("An area title is required");
      const area = normalizeArea({ id: idFactory("area"), title: name, pos: nextPos(draft.areas) }, draft.areas.length);
      draft.areas.push(area);
      return area;
    }),

    deleteArea: id => commit(draft => {
      const area = findLive(draft.areas, id);
      if (!area) return null;
      area.tombstone = true;
      for (const project of draft.projects) {
        if (project.areaId === id) project.areaId = null;
      }
      return area;
    }),
  };

  return store;

  function currentToday() {
    return typeof today === "function" ? today() : today;
  }

  function commit(mutator) {
    const operation = writes.then(async () => {
      const draft = clone(state);
      const result = mutator(draft);
      await persistence.save(draft);
      state = draft;
      for (const listener of listeners) listener();
      return result == null ? null : clone(result);
    });
    // A failed write must not prevent later commands from running.
    writes = operation.catch(() => undefined);
    return operation;
  }
}

export function createMemoryPersistence(seed = null) {
  let saved = seed == null ? null : clone(seed);
  return {
    async load() {
      return saved == null ? null : clone(saved);
    },
    async save(next) {
      saved = clone(next);
    },
    snapshot() {
      return saved == null ? null : clone(saved);
    },
  };
}

export function normalizeState(raw) {
  const source = raw && typeof raw === "object" ? raw : emptyState();
  const tasks = Array.isArray(source.tasks) ? source.tasks : [];
  const projects = Array.isArray(source.projects) ? source.projects : [];
  const areas = Array.isArray(source.areas) ? source.areas : [];
  return {
    tasks: tasks.map((task, index) => normalizeTask(task, index)),
    projects: projects.map((project, index) => normalizeProject(project, index)),
    areas: areas.map((area, index) => normalizeArea(area, index)),
  };
}

function normalizeTask(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  const createdAt = asTimestamp(source.createdAt) ?? Date.now();
  const done = Boolean(source.done);
  return {
    id: String(source.id || createId("task")),
    title: String(source.title ?? ""),
    notes: String(source.notes ?? ""),
    projectId: source.projectId == null || source.projectId === "" ? null : String(source.projectId),
    headingId: source.headingId == null || source.headingId === "" ? null : String(source.headingId),
    tags: Array.isArray(source.tags) ? source.tags.map(String).map(tag => tag.trim()).filter(Boolean) : [],
    when: typeof source.when === "string" && source.when ? source.when : "inbox",
    evening: Boolean(source.evening),
    deadline: source.deadline || null,
    checklist: normalizeChecklist(source.checklist),
    pos: String(source.pos || `a${index.toString(36)}`),
    done,
    doneAt: done ? (asTimestamp(source.doneAt) ?? createdAt) : null,
    tombstone: Boolean(source.tombstone),
    createdAt,
  };
}

function normalizeProject(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(source.id || createId("project")),
    title: String(source.title ?? ""),
    notes: String(source.notes ?? ""),
    areaId: source.areaId == null || source.areaId === "" ? null : String(source.areaId),
    when: source.when || null,
    deadline: source.deadline || null,
    pos: String(source.pos || `a${index.toString(36)}`),
    done: Boolean(source.done),
    tombstone: Boolean(source.tombstone),
  };
}

function normalizeArea(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(source.id || createId("area")),
    title: String(source.title ?? ""),
    pos: String(source.pos || `a${index.toString(36)}`),
    tombstone: Boolean(source.tombstone),
  };
}

function normalizeChecklist(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item, index) => {
    const source = item && typeof item === "object" ? item : {};
    return {
      id: String(source.id || createId("check")),
      title: String(source.title ?? ""),
      done: Boolean(source.done),
      pos: String(source.pos || `a${index.toString(36)}`),
    };
  });
}

function tasksForList(state, name, today, options) {
  const tasks = active(state.tasks);
  let result;
  switch (name) {
    case "inbox":
      result = tasks.filter(task => !task.done && !task.projectId && task.when === "inbox");
      break;
    case "today":
      result = tasks.filter(task => !task.done && isDate(task.when) && task.when <= today);
      break;
    case "upcoming":
      result = tasks.filter(task => !task.done && isDate(task.when) && task.when > today);
      break;
    case "anytime":
      result = tasks.filter(task => !task.done && task.when !== "someday" && !(isDate(task.when) && task.when > today) && (task.projectId || task.when !== "inbox"));
      break;
    case "someday":
      result = tasks.filter(task => !task.done && task.when === "someday");
      break;
    case "logbook":
      result = tasks.filter(task => task.done).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0) || comparePos(a, b));
      break;
    case "project":
      result = tasks.filter(task => task.projectId === options.projectId && (options.includeDone || !task.done));
      break;
    case "tag":
      result = tasks.filter(task => !task.done && task.tags.includes(options.tag));
      break;
    default:
      result = [];
  }
  if (name === "logbook") return result;
  return result.sort(name === "upcoming" ? compareWhen : comparePos);
}

function active(records) {
  return records.filter(record => !record.tombstone);
}

function findLive(records, id) {
  return records.find(record => record.id === id && !record.tombstone);
}

function copyLive(records, id) {
  const record = findLive(records, id);
  return record ? clone(record) : null;
}

function comparePos(a, b) {
  return String(a.pos).localeCompare(String(b.pos), "en", { numeric: true }) || String(a.id).localeCompare(String(b.id));
}

function compareWhen(a, b) {
  return String(a.when).localeCompare(String(b.when)) || comparePos(a, b);
}

function nextPos(records) {
  let max = -1;
  for (const record of records) {
    const match = /^a([0-9a-z]+)$/i.exec(String(record.pos || ""));
    if (match) max = Math.max(max, parseInt(match[1], 36));
  }
  return `a${(max + 1).toString(36)}`;
}

function isDate(value) {
  return DATE_RE.test(value);
}

function asTimestamp(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  return null;
}

function createId(prefix = "id") {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") return `${prefix}-${randomUUID.call(globalThis.crypto)}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
