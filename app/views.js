import { todayStr } from "./store.js";

const sidebar = document.getElementById("sidebar");
const main = document.getElementById("main");
export function mount(store) {
  let view = { list: "inbox", projectId: null, areaId: null, tag: null };
  let selectedId = null;
  let disposed = false;

  const unsubscribe = store.subscribe(render);
  render();

  document.addEventListener("keydown", onKeydown);
  return () => {
    disposed = true;
    unsubscribe();
    document.removeEventListener("keydown", onKeydown);
  };

  function render() {
    if (disposed) return;
    renderSidebar();
    renderMain();
  }

  function run(command) {
    Promise.resolve(command).catch(error => console.error("Things Web command failed", error));
  }

  function setView(next) {
    view = { projectId: null, areaId: null, tag: null, ...next };
    selectedId = null;
    render();
  }

  function renderSidebar() {
    sidebar.replaceChildren();
    const isActive = (list, id) => view.list === list && view.projectId === (id ?? null) && !view.tag;

    sidebar.append(
      sidebarItem({ icon: "📥", label: "Inbox", count: store.tasksForList("inbox").length, active: isActive("inbox"), onclick: () => setView({ list: "inbox" }) }),
      sidebarItem({ icon: "⭐", label: "Today", count: store.tasksForList("today").length, active: isActive("today"), onclick: () => setView({ list: "today" }) }),
      sidebarItem({ icon: "🗓", label: "Upcoming", count: store.tasksForList("upcoming").length, active: isActive("upcoming"), onclick: () => setView({ list: "upcoming" }) }),
      sidebarItem({ icon: "🌤", label: "Anytime", active: isActive("anytime"), onclick: () => setView({ list: "anytime" }) }),
      sidebarItem({ icon: "📦", label: "Someday", count: store.tasksForList("someday").length, active: isActive("someday"), onclick: () => setView({ list: "someday" }) }),
      sidebarItem({ icon: "📖", label: "Logbook", count: store.tasksForList("logbook").length, active: isActive("logbook"), onclick: () => setView({ list: "logbook" }) }),
    );

    const projects = store.projects();
    const looseProjects = projects.filter(project => !project.areaId && !project.done);
    if (looseProjects.length) {
      sidebar.append(sectionLabel("Projects"));
      looseProjects.forEach(project => sidebar.append(projectItem(project)));
    }

    store.areas().forEach(area => {
      sidebar.append(sectionLabel(area.title || "Area"));
      projects.filter(project => project.areaId === area.id && !project.done)
        .forEach(project => sidebar.append(projectItem(project)));
      sidebar.append(sidebarItem({
        icon: "▸",
        label: "Show Area",
        active: view.areaId === area.id,
        onclick: () => setView({ list: "area", areaId: area.id }),
      }));
    });

    const tags = store.allTags();
    if (tags.length) {
      sidebar.append(sectionLabel("Tags"));
      tags.forEach(tag => sidebar.append(sidebarItem({
        icon: "#",
        label: tag,
        active: view.tag === tag,
        onclick: () => setView({ list: "tag", tag }),
      })));
    }

    const actions = document.createElement("div");
    actions.className = "sidebar-actions";
    actions.append(
      sidebarItem({ icon: "＋", label: "New Project", onclick: addProject }),
      sidebarItem({ icon: "＋", label: "New Area", onclick: addArea }),
    );
    sidebar.append(actions);

    function projectItem(project) {
      const open = store.tasksForProject(project.id, { includeDone: false }).length;
      return sidebarItem({
        icon: "◻",
        label: project.title,
        count: open || null,
        active: view.projectId === project.id,
        onclick: () => setView({ list: "project", projectId: project.id }),
      });
    }
  }

  function sidebarItem({ icon, label, count, active = false, onclick, cls = "" }) {
    const button = document.createElement("button");
    button.className = `list-item${active ? " active" : ""}${cls ? ` ${cls}` : ""}`;
    button.append(element("span", "icon", icon), element("span", "", label));
    if (count) button.append(element("span", "count", count));
    button.onclick = onclick;
    return button;
  }

  function sectionLabel(text) {
    return element("div", "section-label area-header", text);
  }

  function renderMain() {
    main.replaceChildren();
    const header = element("div", "", "");
    header.id = "main-header";
    main.append(header);

    if (view.list === "project") {
      const project = store.projectById(view.projectId);
      if (!project) return setView({ list: "today" });
      header.append(element("h1", "", project.title));
      renderProjectBody(project);
      return;
    }

    if (view.list === "area") {
      const area = store.areaById(view.areaId);
      if (!area) return setView({ list: "today" });
      header.append(element("h1", "", area.title));
      store.projects().filter(project => project.areaId === area.id && !project.done).forEach(renderProjectBlock);
      addTaskRow({});
      header.append(trashButton(() => {
        if (confirm(`Delete area "${area.title}"? Its projects become loose.`)) {
          run(store.deleteArea(area.id).then(() => setView({ list: "today" })));
        }
      }));
      return;
    }

    if (view.list === "tag") {
      header.append(element("h1", "", `#${view.tag}`));
      store.tasksForTag(view.tag).forEach(task => main.append(taskElement(task)));
      if (!store.tasksForTag(view.tag).length) emptyState("Nothing tagged here.");
      return;
    }

    if (view.list === "logbook") {
      const tasks = store.tasksForList("logbook");
      header.append(element("h1", "", "Logbook"), element("span", "subtitle", `${tasks.length} completed`));
      tasks.forEach(task => main.append(taskElement(task)));
      if (!tasks.length) emptyState("Completed to-dos will appear here.");
      return;
    }

    if (view.list === "upcoming") {
      const tasks = store.tasksForList("upcoming");
      header.append(element("h1", "", "Upcoming"));
      const byDate = groupBy(tasks, task => task.when);
      Object.keys(byDate).sort().forEach(date => {
        main.append(element("div", "project-title", formatDate(date)));
        byDate[date].forEach(task => main.append(taskElement(task)));
      });
      if (!tasks.length) emptyState("Nothing scheduled. Plan ahead!");
      return;
    }

    const titles = { inbox: "Inbox", today: "Today", anytime: "Anytime", someday: "Someday" };
    const tasks = store.tasksForList(view.list);
    header.append(element("h1", "", titles[view.list] || "Things"));

    if (view.list === "today") {
      header.append(element("span", "subtitle", formatDate(todayStr())));
      const day = tasks.filter(task => !task.evening);
      const evening = tasks.filter(task => task.evening);
      day.forEach(task => main.append(taskElement(task)));
      if (evening.length) {
        main.append(element("div", "project-title", "This Evening 🌙"));
        evening.forEach(task => main.append(taskElement(task)));
      }
      if (!tasks.length) emptyState("All clear for today. Enjoy! ✨");
      return;
    }

    const loose = tasks.filter(task => !task.projectId);
    loose.forEach(task => main.append(taskElement(task)));
    const groups = groupBy(tasks.filter(task => task.projectId), task => task.projectId);
    Object.values(groups).forEach(group => {
      const project = store.projectById(group[0].projectId);
      main.append(element("div", "project-title", project?.title || ""));
      group.forEach(task => main.append(taskElement(task)));
    });
    if (view.list !== "anytime") addTaskRow({});
    if (!tasks.length && view.list === "anytime") emptyState("Nothing here. Nice.");
  }

  function renderProjectBody(project) {
    const open = store.tasksForProject(project.id, { includeDone: false });
    const done = store.tasksForProject(project.id).filter(task => task.done);
    open.forEach(task => main.append(taskElement(task)));
    addTaskRow({ projectId: project.id });
    if (done.length) {
      const heading = element("div", "project-title", "");
      heading.append(element("span", "", "Completed"), element("span", "progress", done.length));
      main.append(heading);
      done.forEach(task => main.append(taskElement(task)));
    }

    const actions = element("div", "project-actions", "");
    const complete = element("button", "pill-btn", project.done ? "✓ Reopen project" : "✓ Complete project");
    complete.onclick = () => run(store.completeProject(project.id, !project.done));
    const remove = element("button", "pill-btn", "🗑 Delete project");
    remove.onclick = () => {
      if (confirm(`Delete project "${project.title}" and its to-dos?`)) run(store.deleteProject(project.id).then(() => setView({ list: "today" })));
    };
    actions.append(complete, remove);
    main.append(actions);
  }

  function renderProjectBlock(project) {
    const block = element("div", "project-block", "");
    const open = store.tasksForProject(project.id, { includeDone: false });
    const done = store.tasksForProject(project.id).filter(task => task.done).length;
    const heading = element("div", "project-title is-clickable", "");
    heading.append(element("span", "", project.title), element("span", "progress", `${open.length} open · ${done} done`));
    heading.onclick = () => setView({ list: "project", projectId: project.id });
    block.append(heading);
    open.forEach(task => block.append(taskElement(task)));
    main.append(block);
  }

  function taskElement(task) {
    const row = element("div", `task${task.done ? " done" : ""}${task.id === selectedId ? " selected" : ""}`, "");
    const checkbox = element("button", "checkbox", "");
    checkbox.type = "button";
    checkbox.setAttribute("aria-label", task.done ? `Reopen ${task.title}` : `Complete ${task.title}`);
    checkbox.onclick = event => {
      event.stopPropagation();
      run(store.completeTask(task.id, !task.done));
    };

    const body = element("div", "task-body", "");
    const title = element("div", "task-title", task.title);
    title.contentEditable = "true";
    title.spellcheck = false;
    title.onclick = event => event.stopPropagation();
    title.onblur = () => {
      const next = title.textContent.trim();
      if (next && next !== task.title) run(store.updateTask(task.id, { title: next }));
      else title.textContent = task.title;
    };
    title.onkeydown = event => {
      if (event.key === "Enter") {
        event.preventDefault();
        title.blur();
      }
    };
    body.append(title);

    if (task.notes) body.append(element("div", "task-notes", task.notes));
    const meta = element("div", "task-meta", "");
    if (task.when && task.when !== "inbox" && task.when !== "someday") {
      meta.append(element("span", `when-pill${task.when < todayStr() && !task.done ? " overdue" : ""}`, formatDate(task.when)));
    }
    if (task.when === "someday") meta.append(pill("Someday"));
    task.tags.forEach(tag => meta.append(pill(`#${tag}`)));
    if (task.deadline) {
      const deadline = pill(`⚑ ${formatDate(task.deadline)}`);
      deadline.classList.add("deadline-pill");
      meta.append(deadline);
    }
    const project = store.projectById(task.projectId);
    if (project && view.list !== "project") meta.append(pill(`◻ ${project.title}`));
    if (meta.children.length) body.append(meta);

    const star = element("button", `star${task.when === todayStr() && !task.done ? " on" : ""}`, "★");
    star.type = "button";
    star.title = task.when === todayStr() ? "Move to Inbox" : "Move to Today";
    star.setAttribute("aria-label", star.title);
    star.onclick = event => {
      event.stopPropagation();
      run(store.toggleToday(task.id));
    };

    row.append(checkbox, body, star);
    row.onclick = () => {
      if (selectedId === task.id) return;
      selectedId = task.id;
      render();
      main.querySelector(".task.selected + .details textarea")?.focus();
    };

    if (task.id !== selectedId) return row;
    const wrapper = element("div", "task-wrapper", "");
    wrapper.append(row, detailsElement(task));
    return wrapper;
  }

  function detailsElement(task) {
    const details = element("div", "details", "");
    const notes = document.createElement("textarea");
    notes.placeholder = "Notes";
    notes.value = task.notes;
    notes.onblur = () => run(store.updateTask(task.id, { notes: notes.value.trim() }));

    const whenRow = row("When");
    [["Inbox", "inbox"], ["Today", todayStr()], ["This Evening", "evening"], ["Someday", "someday"]].forEach(([label, value]) => {
      const button = element("button", `pill-btn${isWhen(value) ? " on" : ""}`, label);
      button.type = "button";
      button.onclick = () => {
        if (value === "evening") run(store.updateTask(task.id, { when: todayStr(), evening: true }));
        else run(store.updateTask(task.id, { when: value, evening: false }));
      };
      whenRow.append(button);
    });
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = /^\d{4}-\d{2}-\d{2}$/.test(task.when) ? task.when : "";
    dateInput.onchange = () => {
      if (dateInput.value) run(store.updateTask(task.id, { when: dateInput.value, evening: false }));
    };
    whenRow.append(dateInput);

    const deadlineRow = row("Deadline");
    const deadline = document.createElement("input");
    deadline.type = "date";
    deadline.value = task.deadline || "";
    deadline.onchange = () => run(store.updateTask(task.id, { deadline: deadline.value || null }));
    deadlineRow.append(deadline);

    const tagRow = row("Tags");
    const tagInput = document.createElement("input");
    tagInput.type = "text";
    tagInput.placeholder = "comma, separated";
    tagInput.value = task.tags.join(", ");
    tagInput.onblur = () => run(store.updateTask(task.id, { tags: tagInput.value.split(",").map(tag => tag.trim()).filter(Boolean) }));
    tagInput.onkeydown = event => {
      if (event.key === "Enter") tagInput.blur();
    };
    tagRow.append(tagInput);

    const projectRow = row("Project");
    const projectSelect = document.createElement("select");
    projectSelect.append(new Option("— none —", ""));
    store.projects().filter(project => !project.done).forEach(project => {
      const option = new Option(project.title, project.id);
      option.selected = project.id === task.projectId;
      projectSelect.append(option);
    });
    projectSelect.onchange = () => run(store.updateTask(task.id, { projectId: projectSelect.value || null }));
    projectRow.append(projectSelect);

    const deleteRow = row("");
    const remove = element("button", "pill-btn", "🗑 Delete to-do");
    remove.type = "button";
    remove.onclick = () => run(store.deleteTask(task.id).then(() => {
      selectedId = null;
      render();
    }));
    deleteRow.append(remove);

    details.append(notes, whenRow, deadlineRow, tagRow, projectRow, deleteRow);
    return details;

    function row(label) {
      const result = element("div", "row", "");
      result.append(element("label", "", label));
      return result;
    }

    function isWhen(value) {
      if (value === "evening") return task.evening;
      if (value === todayStr()) return task.when === todayStr() && !task.evening;
      return task.when === value;
    }
  }

  function addTaskRow(defaults) {
    const wrapper = element("div", "new-task-row", "");
    const input = document.createElement("input");
    input.className = "new-task-input";
    input.placeholder = "＋ New To-Do";
    input.setAttribute("aria-label", "New To-Do");
    input.onkeydown = event => {
      if (event.key === "Enter" && input.value.trim()) {
        const when = view.list === "someday" ? "someday" : view.list === "today" ? todayStr() : "inbox";
        const title = input.value.trim();
        run(store.addTask({ title, when, projectId: defaults.projectId ?? null }).then(() => {
          render();
          const rows = main.querySelectorAll(".new-task-input");
          rows[rows.length - 1]?.focus();
        }));
      }
      if (event.key === "Escape") input.blur();
    };
    wrapper.append(input);
    main.append(wrapper);
  }

  function addProject() {
    const title = prompt("Project name:");
    if (title?.trim()) run(store.addProject(title));
  }

  function addArea() {
    const title = prompt("Area name:");
    if (title?.trim()) run(store.addArea(title));
  }

  function emptyState(message) {
    main.append(element("div", "empty-state", message));
  }

  function trashButton(onclick) {
    const button = element("button", "trash-button", "🗑");
    button.type = "button";
    button.title = "Delete";
    button.onclick = onclick;
    return button;
  }

  function pill(text) {
    return element("span", "tag-pill", text);
  }

  function onKeydown(event) {
    if (event.target.matches("input, textarea, [contenteditable], select")) return;
    if (event.key === " " || event.key.toLowerCase() === "n") {
      event.preventDefault();
      main.querySelector(".new-task-input")?.focus();
    }
    if (event.key === "Escape") {
      selectedId = null;
      render();
    }
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const group = key(item);
    (groups[group] ||= []).push(item);
    return groups;
  }, {});
}

function formatDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const today = todayStr();
  if (value === today) return "Today";
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (value === todayStr(tomorrow)) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    weekday: Math.abs(date - new Date()) < 6.5 * 864e5 ? "short" : undefined,
  });
}
