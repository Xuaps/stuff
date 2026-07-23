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
  return { tasks: [], projects: [], areas: [], headings: [] };
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
  const undoStack = [];
  const redoStack = [];

  if (persisted == null && initialState != null) await persistence.save(state);

  const store = {
    getState: () => clone(state),
    canUndo: () => undoStack.length > 0,
    canRedo: () => redoStack.length > 0,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // Queries return copies so a view cannot mutate state by accident.
    tasks: () => active(state.tasks).sort(comparePos).map(clone),
    projects: () => active(state.projects).sort(comparePos).map(clone),
    areas: () => active(state.areas).sort(comparePos).map(clone),
    headings: () => active(state.headings).sort(comparePos).map(clone),
    taskById: id => copyLive(state.tasks, id),
    projectById: id => copyLive(state.projects, id),
    areaById: id => copyLive(state.areas, id),
    headingById: id => copyLive(state.headings, id),
    allTags: () => [...new Set(active(state.tasks).flatMap(task => task.tags))].sort(),
    tasksForList: (name, options = {}) => tasksForList(state, name, currentToday(), options).map(clone),
    tasksForProject: (projectId, { includeDone = true } = {}) => active(state.tasks)
      .filter(task => task.projectId === projectId && (includeDone || !task.done))
      .sort(comparePos)
      .map(clone),
    headingsForProject: projectId => active(state.headings)
      .filter(heading => heading.projectId === projectId)
      .sort(comparePos)
      .map(clone),
    tasksForHeading: (headingId, { includeDone = true } = {}) => active(state.tasks)
      .filter(task => task.headingId === headingId && (includeDone || !task.done))
      .sort(comparePos)
      .map(clone),
    projectsForArea: (areaId, { includeDone = true } = {}) => active(state.projects)
      .filter(project => project.areaId === areaId && (includeDone || !project.done))
      .sort(comparePos)
      .map(clone),
    tasksForArea: (areaId, { includeDone = true } = {}) => {
      const projectIds = new Set(active(state.projects)
        .filter(project => project.areaId === areaId)
        .map(project => project.id));
      return active(state.tasks)
        .filter(task => projectIds.has(task.projectId) && (includeDone || !task.done))
        .sort(comparePos)
        .map(clone);
    },
    projectProgress: projectId => {
      const tasks = active(state.tasks).filter(task => task.projectId === projectId);
      return {
        open: tasks.filter(task => !task.done).length,
        done: tasks.filter(task => task.done).length,
      };
    },
    tasksForTag: tag => active(state.tasks)
      .filter(task => !task.done && task.tags.includes(tag))
      .sort(comparePos)
      .map(clone),

    undo: () => historyCommand("undo"),
    redo: () => historyCommand("redo"),

    addTask: (input, fields = {}) => commit(draft => {
      const values = typeof input === "string" ? { ...fields, title: input } : { ...(input || {}) };
      const title = String(values.title ?? "").trim();
      if (!title) throw new TypeError("A task title is required");
      const heading = values.headingId == null || values.headingId === ""
        ? null
        : findLive(draft.headings, String(values.headingId));
      const task = normalizeTask({
        ...values,
        id: values.id || idFactory("task"),
        title,
        projectId: heading ? heading.projectId : values.projectId,
        headingId: heading?.id ?? null,
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
      if (Object.prototype.hasOwnProperty.call(changes || {}, "headingId")) {
        const heading = task.headingId ? findLive(draft.headings, task.headingId) : null;
        task.headingId = heading ? heading.id : null;
        if (heading && !Object.prototype.hasOwnProperty.call(changes || {}, "projectId")) task.projectId = heading.projectId;
      }
      if (task.headingId) {
        const heading = findLive(draft.headings, task.headingId);
        if (!heading || heading.projectId !== task.projectId) task.headingId = null;
      }
      return task;
    }),

    assignTaskToProject: (taskId, projectId) => commit(draft => {
      const task = findLive(draft.tasks, taskId);
      if (!task) return null;
      task.projectId = projectId == null || projectId === "" ? null : String(projectId);
      if (task.headingId) {
        const heading = findLive(draft.headings, task.headingId);
        if (!heading || heading.projectId !== task.projectId) task.headingId = null;
      }
      return task;
    }),

    assignTaskToHeading: (taskId, headingId) => commit(draft => {
      const task = findLive(draft.tasks, taskId);
      if (!task) return null;
      if (headingId == null || headingId === "") {
        task.headingId = null;
        return task;
      }
      const heading = findLive(draft.headings, String(headingId));
      if (!heading) return null;
      task.projectId = heading.projectId;
      task.headingId = heading.id;
      return task;
    }),

    reorderTask: (taskId, placement = {}) => commit(draft => {
      const task = findLive(draft.tasks, taskId);
      if (!task) return null;
      const request = typeof placement === "string" ? { beforeId: placement } : (placement || {});
      const hasProject = Object.prototype.hasOwnProperty.call(request, "projectId");
      const hasHeading = Object.prototype.hasOwnProperty.call(request, "headingId");
      const projectId = hasProject ? nullableId(request.projectId) : task.projectId;
      const headingId = hasHeading ? nullableId(request.headingId) : task.headingId;
      if (headingId) {
        const heading = findLive(draft.headings, headingId);
        if (!heading || heading.projectId !== projectId) return null;
      }
      task.projectId = projectId;
      task.headingId = headingId;
      const siblings = draft.tasks
        .filter(item => !item.tombstone && item.id !== task.id && item.projectId === projectId && item.headingId === headingId)
        .sort(comparePos);
      let next = request.beforeId && siblings.find(item => item.id === request.beforeId);
      let previous = request.afterId && siblings.find(item => item.id === request.afterId);
      if (next && !previous) previous = siblings[siblings.indexOf(next) - 1];
      if (previous && !next) next = siblings[siblings.indexOf(previous) + 1];
      task.pos = fractionalPosition(previous?.pos, next?.pos, siblings);
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

    addHeading: (input, fields = {}) => commit(draft => {
      const values = typeof input === "string" ? { ...fields, title: input } : { ...(input || {}) };
      const title = String(values.title ?? "").trim();
      if (!title) throw new TypeError("A heading title is required");
      const projectId = values.projectId == null || values.projectId === "" ? null : String(values.projectId);
      if (!projectId) throw new TypeError("A heading project is required");
      const heading = normalizeHeading({
        ...values,
        id: values.id || idFactory("heading"),
        title,
        projectId,
        pos: values.pos || nextPos(draft.headings.filter(item => item.projectId === projectId)),
        tombstone: false,
      }, draft.headings.length);
      draft.headings.push(heading);
      return heading;
    }),

    updateHeading: (id, changes) => commit(draft => {
      const heading = findLive(draft.headings, id);
      if (!heading) return null;
      if (Object.prototype.hasOwnProperty.call(changes || {}, "title")) {
        const title = String(changes.title ?? "").trim();
        if (title) heading.title = title;
      }
      if (Object.prototype.hasOwnProperty.call(changes || {}, "pos")) {
        const pos = String(changes.pos ?? "").trim();
        if (pos) heading.pos = pos;
      }
      return heading;
    }),

    deleteHeading: id => commit(draft => {
      const heading = findLive(draft.headings, id);
      if (!heading) return null;
      heading.tombstone = true;
      for (const task of draft.tasks) {
        if (task.headingId === id) task.headingId = null;
      }
      return heading;
    }),

    addChecklistItem: (taskId, input, fields = {}) => commit(draft => {
      const task = findLive(draft.tasks, taskId);
      if (!task) return null;
      const values = typeof input === "string" ? { ...fields, title: input } : { ...(input || {}) };
      const title = String(values.title ?? "").trim();
      if (!title) throw new TypeError("A checklist item title is required");
      const item = normalizeChecklistItem({
        ...values,
        id: values.id || idFactory("check"),
        title,
        done: Boolean(values.done),
        pos: values.pos || nextPos(task.checklist),
      }, task.checklist.length);
      task.checklist.push(item);
      task.checklist.sort(comparePos);
      return item;
    }),

    updateChecklistItem: (taskId, itemId, changes) => commit(draft => {
      const task = findLive(draft.tasks, taskId);
      const item = task && task.checklist.find(check => check.id === itemId);
      if (!item) return null;
      if (Object.prototype.hasOwnProperty.call(changes || {}, "title")) {
        const title = String(changes.title ?? "").trim();
        if (title) item.title = title;
      }
      if (Object.prototype.hasOwnProperty.call(changes || {}, "done")) item.done = Boolean(changes.done);
      if (Object.prototype.hasOwnProperty.call(changes || {}, "pos")) {
        const pos = String(changes.pos ?? "").trim();
        if (pos) item.pos = pos;
      }
      task.checklist.sort(comparePos);
      return item;
    }),

    toggleChecklistItem: (taskId, itemId, completed) => commit(draft => {
      const task = findLive(draft.tasks, taskId);
      const item = task && task.checklist.find(check => check.id === itemId);
      if (!item) return null;
      item.done = completed == null ? !item.done : Boolean(completed);
      return item;
    }),

    removeChecklistItem: (taskId, itemId) => commit(draft => {
      const task = findLive(draft.tasks, taskId);
      if (!task) return null;
      const index = task.checklist.findIndex(item => item.id === itemId);
      if (index < 0) return null;
      const [item] = task.checklist.splice(index, 1);
      return item;
    }),

    // Keep the command vocabulary symmetrical with deleteTask/deleteHeading.
    deleteChecklistItem: (taskId, itemId) => store.removeChecklistItem(taskId, itemId),

    addProject: (input, fields = {}) => commit(draft => {
      const values = typeof input === "string" ? { ...fields, title: input } : { ...(input || {}) };
      const name = String(values.title ?? "").trim();
      if (!name) throw new TypeError("A project title is required");
      const project = normalizeProject({
        ...values,
        id: values.id || idFactory("project"),
        title: name,
        pos: values.pos || nextPos(draft.projects),
      }, draft.projects.length);
      draft.projects.push(project);
      return project;
    }),

    updateProject: (id, changes) => commit(draft => {
      const project = findLive(draft.projects, id);
      if (!project) return null;
      for (const key of ["title", "notes", "areaId", "when", "deadline"]) {
        if (!(key in (changes || {}))) continue;
        let value = changes[key];
        if (key === "title") {
          value = String(value ?? "").trim();
          if (!value) continue;
        }
        if (key === "areaId") value = value == null || value === "" ? null : String(value);
        if (key === "deadline") value = value || null;
        project[key] = value;
      }
      return project;
    }),

    assignProjectToArea: (projectId, areaId) => commit(draft => {
      const project = findLive(draft.projects, projectId);
      if (!project) return null;
      project.areaId = areaId == null || areaId === "" ? null : String(areaId);
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
      for (const heading of draft.headings) {
        if (heading.projectId === id) heading.tombstone = true;
      }
      return project;
    }),

    addArea: (input, fields = {}) => commit(draft => {
      const values = typeof input === "string" ? { ...fields, title: input } : { ...(input || {}) };
      const name = String(values.title ?? "").trim();
      if (!name) throw new TypeError("An area title is required");
      const area = normalizeArea({
        ...values,
        id: values.id || idFactory("area"),
        title: name,
        pos: values.pos || nextPos(draft.areas),
      }, draft.areas.length);
      draft.areas.push(area);
      return area;
    }),

    updateArea: (id, changes) => commit(draft => {
      const area = findLive(draft.areas, id);
      if (!area) return null;
      if (Object.prototype.hasOwnProperty.call(changes || {}, "title")) {
        const title = String(changes.title ?? "").trim();
        if (title) area.title = title;
      }
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
      const before = clone(state);
      const draft = clone(state);
      const result = mutator(draft);
      if (sameState(before, draft)) return result == null ? null : clone(result);
      await persistence.save(draft);
      state = draft;
      undoStack.push({ before, after: clone(draft) });
      redoStack.length = 0;
      for (const listener of listeners) listener();
      return result == null ? null : clone(result);
    });
    // A failed write must not prevent later commands from running.
    writes = operation.catch(() => undefined);
    return operation;
  }

  function historyCommand(direction) {
    const operation = writes.then(async () => {
      const source = direction === "undo" ? undoStack : redoStack;
      if (!source.length) return false;
      const entry = source.pop();
      const target = direction === "undo" ? entry.before : entry.after;
      try {
        await persistence.save(target);
      } catch (error) {
        source.push(entry);
        throw error;
      }
      state = clone(target);
      (direction === "undo" ? redoStack : undoStack).push(entry);
      for (const listener of listeners) listener();
      return true;
    });
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
  const headings = Array.isArray(source.headings) ? source.headings : [];
  return {
    tasks: tasks.map((task, index) => normalizeTask(task, index)),
    projects: projects.map((project, index) => normalizeProject(project, index)),
    areas: areas.map((area, index) => normalizeArea(area, index)),
    headings: headings.map((heading, index) => normalizeHeading(heading, index)),
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

function normalizeHeading(raw, index) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(source.id || createId("heading")),
    title: String(source.title ?? ""),
    projectId: source.projectId == null || source.projectId === "" ? null : String(source.projectId),
    pos: String(source.pos || `a${index.toString(36)}`),
    tombstone: Boolean(source.tombstone),
  };
}

function normalizeChecklist(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeChecklistItem).sort(comparePos);
}

function normalizeChecklistItem(raw, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  return {
    id: String(source.id || createId("check")),
    title: String(source.title ?? ""),
    done: Boolean(source.done),
    pos: String(source.pos || `a${index.toString(36)}`),
  };
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
    const value = positionNumber(record.pos);
    if (value != null) max = Math.max(max, value);
  }
  const next = max + 1;
  return `a${Number.isInteger(next) ? next.toString(36) : formatPosition(next)}`;
}

/** Return a position strictly between its neighbors without renumbering them. */
export function fractionalPosition(previous, next, siblings = []) {
  const left = positionNumber(previous);
  const right = positionNumber(next);
  if (left != null && right != null && right > left) return `a${formatPosition((left + right) / 2)}`;
  if (left != null) return `a${formatPosition(left + 1)}`;
  if (right != null) return `a${formatPosition(right - 1)}`;
  return nextPos(siblings);
}

function positionNumber(value) {
  if (value == null) return null;
  const text = String(value);
  const decimal = /^a(-?\d+(?:\.\d+)?)$/i.exec(text);
  if (decimal) return Number(decimal[1]);
  const base36 = /^a([0-9a-z]+)$/i.exec(text);
  return base36 ? parseInt(base36[1], 36) : null;
}

function formatPosition(value) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(12)));
}

function nullableId(value) {
  return value == null || value === "" ? null : String(value);
}

function sameState(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
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
