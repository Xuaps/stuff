import { todayStr } from "./store.js";
import { parseCapture } from "./parse.js";

// Natural-language parsing is optional; the local app never fetches a CDN at startup.
const chrono = null;
const sidebar = document.getElementById("sidebar");
const main = document.getElementById("main");
export function mount(store, { syncPanel: makeSyncPanel } = {}) {
  let view = { list: "inbox", projectId: null, areaId: null, tag: null };
  let selectedId = null;
  let selectedIds = new Set();
  let selectionAnchor = null;
  let dragState = null;
  let disposed = false;
  let palette = null;
  let shortcuts = null;

  const unsubscribe = store.subscribe(render);
  render();

  document.addEventListener("keydown", onKeydown);
  return () => {
    disposed = true;
    closeQuickEntry();
    closeShortcuts();
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
    clearSelection();
    render();
  }

  function clearSelection() {
    selectedId = null;
    selectedIds = new Set();
    selectionAnchor = null;
  }

  function dropHandlers(drop) {
    return {
      ondragover: event => {
        event.preventDefault();
        event.currentTarget.classList.add("drop-target");
      },
      ondragleave: event => event.currentTarget.classList.remove("drop-target"),
      ondrop: event => {
        event.preventDefault();
        event.currentTarget.classList.remove("drop-target");
        drop(dragState?.ids || []);
        dragState = null;
      },
    };
  }

  function dropTasks(ids, action) {
    const taskIds = ids.length ? ids : selectedIds.size ? [...selectedIds] : [];
    clearSelection();
    taskIds.forEach(id => run(action(id)));
  }

  function renderSidebar() {
    sidebar.replaceChildren();
    const isActive = (list, id) => view.list === list && view.projectId === (id ?? null) && !view.tag;

    sidebar.append(
      sidebarItem({ icon: "📥", label: "Inbox", count: store.tasksForList("inbox").length, active: isActive("inbox"), onclick: () => setView({ list: "inbox" }) }),
      sidebarItem({ icon: "⭐", label: "Today", count: store.tasksForList("today").length, active: isActive("today"), onclick: () => setView({ list: "today" }), ...dropHandlers(ids => dropTasks(ids, id => store.updateTask(id, { when: todayStr(), evening: false }))) }),
      sidebarItem({ icon: "🗓", label: "Upcoming", count: store.tasksForList("upcoming").length, active: isActive("upcoming"), onclick: () => setView({ list: "upcoming" }) }),
      sidebarItem({ icon: "🌤", label: "Anytime", count: store.tasksForList("anytime").length, active: isActive("anytime"), onclick: () => setView({ list: "anytime" }) }),
      sidebarItem({ icon: "📦", label: "Someday", count: store.tasksForList("someday").length, active: isActive("someday"), onclick: () => setView({ list: "someday" }), ...dropHandlers(ids => dropTasks(ids, id => store.updateTask(id, { when: "someday", evening: false }))) }),
      sidebarItem({ icon: "📖", label: "Logbook", count: store.tasksForList("logbook").length, active: isActive("logbook"), onclick: () => setView({ list: "logbook" }) }),
    );

    const projects = store.projects();
    const looseProjects = projects.filter(project => !project.areaId && !project.done);
    if (looseProjects.length) {
      sidebar.append(sectionLabel("Projects"));
      looseProjects.forEach(project => sidebar.append(projectItem(project)));
    }

    store.areas().forEach(area => {
      const areaProjects = projects.filter(project => project.areaId === area.id);
      const open = areaProjects.reduce((total, project) => total + store.tasksForProject(project.id, { includeDone: false }).length, 0);
      sidebar.append(areaHeader(area, open));
      areaProjects.filter(project => !project.done)
        .forEach(project => sidebar.append(projectItem(project)));
      sidebar.append(sidebarItem({
        icon: "▸",
        label: "Show Area",
        count: open,
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
    if (makeSyncPanel) {
      const syncButton = sidebarItem({ icon: "⇄", label: "Sync", onclick: async () => {
        const panel = await makeSyncPanel();
        const overlay = element("div", "modal-overlay", "");
        overlay.append(panel);
        overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };
        document.body.append(overlay);
      }});
      sidebar.append(syncButton);
    }

    function projectItem(project) {
      const open = store.tasksForProject(project.id, { includeDone: false }).length;
      const wrapper = element("div", "sidebar-entity", "");
      wrapper.append(sidebarItem({
        icon: "◻",
        label: project.title,
        count: open,
        active: view.projectId === project.id,
        onclick: () => setView({ list: "project", projectId: project.id }),
        ...dropHandlers(ids => dropTasks(ids, id => store.assignTaskToProject(id, project.id))),
      }));
      const actions = element("span", "sidebar-entity-actions", "");
      actions.append(
        sidebarAction("Rename project", () => renameProject(project)),
        sidebarAction("Delete project", () => deleteProject(project)),
      );
      wrapper.append(actions);
      return wrapper;
    }

    function areaHeader(area, open) {
      const header = element("div", "section-label area-header", "");
      const title = element("button", "area-title", area.title || "Area");
      title.type = "button";
      title.title = "Show area";
      title.onclick = () => setView({ list: "area", areaId: area.id });
      header.append(title, element("span", "count", open));
      const actions = element("span", "sidebar-entity-actions", "");
      actions.append(
        sidebarAction("Rename area", () => renameArea(area)),
        sidebarAction("Delete area", () => deleteArea(area)),
      );
      header.append(actions);
      return header;
    }
  }

  function sidebarItem({ icon, label, count, active = false, onclick, cls = "", ondragover, ondragleave, ondrop }) {
    const button = document.createElement("button");
    button.className = `list-item${active ? " active" : ""}${cls ? ` ${cls}` : ""}`;
    button.append(element("span", "icon", icon), element("span", "", label));
    if (count != null) button.append(element("span", "count", count));
    button.onclick = onclick;
    if (ondragover) button.ondragover = ondragover;
    if (ondragleave) button.ondragleave = ondragleave;
    if (ondrop) button.ondrop = ondrop;
    return button;
  }

  function sidebarAction(label, onclick) {
    const button = element("button", "sidebar-action", label === "Delete project" || label === "Delete area" ? "×" : "✎");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.onclick = event => {
      event.stopPropagation();
      onclick();
    };
    return button;
  }

  function headingAction(label, onclick) {
    const button = element("button", "heading-action", label === "Delete heading" ? "×" : "✎");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.onclick = event => {
      event.stopPropagation();
      onclick();
    };
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
    const bulkActions = renderBulkActions();
    if (bulkActions) main.append(bulkActions);

    if (view.list === "project") {
      const project = store.projectById(view.projectId);
      if (!project) return setView({ list: "today" });
      const progress = store.projectProgress(project.id);
      header.append(editableHeading(project.title, title => store.updateProject(project.id, { title })));
      header.append(element("span", "subtitle", `${progress.open} open · ${progress.done} done`));
      renderProjectBody(project, progress);
      return;
    }

    if (view.list === "area") {
      const area = store.areaById(view.areaId);
      if (!area) return setView({ list: "today" });
      header.append(editableHeading(area.title, title => store.updateArea(area.id, { title })));
      header.append(element("span", "subtitle", `${store.tasksForArea(area.id, { includeDone: false }).length} open`));
      const projects = store.projectsForArea(area.id);
      projects.forEach(renderProjectBlock);
      if (!projects.length) emptyState("Projects in this area will appear here.");
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
    if (!tasks.length) {
      const messages = {
        inbox: "Inbox is empty. Capture what's on your mind.",
        anytime: "Nothing here. Nice.",
        someday: "Nothing waiting for someday.",
      };
      emptyState(messages[view.list] || "Nothing here. Nice.");
    }
  }

  function renderProjectBody(project, progress) {
    const tasks = store.tasksForProject(project.id);
    const open = tasks.filter(task => !task.done);
    const done = tasks.filter(task => task.done);
    const headings = store.headingsForProject(project.id);

    if (!tasks.length) emptyState("No to-dos yet. Start with one!");
    open.filter(task => !task.headingId).forEach(task => main.append(taskElement(task)));
    addTaskRow({ projectId: project.id, headingId: null });
    headings.forEach(heading => renderHeadingSection(heading, open));

    if (done.length) {
      const completed = element("div", "project-title", "");
      completed.append(element("span", "", "Completed"), element("span", "progress", `${progress.done} done`));
      main.append(completed);
      done.filter(task => !task.headingId).forEach(task => main.append(taskElement(task)));
      headings.forEach(heading => {
        const headingDone = done.filter(task => task.headingId === heading.id);
        if (!headingDone.length) return;
        const doneHeading = element("div", "heading-title completed-heading", "");
        doneHeading.append(element("span", "", heading.title), element("span", "progress", "completed"));
        main.append(doneHeading);
        headingDone.forEach(task => main.append(taskElement(task)));
      });
    }

    const actions = element("div", "project-actions", "");
    const areaLabel = element("label", "project-area-label", "Area");
    const areaSelect = document.createElement("select");
    areaSelect.className = "project-area-select";
    areaSelect.append(new Option("— none —", ""));
    store.areas().forEach(area => {
      const option = new Option(area.title, area.id);
      option.selected = area.id === project.areaId;
      areaSelect.append(option);
    });
    areaSelect.onchange = () => run(store.assignProjectToArea(project.id, areaSelect.value || null));
    actions.append(areaLabel, areaSelect);

    const addHeadingButton = element("button", "pill-btn", "＋ New Heading");
    addHeadingButton.type = "button";
    addHeadingButton.onclick = () => addHeading(project);
    actions.append(addHeadingButton);

    const complete = element("button", "pill-btn", project.done ? "✓ Reopen project" : "✓ Complete project");
    complete.onclick = () => run(store.completeProject(project.id, !project.done));
    const remove = element("button", "pill-btn", "🗑 Delete project");
    remove.onclick = () => {
      if (confirm(`Delete project "${project.title}" and its to-dos?`)) run(store.deleteProject(project.id).then(() => setView({ list: "today" })));
    };
    actions.append(complete, remove);
    main.append(actions);
  }

  function renderHeadingSection(heading, open) {
    const block = element("div", "heading-block", "");
    const title = element("div", "heading-title", "");
    title.append(element("span", "", heading.title));
    const actions = element("span", "heading-actions", "");
    actions.append(
      headingAction("Rename heading", () => renameHeading(heading)),
      headingAction("Delete heading", () => deleteHeading(heading)),
    );
    title.append(actions);
    block.append(title);
    open.filter(task => task.headingId === heading.id).forEach(task => block.append(taskElement(task)));
    addTaskRow({ projectId: heading.projectId, headingId: heading.id }, block);
    main.append(block);
  }

  function renderProjectBlock(project) {
    const block = element("div", `project-block${project.done ? " done-project" : ""}`, "");
    const progress = store.projectProgress(project.id);
    const open = store.tasksForProject(project.id, { includeDone: false });
    const heading = element("div", "project-title is-clickable", "");
    heading.append(element("span", "", project.title), element("span", "progress", `${progress.open} open · ${progress.done} done`));
    heading.onclick = () => setView({ list: "project", projectId: project.id });
    block.append(heading);
    open.forEach(task => block.append(taskElement(task)));
    main.append(block);
  }

  function renderBulkActions() {
    if (selectedIds.size < 2) return null;
    const bar = element("div", "bulk-actions", `${selectedIds.size} selected`);
    const complete = element("button", "pill-btn", "✓ Complete");
    complete.type = "button";
    complete.onclick = () => {
      const ids = [...selectedIds];
      ids.forEach(id => run(store.completeTask(id)));
      clearSelection();
    };
    const today = element("button", "pill-btn", "⭐ Today");
    today.type = "button";
    today.onclick = () => {
      const ids = [...selectedIds];
      ids.forEach(id => run(store.updateTask(id, { when: todayStr(), evening: false })));
      clearSelection();
    };
    const remove = element("button", "pill-btn", "🗑 Delete");
    remove.type = "button";
    remove.onclick = () => {
      const ids = [...selectedIds];
      ids.forEach(id => run(store.deleteTask(id)));
      clearSelection();
    };
    bar.append(complete, today, remove);
    return bar;
  }

  function visibleTaskIds() {
    if (view.list === "project") {
      const tasks = store.tasksForProject(view.projectId);
      const open = tasks.filter(task => !task.done);
      const headings = store.headingsForProject(view.projectId);
      return [
        ...open.filter(task => !task.headingId),
        ...headings.flatMap(heading => open.filter(task => task.headingId === heading.id)),
        ...tasks.filter(task => task.done && !task.headingId),
        ...headings.flatMap(heading => tasks.filter(task => task.done && task.headingId === heading.id)),
      ].map(task => task.id);
    }
    if (view.list === "area") {
      return store.projectsForArea(view.areaId).flatMap(project =>
        store.tasksForProject(project.id, { includeDone: false }).map(task => task.id));
    }
    if (view.list === "tag") return store.tasksForTag(view.tag).map(task => task.id);
    const tasks = store.tasksForList(view.list);
    if (["inbox", "anytime", "someday"].includes(view.list)) {
      const loose = tasks.filter(task => !task.projectId);
      const groups = groupBy(tasks.filter(task => task.projectId), task => task.projectId);
      return [...loose, ...Object.values(groups).flat()].map(task => task.id);
    }
    return tasks.map(task => task.id);
  }

  function taskElement(task) {
    const row = element("div", `task${task.done ? " done" : ""}${selectedIds.has(task.id) ? " selected" : ""}`, "");
    row.dataset.taskId = task.id;
    row.draggable = true;
    row.ondragstart = event => {
      const ids = selectedIds.has(task.id) ? [...selectedIds] : [task.id];
      dragState = { ids };
      event.dataTransfer?.setData("text/plain", task.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };
    row.ondragend = () => {
      dragState = null;
      main.querySelectorAll(".drag-over").forEach(node => node.classList.remove("drag-over"));
    };
    row.ondragover = event => {
      event.preventDefault();
      if (dragState?.ids.includes(task.id)) return;
      main.querySelectorAll(".drag-over").forEach(node => node.classList.remove("drag-over"));
      row.classList.add("drag-over");
    };
    row.ondragleave = () => row.classList.remove("drag-over");
    row.ondrop = event => {
      event.preventDefault();
      row.classList.remove("drag-over");
      const ids = dragState?.ids || [event.dataTransfer?.getData("text/plain")];
      const dragged = ids.filter(Boolean);
      dragged.forEach(id => {
        if (id !== task.id) run(store.reorderTask(id, { beforeId: task.id }));
      });
      dragState = null;
    };
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
    title.onclick = event => {
      if (!(event.shiftKey || event.metaKey || event.ctrlKey)) event.stopPropagation();
    };
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
    if (task.checklist.length) {
      const completedItems = task.checklist.filter(item => item.done).length;
      meta.append(element("span", "checklist-progress", `✓ ${completedItems}/${task.checklist.length}`));
    }
    if (task.deadline) {
      const deadline = pill(`⚑ ${formatDate(task.deadline)}`);
      deadline.classList.add("deadline-pill");
      const tone = deadlineTone(task.deadline);
      if (tone) deadline.classList.add(tone);
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
    row.onclick = event => {
      if (event.target.closest("button, input, textarea, select, [contenteditable]") && !(event.shiftKey || event.metaKey || event.ctrlKey)) return;
      const sequence = visibleTaskIds();
      if (event.shiftKey && selectionAnchor) {
        const start = sequence.indexOf(selectionAnchor);
        const end = sequence.indexOf(task.id);
        if (start >= 0 && end >= 0) {
          const range = sequence.slice(Math.min(start, end), Math.max(start, end) + 1);
          selectedIds = new Set(range);
        }
      } else if (event.metaKey || event.ctrlKey) {
        if (selectedIds.has(task.id)) selectedIds.delete(task.id);
        else selectedIds.add(task.id);
        selectionAnchor = task.id;
      } else {
        selectedIds = new Set([task.id]);
        selectionAnchor = task.id;
      }
      selectedId = selectedIds.size === 1 ? task.id : null;
      render();
      if (selectedId) main.querySelector(".task.selected + .details textarea")?.focus();
    };

    if (task.id !== selectedId || selectedIds.size !== 1) return row;
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
    store.projects().filter(project => !project.done || project.id === task.projectId).forEach(project => {
      const option = new Option(project.title, project.id);
      option.selected = project.id === task.projectId;
      projectSelect.append(option);
    });
    projectSelect.onchange = () => run(store.assignTaskToProject(task.id, projectSelect.value || null));
    projectRow.append(projectSelect);

    let headingRow = null;
    if (task.projectId) {
      headingRow = row("Heading");
      const headingSelect = document.createElement("select");
      headingSelect.append(new Option("— none —", ""));
      store.headingsForProject(task.projectId).forEach(heading => {
        const option = new Option(heading.title, heading.id);
        option.selected = heading.id === task.headingId;
        headingSelect.append(option);
      });
      headingSelect.onchange = () => run(store.assignTaskToHeading(task.id, headingSelect.value || null));
      headingRow.append(headingSelect);
    }

    const checklist = checklistElement(task);

    const deleteRow = row("");
    const remove = element("button", "pill-btn", "🗑 Delete to-do");
    remove.type = "button";
    remove.onclick = () => run(store.deleteTask(task.id).then(() => {
      clearSelection();
      render();
    }));
    deleteRow.append(remove);

    details.append(notes, whenRow, deadlineRow, tagRow, projectRow);
    if (headingRow) details.append(headingRow);
    details.append(checklist, deleteRow);
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

  function checklistElement(task) {
    const checklist = element("div", "checklist", "");
    checklist.append(element("div", "checklist-label", "Checklist"));
    task.checklist.forEach(item => {
      const itemRow = element("div", "checklist-item", "");
      const checkbox = element("button", `checklist-checkbox${item.done ? " done" : ""}`, item.done ? "✓" : "");
      checkbox.type = "button";
      checkbox.setAttribute("aria-label", item.done ? `Uncheck ${item.title}` : `Check ${item.title}`);
      checkbox.onclick = () => run(store.toggleChecklistItem(task.id, item.id));
      const title = document.createElement("input");
      title.type = "text";
      title.className = "checklist-input";
      title.value = item.title;
      title.setAttribute("aria-label", "Checklist item");
      title.onblur = () => {
        const next = title.value.trim();
        if (next && next !== item.title) run(store.updateChecklistItem(task.id, item.id, { title: next }));
        else title.value = item.title;
      };
      title.onkeydown = event => {
        if (event.key === "Enter") title.blur();
      };
      const remove = element("button", "checklist-remove", "×");
      remove.type = "button";
      remove.title = "Remove checklist item";
      remove.setAttribute("aria-label", remove.title);
      remove.onclick = () => run(store.removeChecklistItem(task.id, item.id));
      itemRow.append(checkbox, title, remove);
      checklist.append(itemRow);
    });
    const add = document.createElement("input");
    add.type = "text";
    add.className = "checklist-add";
    add.placeholder = "＋ Add checklist item";
    add.setAttribute("aria-label", "Add checklist item");
    add.onkeydown = event => {
      if (event.key === "Enter" && add.value.trim()) {
        const title = add.value.trim();
        add.value = "";
        run(store.addChecklistItem(task.id, title));
      }
      if (event.key === "Escape") add.blur();
    };
    checklist.append(add);
    return checklist;
  }

  function addTaskRow(defaults, container = main) {
    const wrapper = element("div", "new-task-row", "");
    const input = document.createElement("input");
    input.className = "new-task-input";
    input.placeholder = "＋ New To-Do";
    input.setAttribute("aria-label", "New To-Do");
    input.onkeydown = event => {
      if (event.key === "Enter" && input.value.trim()) {
        const fallbackWhen = view.list === "someday" ? "someday" : view.list === "today" ? todayStr() : "inbox";
        const task = capturedTask(input.value, defaults, fallbackWhen);
        if (!task) return;
        run(store.addTask(task).then(() => {
          render();
          const rows = main.querySelectorAll(".new-task-input");
          rows[rows.length - 1]?.focus();
        }));
      }
      if (event.key === "Escape") input.blur();
    };
    wrapper.append(input);
    container.append(wrapper);
  }

  function capturedTask(raw, defaults = {}, fallbackWhen = "inbox") {
    const parsed = parseCapture(raw, { chrono });
    if (!parsed.title) return null;
    const project = parsed.projectName
      ? store.projects().find(item => item.title.toLowerCase() === parsed.projectName.toLowerCase())
      : null;
    return {
      title: parsed.title,
      when: parsed.when === "inbox" ? fallbackWhen : parsed.when,
      tags: parsed.tags,
      deadline: parsed.deadline,
      projectId: project?.id ?? defaults.projectId ?? null,
      headingId: project ? null : defaults.headingId ?? null,
    };
  }

  function openQuickEntry() {
    if (palette) {
      palette.input.focus();
      return;
    }
    closeShortcuts();
    const overlay = element("div", "modal-overlay", "");
    const dialog = element("div", "capture-palette", "");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = element("h2", "", "Quick Entry");
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "What needs doing?";
    input.setAttribute("aria-label", "Quick Entry");
    input.autocomplete = "off";
    input.onkeydown = event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeQuickEntry();
      }
      if (event.key === "Enter" && input.value.trim()) {
        const task = capturedTask(input.value, {}, "inbox");
        if (!task) return;
        closeQuickEntry();
        run(store.addTask(task).then(render));
      }
    };
    dialog.append(heading, input);
    overlay.append(dialog);
    overlay.onclick = event => {
      if (event.target === overlay) closeQuickEntry();
    };
    document.body.append(overlay);
    palette = { overlay, input };
    input.focus();
  }

  function closeQuickEntry() {
    palette?.overlay.remove();
    palette = null;
  }

  function openShortcuts() {
    if (shortcuts) return;
    closeQuickEntry();
    const overlay = element("div", "modal-overlay", "");
    const dialog = element("div", "shortcut-sheet", "");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    const heading = element("h2", "", "Keyboard Shortcuts");
    const list = element("dl", "", "");
    [["Space / N", "New to-do"], ["⌘ / Ctrl + K", "Quick Entry"], ["⌘ / Ctrl + Z", "Undo"], ["⌘ / Ctrl + Shift + Z", "Redo"], ["Shift-click", "Select a range"], ["⌘ / Ctrl-click", "Toggle selection"], ["Esc", "Close overlay or clear selection"], ["?", "Show shortcuts"]].forEach(([key, description]) => {
      list.append(element("dt", "", key), element("dd", "", description));
    });
    dialog.append(heading, list);
    overlay.append(dialog);
    overlay.onclick = event => {
      if (event.target === overlay) closeShortcuts();
    };
    document.body.append(overlay);
    shortcuts = overlay;
  }

  function closeShortcuts() {
    shortcuts?.remove();
    shortcuts = null;
  }

  function editableHeading(title, save) {
    const heading = element("h1", "editable-heading", title);
    heading.contentEditable = "true";
    heading.spellcheck = false;
    heading.onblur = () => {
      const next = heading.textContent.trim();
      if (next && next !== title) run(save(next));
      else heading.textContent = title;
    };
    heading.onkeydown = event => {
      if (event.key === "Enter") {
        event.preventDefault();
        heading.blur();
      }
    };
    return heading;
  }

  function addHeading(project) {
    const title = prompt("Heading name:");
    if (title?.trim()) run(store.addHeading({ title, projectId: project.id }));
  }

  function renameHeading(heading) {
    const title = prompt("Heading name:", heading.title);
    if (title?.trim() && title.trim() !== heading.title) run(store.updateHeading(heading.id, { title }));
  }

  function deleteHeading(heading) {
    if (!confirm(`Delete heading "${heading.title}"? Its to-dos become unheaded.`)) return;
    run(store.deleteHeading(heading.id));
  }

  function renameProject(project) {
    const title = prompt("Project name:", project.title);
    if (title?.trim() && title.trim() !== project.title) run(store.updateProject(project.id, { title }));
  }

  function deleteProject(project) {
    if (!confirm(`Delete project "${project.title}" and its to-dos?`)) return;
    run(store.deleteProject(project.id).then(() => {
      if (view.projectId === project.id) setView({ list: "today" });
    }));
  }

  function renameArea(area) {
    const title = prompt("Area name:", area.title);
    if (title?.trim() && title.trim() !== area.title) run(store.updateArea(area.id, { title }));
  }

  function deleteArea(area) {
    if (!confirm(`Delete area "${area.title}"? Its projects become loose.`)) return;
    run(store.deleteArea(area.id).then(() => {
      if (view.areaId === area.id) setView({ list: "today" });
    }));
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
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      openQuickEntry();
      return;
    }
    if (event.key === "Escape" && (palette || shortcuts)) {
      event.preventDefault();
      closeQuickEntry();
      closeShortcuts();
      return;
    }
    if (event.target.matches("input, textarea, [contenteditable], select")) return;
    if (event.key === "?") {
      event.preventDefault();
      openShortcuts();
      return;
    }
    if (event.key === " " || event.key.toLowerCase() === "n") {
      event.preventDefault();
      main.querySelector(".new-task-input")?.focus();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      run(event.shiftKey ? store.redo() : store.undo());
      return;
    }
    if (event.key === "Escape") {
      clearSelection();
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

function deadlineTone(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const days = (dateNumber(value) - dateNumber(todayStr())) / 864e5;
  if (days < 0) return "overdue";
  if (days <= 2) return "near";
  return "";
}

function dateNumber(value) {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
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
