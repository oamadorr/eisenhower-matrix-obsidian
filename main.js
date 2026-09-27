"use strict";

const {
  Plugin,
  ItemView,
  PluginSettingTab,
  Setting,
  Menu,
  Modal,
  Notice,
  MarkdownRenderer,
  Component,
  Keymap,
  Platform,
  normalizePath,
  setIcon,
} = require("obsidian");

const VIEW_TYPE = "eisenhower-matrix-view";

const DEFAULT_SETTINGS = {
  dataFile: "Eisenhower Matrix.md",
  autoCompleteEliminate: true,
};

const QUADRANTS = [
  {
    id: "q1",
    cls: "q1",
    icon: "🔴", /* data file headings only */
    num: 1,
    lucide: "zap",
    axes: "Urgent · Important",
    title: "Do Now",
    subtitle: "Urgent + Important",
    tag: "do",
  },
  {
    id: "q2",
    cls: "q2",
    icon: "🔵", /* data file headings only */
    num: 2,
    lucide: "calendar",
    axes: "Not urgent · Important",
    title: "Schedule",
    subtitle: "Important + Not Urgent",
    tag: "schedule",
  },
  {
    id: "q3",
    cls: "q3",
    icon: "🟡", /* data file headings only */
    num: 3,
    lucide: "users",
    axes: "Urgent · Not important",
    title: "Delegate",
    subtitle: "Urgent + Not Important",
    tag: "delegate",
  },
  {
    id: "q4",
    cls: "q4",
    icon: "⚫", /* data file headings only */
    num: 4,
    lucide: "archive-x",
    axes: "Not urgent · Not important",
    title: "Eliminate",
    subtitle: "Not Urgent + Not Important",
    tag: "eliminate",
  },
];

/* Local calendar date (YYYY-MM-DD), offset by N days — never UTC */
function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/* Strip the common indentation of sub-item lines so they render as a list */
function dedent(lines) {
  const indents = lines
    .filter((l) => l.trim())
    .map((l) => l.match(/^[ \t]*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}

/* "→ ⚡ Do Now" destination chip, colored by quadrant */
function renderPreview(el, q) {
  el.empty();
  el.className = `eisenhower-preview preview-${q.cls}`;
  el.createSpan({ text: "→" });
  setIcon(el.createSpan({ cls: "eisenhower-icon" }), q.lucide);
  el.createSpan({ text: q.title });
}

function getQuadrant(urgent, important) {
  if (urgent && important) return "do";
  if (!urgent && important) return "schedule";
  if (urgent && !important) return "delegate";
  return "eliminate";
}

/* ── Data file model ──
 * The markdown file is the source of truth. Parsing keeps every line it does
 * not understand (frontmatter, notes, callouts, other headings) and attaches
 * indented lines to the task above them, so a write never drops user content.
 */

const QUADRANT_HEADER = /^## .*(Do Now|Schedule|Delegate|Eliminate)/i;
const OTHER_HEADER = /^#{1,2} /;
const TASK_LINE = /^- \[([ xX])\] (.+)/;
const CHILD_LINE = /^[ \t]+\S/;
const PLACEHOLDER = /^\*No tasks\*\s*$/;
const DONE_MARK = /^- \[[ xX]\]/;

class ConflictError extends Error {}

function headerTag(title) {
  const h = title.toLowerCase();
  if (h === "do now") return "do";
  if (h === "schedule") return "schedule";
  if (h === "delegate") return "delegate";
  return "eliminate";
}

function parseTaskLine(raw) {
  let text = raw;
  let date = null;
  let person = null;

  const dateMatch = raw.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    date = dateMatch[1];
    text = text.replace(/\s*📅\s*\d{4}-\d{2}-\d{2}/, "").trim();
  }

  const personMatch = raw.match(/👤\s*(.+?)(?:\s*📅|$)/);
  if (personMatch) {
    person = personMatch[1].trim();
    text = text.replace(/\s*👤\s*.+?(?=\s*📅|$)/, "").trim();
  }

  return { text, date, person };
}

function formatTaskLine(task) {
  let line = `- [${task.done ? "x" : " "}] ${task.text}`;
  if (task.person) line += ` 👤 ${task.person}`;
  if (task.date) line += ` 📅 ${task.date}`;
  return line;
}

function skeletonMarkdown() {
  const lines = ["---", "tags:", "  - eisenhower", "---", "", "# Eisenhower Matrix", ""];
  for (const q of QUADRANTS) {
    lines.push(`## ${q.icon} ${q.title}`, `*${q.subtitle}*`, "", "*No tasks*", "");
  }
  return lines.join("\n");
}

function parseDoc(content) {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const doc = { eol, preamble: [], sections: [] };
  let section = null;
  let lastTask = null;

  for (const line of content.split(/\r?\n/)) {
    const headerMatch = line.match(QUADRANT_HEADER);
    if (headerMatch) {
      section = { tag: headerTag(headerMatch[1]), header: line, items: [] };
      doc.sections.push(section);
      lastTask = null;
      continue;
    }
    if (!section) {
      doc.preamble.push(line);
      continue;
    }
    if (OTHER_HEADER.test(line)) {
      section = { tag: null, header: line, items: [] };
      doc.sections.push(section);
      lastTask = null;
      continue;
    }
    if (section.tag) {
      const taskMatch = line.match(TASK_LINE);
      if (taskMatch) {
        lastTask = {
          kind: "task",
          raw: line,
          done: taskMatch[1] !== " ",
          ...parseTaskLine(taskMatch[2].trim()),
          children: [],
        };
        section.items.push(lastTask);
        continue;
      }
      if (lastTask && CHILD_LINE.test(line)) {
        lastTask.children.push(line);
        continue;
      }
    }
    lastTask = null;
    section.items.push({ kind: "line", raw: line });
  }
  return doc;
}

function serializeDoc(doc) {
  const lines = [...doc.preamble];
  for (const section of doc.sections) {
    lines.push(section.header);
    for (const item of section.items) {
      lines.push(item.raw);
      if (item.kind === "task") lines.push(...item.children);
    }
  }
  return lines.join(doc.eol);
}

function taskRefs(doc, tag) {
  const refs = [];
  for (const section of doc.sections) {
    if (section.tag !== tag) continue;
    section.items.forEach((item) => {
      if (item.kind === "task") refs.push({ section, task: item });
    });
  }
  return refs;
}

function docToData(doc) {
  const data = { do: [], schedule: [], delegate: [], eliminate: [] };
  for (const q of QUADRANTS) {
    data[q.tag] = taskRefs(doc, q.tag).map(({ task }) => ({
      text: task.text,
      done: task.done,
      date: task.date,
      person: task.person,
      children: task.children,
    }));
  }
  return data;
}

/* Find the task the user acted on; refuse if the file changed under it */
function findTask(doc, tag, index, expectText) {
  const ref = taskRefs(doc, tag)[index];
  if (!ref || (expectText !== undefined && ref.task.text !== expectText)) {
    throw new ConflictError();
  }
  return ref;
}

function isBlank(item) {
  return item.kind === "line" && item.raw.trim() === "";
}

function sectionHasTasks(section) {
  return section.items.some((i) => i.kind === "task");
}

function dropPlaceholders(section) {
  section.items = section.items.filter(
    (i) => !(i.kind === "line" && PLACEHOLDER.test(i.raw))
  );
}

/* Where a new task goes in a section: after the last task, else in place of
 * the placeholder, else after the subtitle's blank line. */
function insertIndex(section) {
  const items = section.items;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "task") return i + 1;
  }
  const ph = items.findIndex((i) => i.kind === "line" && PLACEHOLDER.test(i.raw));
  if (ph >= 0) return ph;
  let last = -1;
  items.forEach((item, i) => {
    if (!isBlank(item)) last = i;
  });
  let pos = last + 1;
  if (items[pos] && isBlank(items[pos]) && pos + 1 < items.length) pos++;
  return pos;
}

function sectionFor(doc, tag) {
  const existing = doc.sections.filter((s) => s.tag === tag);
  if (existing.length) return existing[existing.length - 1];

  const q = QUADRANTS.find((x) => x.tag === tag);
  const prev = doc.sections.length
    ? doc.sections[doc.sections.length - 1].items
    : null;
  const lastLine = prev
    ? prev.length
      ? prev[prev.length - 1].raw
      : doc.sections[doc.sections.length - 1].header
    : doc.preamble[doc.preamble.length - 1];
  const section = {
    tag,
    header: `## ${q.icon} ${q.title}`,
    items: [{ kind: "line", raw: `*${q.subtitle}*` }, { kind: "line", raw: "" }],
  };
  if (lastLine !== undefined && lastLine.trim() !== "") {
    if (prev) prev.push({ kind: "line", raw: "" });
    else doc.preamble.push("");
  }
  section.items.push({ kind: "line", raw: "*No tasks*" }, { kind: "line", raw: "" });
  doc.sections.push(section);
  return section;
}

function insertTask(doc, tag, task, beforeTask) {
  let section;
  let at;
  if (beforeTask) {
    section = doc.sections.find((s) => s.items.includes(beforeTask));
    at = section.items.indexOf(beforeTask);
  } else {
    section = sectionFor(doc, tag);
    at = insertIndex(section);
  }
  section.items.splice(at, 0, task);
  dropPlaceholders(section);
}

function detachTask(section, task) {
  const at = section.items.indexOf(task);
  section.items.splice(at, 1);
  if (!sectionHasTasks(section) && !section.items.some((i) => PLACEHOLDER.test(i.raw))) {
    section.items.splice(at, 0, { kind: "line", raw: "*No tasks*" });
  }
}

/* Rewrite the line from its fields; a pure done-toggle only flips the mark */
function touchTask(task, onlyDone) {
  task.raw = onlyDone
    ? task.raw.replace(DONE_MARK, `- [${task.done ? "x" : " "}]`)
    : formatTaskLine(task);
}

const ops = {
  add(doc, tag, { text, done, date, person }) {
    const task = {
      kind: "task",
      text,
      done: !!done,
      date: date || null,
      person: person || null,
      children: [],
    };
    touchTask(task, false);
    insertTask(doc, tag, task);
  },
  remove(doc, tag, index, expectText) {
    const { section, task } = findTask(doc, tag, index, expectText);
    detachTask(section, task);
  },
  toggle(doc, tag, index, expectText) {
    const { task } = findTask(doc, tag, index, expectText);
    task.done = !task.done;
    touchTask(task, true);
  },
  updateText(doc, tag, index, expectText, newText) {
    const { task } = findTask(doc, tag, index, expectText);
    task.text = newText;
    touchTask(task, false);
  },
  reorder(doc, tag, fromIndex, toIndex, expectText) {
    const refs = taskRefs(doc, tag);
    const { section, task } = findTask(doc, tag, fromIndex, expectText);
    if (toIndex === fromIndex || toIndex === fromIndex + 1) return;
    const before = toIndex < refs.length ? refs[toIndex].task : null;
    section.items.splice(section.items.indexOf(task), 1);
    if (before) {
      insertTask(doc, tag, task, before);
    } else {
      const last = refs[refs.length - 1];
      const lastSection = last.section;
      lastSection.items.splice(lastSection.items.indexOf(last.task) + 1, 0, task);
    }
  },
  move(doc, fromTag, index, toTag, expectText, meta, settings) {
    const { section, task } = findTask(doc, fromTag, index, expectText);
    const before = { done: task.done, date: task.date, person: task.person };

    if (toTag === "eliminate" && settings.autoCompleteEliminate) task.done = true;
    if (fromTag === "eliminate" && settings.autoCompleteEliminate) task.done = false;
    if (fromTag === "schedule" && toTag !== "schedule") task.date = null;
    if (fromTag === "delegate" && toTag !== "delegate") task.person = null;
    if (meta && meta.date) task.date = meta.date;
    if (meta && meta.person) task.person = meta.person;

    const fieldsChanged = task.date !== before.date || task.person !== before.person;
    if (fieldsChanged) touchTask(task, false);
    else if (task.done !== before.done) touchTask(task, true);

    detachTask(section, task);
    insertTask(doc, toTag, task);
  },
};

class MoveTaskModal extends Modal {
  constructor(app, targetQuadrant, onConfirm, plugin) {
    super(app);
    this.targetQuadrant = targetQuadrant;
    this.onConfirm = onConfirm;
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("eisenhower-modal");

    if (this.targetQuadrant === "schedule") {
      contentEl.createEl("h3", { text: "Schedule date" });
      contentEl.createEl("p", {
        text: "Select the due date for this task.",
        cls: "eisenhower-modal-desc",
      });

      /* Quick date buttons */
      const quickDatesRow = contentEl.createDiv({ cls: "eisenhower-modal-quick-dates" });
      const quickDates = [
        { label: "Tomorrow", value: localDate(1) },
        { label: "+7 days", value: localDate(7) },
        { label: "+30 days", value: localDate(30) },
      ];

      const today = localDate();
      const dateInput = contentEl.createEl("input", {
        attr: { type: "date", min: today },
        cls: "eisenhower-modal-input",
      });

      for (const qd of quickDates) {
        const qBtn = quickDatesRow.createEl("button", { text: qd.label });
        qBtn.addEventListener("click", () => {
          dateInput.value = qd.value;
          dateInput.classList.remove("input-error");
          errorEl.classList.add("hidden");
        });
      }

      const errorEl = contentEl.createDiv({ cls: "eisenhower-modal-error hidden" });

      const btnRow = contentEl.createDiv({ cls: "eisenhower-modal-actions" });
      const cancelBtn = btnRow.createEl("button", {
        text: "Cancel",
        cls: "eisenhower-modal-cancel",
      });
      const btn = btnRow.createEl("button", {
        text: "Confirm",
        cls: "eisenhower-add-btn eisenhower-modal-btn",
      });

      setTimeout(() => dateInput.focus(), 50);

      const submit = () => {
        const date = dateInput.value;
        if (!date) {
          dateInput.classList.add("input-error");
          errorEl.textContent = "Please select a date.";
          errorEl.classList.remove("hidden");
          return;
        }
        if (date < today) {
          dateInput.classList.add("input-error");
          errorEl.textContent = "Date cannot be in the past.";
          errorEl.classList.remove("hidden");
          return;
        }
        this.onConfirm({ date });
        this.close();
      };
      dateInput.addEventListener("input", () => {
        dateInput.classList.remove("input-error");
        errorEl.classList.add("hidden");
      });
      btn.addEventListener("click", submit);
      cancelBtn.addEventListener("click", () => this.close());
      dateInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    } else if (this.targetQuadrant === "delegate") {
      contentEl.createEl("h3", { text: "Assignee" });
      contentEl.createEl("p", {
        text: "Enter the name of the person responsible for this task.",
        cls: "eisenhower-modal-desc",
      });

      const personInput = contentEl.createEl("input", {
        attr: { type: "text", placeholder: "Assignee name..." },
        cls: "eisenhower-modal-input",
      });

      /* Autocomplete suggestions */
      const suggestionsRow = contentEl.createDiv({ cls: "eisenhower-modal-suggestions" });
      if (this.plugin) {
        this.plugin.loadData_().then((data) => {
          const persons = new Set();
          for (const key of Object.keys(data)) {
            for (const t of data[key]) {
              if (t.person) persons.add(t.person);
            }
          }
          for (const name of persons) {
            const chip = suggestionsRow.createEl("button", {
              text: name,
              cls: "eisenhower-suggestion-chip",
            });
            chip.addEventListener("click", () => {
              personInput.value = name;
              personInput.classList.remove("input-error");
              errorEl.classList.add("hidden");
            });
          }
        });
      }

      const errorEl = contentEl.createDiv({ cls: "eisenhower-modal-error hidden" });

      const btnRow = contentEl.createDiv({ cls: "eisenhower-modal-actions" });
      const cancelBtn = btnRow.createEl("button", {
        text: "Cancel",
        cls: "eisenhower-modal-cancel",
      });
      const btn = btnRow.createEl("button", {
        text: "Confirm",
        cls: "eisenhower-add-btn eisenhower-modal-btn",
      });

      setTimeout(() => personInput.focus(), 50);

      const submit = () => {
        const person = personInput.value.trim();
        if (!person) {
          personInput.classList.add("input-error");
          errorEl.textContent = "Please enter the assignee name.";
          errorEl.classList.remove("hidden");
          return;
        }
        this.onConfirm({ person });
        this.close();
      };
      personInput.addEventListener("input", () => {
        personInput.classList.remove("input-error");
        errorEl.classList.add("hidden");
      });
      btn.addEventListener("click", submit);
      cancelBtn.addEventListener("click", () => this.close());
      personInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
      });
    }
  }

  onClose() {
    this.contentEl.empty();
  }
}

/* ── Quick capture: add a task from anywhere ── */

class QuickAddModal extends Modal {
  constructor(app, plugin) {
    super(app);
    this.plugin = plugin;
    this.isUrgent = false;
    this.isImportant = false;
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.addClass("eisenhower-modal", "eisenhower-quick-add");
    contentEl.createEl("h3", { text: "Add task to Eisenhower Matrix" });

    const input = contentEl.createEl("input", {
      attr: { type: "text", placeholder: "Type a task..." },
      cls: "eisenhower-modal-input",
    });

    const toggleRow = contentEl.createDiv({ cls: "eisenhower-toggle-row" });
    const makeToggle = (label, kind, hint) => {
      const el = toggleRow.createEl("label", {
        cls: "eisenhower-toggle",
        attr: { title: hint },
      });
      const cb = el.createEl("input", { attr: { type: "checkbox" } });
      const slider = el.createSpan({ cls: "toggle-slider" });
      el.createSpan({ text: label, cls: "toggle-label" });
      const set = (on) => {
        cb.checked = on;
        slider.className = `toggle-slider ${on ? `active ${kind}` : ""}`;
      };
      cb.addEventListener("change", () => {
        set(cb.checked);
        if (kind === "urgent") this.isUrgent = cb.checked;
        else this.isImportant = cb.checked;
        update();
      });
      return set;
    };
    const setUrgent = makeToggle("Urgent", "urgent", "Alt+U");
    const setImportant = makeToggle("Important", "important", "Alt+I");
    const previewEl = toggleRow.createSpan({ cls: "eisenhower-preview" });

    contentEl.createDiv({
      cls: "eisenhower-modal-desc eisenhower-quick-hint",
      text: "Alt+1–4 picks a quadrant · Alt+U / Alt+I toggle · Enter adds",
    });

    /* Schedule: date */
    const dateWrap = contentEl.createDiv({ cls: "hidden" });
    const quickDatesRow = dateWrap.createDiv({ cls: "eisenhower-modal-quick-dates" });
    const dateInput = dateWrap.createEl("input", {
      attr: { type: "date", min: localDate() },
      cls: "eisenhower-modal-input",
    });
    for (const qd of [
      { label: "Tomorrow", value: localDate(1) },
      { label: "+7 days", value: localDate(7) },
      { label: "+30 days", value: localDate(30) },
    ]) {
      const b = quickDatesRow.createEl("button", { text: qd.label });
      b.addEventListener("click", () => {
        dateInput.value = qd.value;
        clearError();
      });
    }

    /* Delegate: assignee */
    const personWrap = contentEl.createDiv({ cls: "hidden" });
    const personInput = personWrap.createEl("input", {
      attr: { type: "text", placeholder: "Assignee name..." },
      cls: "eisenhower-modal-input",
    });
    const suggestionsRow = personWrap.createDiv({ cls: "eisenhower-modal-suggestions" });
    this.plugin.loadData_().then((data) => {
      const persons = new Set();
      for (const key of Object.keys(data)) {
        for (const t of data[key]) if (t.person) persons.add(t.person);
      }
      for (const name of persons) {
        const chip = suggestionsRow.createEl("button", {
          text: name,
          cls: "eisenhower-suggestion-chip",
        });
        chip.addEventListener("click", () => {
          personInput.value = name;
          clearError();
        });
      }
    });

    const errorEl = contentEl.createDiv({ cls: "eisenhower-modal-error hidden" });
    const showError = (msg, field) => {
      errorEl.textContent = msg;
      errorEl.classList.remove("hidden");
      field.classList.add("input-error");
      field.focus();
    };
    const clearError = () => {
      errorEl.classList.add("hidden");
      dateInput.classList.remove("input-error");
      personInput.classList.remove("input-error");
    };

    const btnRow = contentEl.createDiv({ cls: "eisenhower-modal-actions" });
    const cancelBtn = btnRow.createEl("button", {
      text: "Cancel",
      cls: "eisenhower-modal-cancel",
    });
    const addBtn = btnRow.createEl("button", {
      text: "Add",
      cls: "eisenhower-add-btn eisenhower-modal-btn",
    });

    const update = () => {
      const tag = getQuadrant(this.isUrgent, this.isImportant);
      const q = QUADRANTS.find((x) => x.tag === tag);
      renderPreview(previewEl, q);
      dateWrap.classList.toggle("hidden", tag !== "schedule");
      personWrap.classList.toggle("hidden", tag !== "delegate");
      clearError();
    };
    const pick = (urgent, important) => {
      this.isUrgent = urgent;
      this.isImportant = important;
      setUrgent(urgent);
      setImportant(important);
      update();
    };
    update();

    const submit = async () => {
      const text = input.value.trim();
      if (!text) return;
      const quadrant = getQuadrant(this.isUrgent, this.isImportant);
      const meta = {};
      if (quadrant === "schedule") {
        const date = dateInput.value;
        if (!date) return showError("Please select a date.", dateInput);
        if (date < localDate()) return showError("Date cannot be in the past.", dateInput);
        meta.date = date;
      }
      if (quadrant === "delegate") {
        const person = personInput.value.trim();
        if (!person) return showError("Please enter the assignee name.", personInput);
        meta.person = person;
      }
      const done =
        this.plugin.settings.autoCompleteEliminate && quadrant === "eliminate";
      await this.plugin.addTask(quadrant, text, done, meta);
      const q = QUADRANTS.find((x) => x.tag === quadrant);
      new Notice(`Added to ${q.title}`);
      this.close();
    };

    /* Keyboard: Alt+1..4 quadrant (in matrix order), Alt+U/I toggles, Enter adds */
    const byDigit = {
      Digit1: [true, true],
      Digit2: [false, true],
      Digit3: [true, false],
      Digit4: [false, false],
    };
    contentEl.addEventListener("keydown", (e) => {
      if (e.altKey && byDigit[e.code]) {
        e.preventDefault();
        pick(...byDigit[e.code]);
      } else if (e.altKey && e.code === "KeyU") {
        e.preventDefault();
        pick(!this.isUrgent, this.isImportant);
      } else if (e.altKey && e.code === "KeyI") {
        e.preventDefault();
        pick(this.isUrgent, !this.isImportant);
      } else if (e.key === "Enter" && !e.isComposing && e.target.tagName === "INPUT") {
        e.preventDefault();
        submit();
      }
    });
    input.addEventListener("input", clearError);
    dateInput.addEventListener("input", clearError);
    personInput.addEventListener("input", clearError);
    addBtn.addEventListener("click", submit);
    cancelBtn.addEventListener("click", () => this.close());

    setTimeout(() => input.focus(), 50);
  }

  onClose() {
    this.contentEl.empty();
  }
}

class EisenhowerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.isUrgent = false;
    this.isImportant = false;
    this.hideCompleted = false;
    /* UI state that survives re-renders (live reload) */
    this.draft = { text: "", date: "", person: "" };
    this.expanded = new Set();
    this.editing = false;
    this.pendingRefresh = false;
    this.renderSeq = 0;
    this.refreshTimer = null;
    this.mdComponent = null;
  }

  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Eisenhower Matrix";
  }
  getIcon() {
    return "layout-grid";
  }

  async onOpen() {
    await this.render();
  }

  async onClose() {
    window.clearTimeout(this.refreshTimer);
    if (this.mdComponent) this.mdComponent.unload();
  }

  /* The file changed (our own write, another tab, or sync): re-read it.
   * An inline edit in progress is never interrupted; it renders on finish. */
  requestRefresh() {
    if (this.editing) {
      this.pendingRefresh = true;
      return;
    }
    window.clearTimeout(this.refreshTimer);
    this.refreshTimer = window.setTimeout(() => this.render(), 150);
  }

  finishEditing() {
    this.editing = false;
    this.pendingRefresh = false;
    this.render();
  }

  clearDropHighlights() {
    const quadrants = this.containerEl.querySelectorAll(".eisenhower-quadrant");
    quadrants.forEach((el) => el.classList.remove("quadrant-dragover"));
  }

  promptAndMoveTask(fromQuadrant, index, toQuadrant, expectText) {
    const move = async (meta) => {
      await this.plugin.moveTask(fromQuadrant, index, toQuadrant, expectText, meta);
      await this.render();
    };
    if (toQuadrant === "schedule" || toQuadrant === "delegate") {
      new MoveTaskModal(this.app, toQuadrant, move, this.plugin).open();
    } else {
      move();
    }
  }

  async render() {
    const seq = ++this.renderSeq;
    const data = await this.plugin.loadData_();
    if (seq !== this.renderSeq) return;

    const container = this.containerEl.children[1];
    const hadFocus = this.inputEl && document.activeElement === this.inputEl;
    container.empty();
    if (this.mdComponent) this.removeChild(this.mdComponent);
    this.mdComponent = this.addChild(new Component());
    this.sourcePath = this.plugin.dataPath();

    const wrap = container.createDiv({ cls: "eisenhower-container" });

    /* ── Input area ── */
    const inputArea = wrap.createDiv({ cls: "eisenhower-input-area" });

    const inputRow = inputArea.createDiv({ cls: "eisenhower-input-row" });
    const input = inputRow.createEl("input", {
      attr: { type: "text", placeholder: "Type a task..." },
      cls: "eisenhower-input",
    });
    this.inputEl = input;
    input.value = this.draft.text;
    input.addEventListener("input", () => (this.draft.text = input.value));

    const extrasRow = inputArea.createDiv({ cls: "eisenhower-extras-row" });
    const today = localDate();
    this.dateInput = extrasRow.createEl("input", {
      attr: { type: "date", min: today },
      cls: "eisenhower-date-input hidden",
    });
    this.dateInput.value = this.draft.date;
    this.dateInput.addEventListener("input", () => {
      this.draft.date = this.dateInput.value;
      this.dateInput.classList.remove("input-error");
      if (this.dateError) this.dateError.classList.add("hidden");
    });

    /* Quick date buttons in main form */
    this.dateQuickBtns = extrasRow.createDiv({ cls: "eisenhower-modal-quick-dates hidden" });
    const mainQuickDates = [
      { label: "Tomorrow", value: localDate(1) },
      { label: "+7 days", value: localDate(7) },
      { label: "+30 days", value: localDate(30) },
    ];
    for (const qd of mainQuickDates) {
      const qBtn = this.dateQuickBtns.createEl("button", { text: qd.label });
      qBtn.addEventListener("click", () => {
        this.dateInput.value = qd.value;
        this.draft.date = qd.value;
        this.dateInput.classList.remove("input-error");
        if (this.dateError) this.dateError.classList.add("hidden");
      });
    }

    this.dateError = extrasRow.createDiv({ cls: "eisenhower-modal-error hidden" });

    this.delegateInput = extrasRow.createEl("input", {
      attr: { type: "text", placeholder: "Assignee..." },
      cls: "eisenhower-delegate-input hidden",
    });
    this.delegateInput.value = this.draft.person;
    this.delegateInput.addEventListener("input", () => {
      this.draft.person = this.delegateInput.value;
      this.delegateInput.classList.remove("input-error");
      if (this.delegateError) this.delegateError.classList.add("hidden");
    });

    this.delegateError = extrasRow.createDiv({ cls: "eisenhower-modal-error hidden" });

    /* Autocomplete for delegate input in main form */
    this.delegateSuggestions = extrasRow.createDiv({ cls: "eisenhower-modal-suggestions hidden" });
    const persons = new Set();
    for (const key of Object.keys(data)) {
      for (const t of data[key]) {
        if (t.person) persons.add(t.person);
      }
    }
    for (const name of persons) {
      const chip = this.delegateSuggestions.createEl("button", {
        text: name,
        cls: "eisenhower-suggestion-chip",
      });
      chip.addEventListener("click", () => {
        this.delegateInput.value = name;
        this.draft.person = name;
        this.delegateInput.classList.remove("input-error");
        if (this.delegateError) this.delegateError.classList.add("hidden");
      });
    }

    const addBtn = inputRow.createEl("button", {
      text: "Add",
      cls: "eisenhower-add-btn",
    });

    const toggleRow = inputArea.createDiv({ cls: "eisenhower-toggle-row" });

    const urgentLabel = toggleRow.createEl("label", {
      cls: "eisenhower-toggle",
    });
    const urgentCb = urgentLabel.createEl("input", {
      attr: { type: "checkbox" },
    });
    urgentCb.checked = this.isUrgent;
    const urgentSlider = urgentLabel.createSpan({
      cls: `toggle-slider ${this.isUrgent ? "active urgent" : ""}`,
    });
    urgentLabel.createSpan({ text: "Urgent", cls: "toggle-label" });

    urgentCb.addEventListener("change", () => {
      this.isUrgent = urgentCb.checked;
      urgentSlider.className = `toggle-slider ${this.isUrgent ? "active urgent" : ""}`;
      this.updatePreview(previewEl);
      this.updateExtras();
    });

    const importantLabel = toggleRow.createEl("label", {
      cls: "eisenhower-toggle",
    });
    const importantCb = importantLabel.createEl("input", {
      attr: { type: "checkbox" },
    });
    importantCb.checked = this.isImportant;
    const importantSlider = importantLabel.createSpan({
      cls: `toggle-slider ${this.isImportant ? "active important" : ""}`,
    });
    importantLabel.createSpan({ text: "Important", cls: "toggle-label" });

    importantCb.addEventListener("change", () => {
      this.isImportant = importantCb.checked;
      importantSlider.className = `toggle-slider ${this.isImportant ? "active important" : ""}`;
      this.updatePreview(previewEl);
      this.updateExtras();
    });

    const previewEl = toggleRow.createSpan({ cls: "eisenhower-preview" });
    this.updatePreview(previewEl);
    this.updateExtras();

    const hideLabel = this.hideCompleted ? "Show completed" : "Hide completed";
    const toggleBtn = toggleRow.createEl("button", {
      cls: `eisenhower-hide-toggle clickable-icon ${this.hideCompleted ? "is-active" : ""}`,
      attr: { "aria-label": hideLabel, title: hideLabel },
    });
    setIcon(toggleBtn, this.hideCompleted ? "eye-off" : "eye");
    toggleBtn.addEventListener("click", () => {
      this.hideCompleted = !this.hideCompleted;
      this.render();
    });

    const addTask = async () => {
      const text = input.value.trim();
      if (!text) return;

      const quadrant = getQuadrant(this.isUrgent, this.isImportant);

      let meta = {};

      if (quadrant === "schedule") {
        const date = this.dateInput.value;
        if (!date) {
          this.dateInput.classList.add("input-error");
          this.dateError.textContent = "Please select a date.";
          this.dateError.classList.remove("hidden");
          this.dateInput.focus();
          return;
        }
        if (date < localDate()) {
          this.dateInput.classList.add("input-error");
          this.dateError.textContent = "Date cannot be in the past.";
          this.dateError.classList.remove("hidden");
          this.dateInput.focus();
          return;
        }
        this.dateInput.classList.remove("input-error");
        this.dateError.classList.add("hidden");
        meta.date = date;
      }

      if (quadrant === "delegate") {
        const person = this.delegateInput.value.trim();
        if (!person) {
          this.delegateInput.classList.add("input-error");
          this.delegateError.textContent = "Please enter the assignee name.";
          this.delegateError.classList.remove("hidden");
          this.delegateInput.focus();
          return;
        }
        this.delegateInput.classList.remove("input-error");
        this.delegateError.classList.add("hidden");
        meta.person = person;
      }

      const done =
        this.plugin.settings.autoCompleteEliminate && quadrant === "eliminate";

      this.draft = { text: "", date: "", person: "" };
      input.value = "";
      this.dateInput.value = "";
      this.delegateInput.value = "";
      await this.plugin.addTask(quadrant, text, done, meta);
      await this.render();
      if (this.inputEl) this.inputEl.focus();
    };

    addBtn.addEventListener("click", addTask);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTask();
    });

    /* ── Matrix: axes outside, four equal cells forming a cross ── */
    const grid = wrap.createDiv({ cls: "eisenhower-matrix" });
    grid.createDiv({ cls: "matrix-axis axis-urgent", text: "Urgent" });
    grid.createDiv({ cls: "matrix-axis axis-not-urgent", text: "Not urgent" });
    grid.createDiv({ cls: "matrix-axis axis-important", text: "Important" });
    grid.createDiv({ cls: "matrix-axis axis-not-important", text: "Not important" });

    for (const q of QUADRANTS) {
      const quadrantEl = grid.createDiv({
        cls: `eisenhower-quadrant ${q.cls}`,
      });

      /* Quadrant data */
      const tasks = data[q.tag] || [];
      const pending = tasks.filter((t) => !t.done).length;

      /* Filter display (hide completed) */
      const displayTasks = this.hideCompleted
        ? tasks.filter((t) => !t.done)
        : tasks;

      /* Drag & Drop — drop zone */
      quadrantEl.addEventListener("dragover", (e) => {
        e.preventDefault();
        this.clearDropHighlights();
        quadrantEl.classList.add("quadrant-dragover");
      });
      quadrantEl.addEventListener("dragleave", (e) => {
        if (!quadrantEl.contains(e.relatedTarget)) {
          quadrantEl.classList.remove("quadrant-dragover");
        }
      });
      quadrantEl.addEventListener("drop", (e) => {
        e.preventDefault();
        this.clearDropHighlights();
        try {
          const transfer = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (transfer.quadrant === q.tag) {
            /* Reorder within same quadrant */
            const taskEls = quadrantEl.querySelectorAll(".eisenhower-task");
            let toIndex = tasks.length;
            for (let ti = 0; ti < taskEls.length; ti++) {
              const rect = taskEls[ti].getBoundingClientRect();
              if (e.clientY < rect.top + rect.height / 2) {
                toIndex = parseInt(taskEls[ti].dataset.originalIndex);
                break;
              }
            }
            if (transfer.index !== toIndex) {
              this.plugin
                .reorderTask(q.tag, transfer.index, toIndex, transfer.text)
                .then(() => this.render());
            }
          } else {
            this.promptAndMoveTask(transfer.quadrant, transfer.index, q.tag, transfer.text);
          }
        } catch (err) {
          /* ignore bad data */
        }
      });

      /* Header: position in the matrix (narrow layouts), number, title, counter */
      const titleEl = quadrantEl.createDiv({ cls: "quadrant-title" });
      const mini = titleEl.createSpan({
        cls: "quadrant-mini",
        attr: { "aria-hidden": "true" },
      });
      for (const n of [1, 2, 3, 4]) {
        mini.createSpan({ cls: n === q.num ? "is-on" : "" });
      }
      titleEl.createSpan({ cls: "quadrant-number", text: String(q.num) });
      titleEl.createSpan({ cls: "quadrant-name", text: q.title });
      titleEl.createSpan({
        cls: "quadrant-counter",
        text: `${pending}/${tasks.length}`,
        attr: { title: `${pending} pending of ${tasks.length}` },
      });
      quadrantEl.createDiv({ cls: "quadrant-axes", text: q.axes });

      const taskList = quadrantEl.createDiv({ cls: "quadrant-tasks" });

      for (let i = 0; i < displayTasks.length; i++) {
        const originalIndex = tasks.indexOf(displayTasks[i]);
        this.renderTask(taskList, displayTasks[i], q.tag, originalIndex);
      }

      if (displayTasks.length === 0) {
        taskList.createDiv({
          cls: "quadrant-empty",
          text:
            this.hideCompleted && tasks.length > 0
              ? `${tasks.length} completed task(s)`
              : "No tasks",
        });
      }
    }

    if (hadFocus) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  }

  updateExtras() {
    const quadrant = getQuadrant(this.isUrgent, this.isImportant);

    if (quadrant === "schedule") {
      this.dateInput.classList.remove("hidden");
      if (this.dateQuickBtns) this.dateQuickBtns.classList.remove("hidden");
    } else {
      this.dateInput.classList.add("hidden");
      if (this.dateQuickBtns) this.dateQuickBtns.classList.add("hidden");
    }
    // Reset date error when switching quadrants
    if (this.dateError) {
      this.dateError.classList.add("hidden");
      this.dateInput.classList.remove("input-error");
    }

    if (quadrant === "delegate") {
      this.delegateInput.classList.remove("hidden");
      if (this.delegateSuggestions) this.delegateSuggestions.classList.remove("hidden");
    } else {
      this.delegateInput.classList.add("hidden");
      if (this.delegateSuggestions) this.delegateSuggestions.classList.add("hidden");
    }
    if (this.delegateError) {
      this.delegateError.classList.add("hidden");
      this.delegateInput.classList.remove("input-error");
    }
  }

  updatePreview(el) {
    const tag = getQuadrant(this.isUrgent, this.isImportant);
    const q = QUADRANTS.find((x) => x.tag === tag);
    renderPreview(el, q);
  }

  renderTask(parent, task, quadrant, index) {
    const today = localDate();
    const isOverdue =
      quadrant === "schedule" && task.date && task.date < today && !task.done;
    const key = `${quadrant}\u0000${task.text}`;

    const card = parent.createDiv({
      cls: `eisenhower-task ${task.done ? "task-done-row" : ""} ${
        isOverdue ? "task-overdue" : ""
      }`,
    });
    card.dataset.originalIndex = index;

    /* Drag & Drop — desktop only; touch uses the ⋯ menu */
    if (!Platform.isMobile) {
      card.setAttribute("draggable", "true");
      card.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData(
          "text/plain",
          JSON.stringify({ quadrant, index, text: task.text })
        );
        card.classList.add("task-dragging");
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("task-dragging");
        this.clearDropHighlights();
      });
    }

    const topRow = card.createDiv({ cls: "task-top-row" });

    const cb = topRow.createEl("input", { attr: { type: "checkbox" } });
    cb.checked = task.done;
    cb.addEventListener("change", async () => {
      await this.plugin.toggleTask(quadrant, index, task.text);
      await this.render();
    });

    /* Task text, rendered as Obsidian markdown (links, tags) */
    const textEl = topRow.createDiv({
      cls: `task-text${task.done ? " done" : ""}`,
    });
    this.renderMarkdown(task.text, textEl);

    const startEditing = () => {
      if (task.done || this.editing) return;
      this.editing = true;
      const currentText = task.text;
      const editInput = document.createElement("input");
      editInput.type = "text";
      editInput.value = currentText;
      editInput.className = "task-text-editing";
      textEl.replaceWith(editInput);
      editInput.focus();
      editInput.select();
      let finished = false;
      const save = async () => {
        if (finished) return;
        finished = true;
        const newText = editInput.value.trim();
        if (newText && newText !== currentText) {
          await this.plugin.updateTaskText(quadrant, index, currentText, newText);
        }
        this.finishEditing();
      };
      const cancel = () => {
        if (finished) return;
        finished = true;
        this.finishEditing();
      };
      editInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); save(); }
        if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
      });
      editInput.addEventListener("blur", save);
    };

    /* Click a link or tag to follow it; click anywhere else to edit */
    textEl.addEventListener("click", (e) => {
      e.stopPropagation();
      if (this.followLink(e)) return;
      startEditing();
    });

    /* Sub-items toggle */
    if (task.children && task.children.length) {
      const open = this.expanded.has(key);
      const toggle = topRow.createSpan({
        cls: "task-children-toggle",
        text: `${open ? "▾" : "▸"} ${task.children.length}`,
        attr: { title: open ? "Hide sub-items" : "Show sub-items" },
      });
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        if (open) this.expanded.delete(key);
        else this.expanded.add(key);
        this.render();
      });
    }

    /* Date badge / overdue */
    if (quadrant === "schedule" && task.date) {
      const badge = topRow.createSpan({
        cls: `task-badge ${isOverdue ? "badge-overdue" : "badge-date"}`,
        attr: isOverdue ? { title: "Overdue" } : {},
      });
      setIcon(badge.createSpan({ cls: "eisenhower-icon" }), isOverdue ? "alert-triangle" : "calendar");
      badge.createSpan({ text: this.formatDate(task.date) });
    }

    if (quadrant === "delegate" && task.person) {
      const badge = topRow.createSpan({ cls: "task-badge badge-person" });
      setIcon(badge.createSpan({ cls: "eisenhower-icon" }), "user");
      badge.createSpan({ text: task.person });
    }

    const addMoveItems = (menu) => {
      for (const q of QUADRANTS) {
        if (q.tag === quadrant) continue;
        menu.addItem((item) => {
          item.setTitle(q.title).setIcon(q.lucide).onClick(() => {
            this.promptAndMoveTask(quadrant, index, q.tag, task.text);
          });
        });
      }
    };
    const deleteTask = async () => {
      await this.plugin.removeTask(quadrant, index, task.text);
      await this.render();
    };

    /* Move menu button (desktop, on hover) */
    const moveBtn = topRow.createSpan({
      cls: "task-move",
      attr: { "aria-label": "Move to…" },
    });
    setIcon(moveBtn, "arrow-left-right");
    moveBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      addMoveItems(menu);
      menu.showAtMouseEvent(e);
    });

    /* Delete button with confirmation (desktop, on hover) */
    const del = topRow.createSpan({
      cls: "task-delete",
      attr: { "aria-label": "Delete" },
    });
    setIcon(del, "x");
    del.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) =>
        item.setTitle("Delete task").setIcon("trash").onClick(deleteTask)
      );
      menu.showAtMouseEvent(e);
    });

    /* All actions in one menu (touch screens) */
    const more = topRow.createSpan({
      cls: "task-more",
      attr: { "aria-label": "Task actions" },
    });
    setIcon(more, "more-horizontal");
    more.addEventListener("click", (e) => {
      e.stopPropagation();
      const menu = new Menu();
      if (!task.done) {
        menu.addItem((item) =>
          item.setTitle("Edit").setIcon("pencil").onClick(startEditing)
        );
      }
      menu.addSeparator();
      addMoveItems(menu);
      menu.addSeparator();
      menu.addItem((item) =>
        item.setTitle("Delete task").setIcon("trash").onClick(deleteTask)
      );
      menu.showAtMouseEvent(e);
    });

    /* Sub-items, rendered read-only */
    if (task.children && task.children.length && this.expanded.has(key)) {
      const childrenEl = card.createDiv({ cls: "task-children" });
      this.renderMarkdown(dedent(task.children), childrenEl).then(() => {
        childrenEl
          .querySelectorAll("input[type=checkbox]")
          .forEach((el) => el.setAttribute("disabled", ""));
      });
    }
  }

  renderMarkdown(markdown, el) {
    const render = MarkdownRenderer.render
      ? MarkdownRenderer.render(this.app, markdown, el, this.sourcePath, this.mdComponent)
      : MarkdownRenderer.renderMarkdown(markdown, el, this.sourcePath, this.mdComponent);
    return Promise.resolve(render).then(() => {
      el.querySelectorAll("a.internal-link").forEach((a) => {
        a.addEventListener("mouseover", (event) => {
          this.app.workspace.trigger("hover-link", {
            event,
            source: VIEW_TYPE,
            hoverParent: this,
            targetEl: a,
            linktext: a.getAttribute("data-href") || a.getAttribute("href"),
            sourcePath: this.sourcePath,
          });
        });
      });
    });
  }

  /* Returns true if the click landed on a link or tag and was handled */
  followLink(e) {
    const a = e.target.closest("a");
    if (!a) return false;
    if (a.hasClass("internal-link")) {
      e.preventDefault();
      const target = a.getAttribute("data-href") || a.getAttribute("href");
      this.app.workspace.openLinkText(target, this.sourcePath, Keymap.isModEvent(e));
      return true;
    }
    if (a.hasClass("tag")) {
      e.preventDefault();
      const search = this.app.internalPlugins?.getPluginById?.("global-search");
      if (search && search.instance) {
        search.instance.openGlobalSearch(`tag:${a.getAttribute("href")}`);
      }
      return true;
    }
    return true; /* external links: let the browser open them */
  }

  formatDate(dateStr) {
    const months = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    const [y, m, d] = dateStr.split("-");
    return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
  }
}

/* ── Settings Tab ── */

class EisenhowerSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Eisenhower Matrix — Settings" });

    new Setting(containerEl)
      .setName("Data file")
      .setDesc(
        "Name/path of the markdown file where tasks are saved."
      )
      .addText((text) =>
        text
          .setPlaceholder("Eisenhower Matrix.md")
          .setValue(this.plugin.settings.dataFile)
          .onChange(async (value) => {
            this.plugin.settings.dataFile =
              value.trim() || DEFAULT_SETTINGS.dataFile;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );

    new Setting(containerEl)
      .setName("Auto-complete Eliminate")
      .setDesc(
        "Tasks added to the Eliminate quadrant are automatically marked as done."
      )
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoCompleteEliminate)
          .onChange(async (value) => {
            this.plugin.settings.autoCompleteEliminate = value;
            await this.plugin.saveSettings();
            this.plugin.refreshViews();
          })
      );
  }
}

/* ── Main Plugin ── */

class EisenhowerMatrixPlugin extends Plugin {
  async onload() {
    await this.loadSettings();

    this.registerView(VIEW_TYPE, (leaf) => new EisenhowerView(leaf, this));

    this.addRibbonIcon("layout-grid", "Eisenhower Matrix", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-eisenhower-matrix",
      name: "Open Eisenhower Matrix",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "add-task",
      name: "Add task to Eisenhower Matrix",
      callback: () => new QuickAddModal(this.app, this).open(),
    });

    this.addSettingTab(new EisenhowerSettingTab(this.app, this));

    this.registerHoverLinkSource(VIEW_TYPE, {
      display: "Eisenhower Matrix",
      defaultMod: true,
    });

    /* Live reload: the file is the source of truth */
    this.registerEvent(this.app.vault.on("modify", (f) => this.onVaultChange(f.path)));
    this.registerEvent(this.app.vault.on("create", (f) => this.onVaultChange(f.path)));
    this.registerEvent(this.app.vault.on("delete", (f) => this.onVaultChange(f.path)));
    this.registerEvent(
      this.app.vault.on("rename", (f, oldPath) => this.onVaultChange(f.path, oldPath))
    );
  }

  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];

    if (!leaf) {
      leaf = workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }

    workspace.revealLeaf(leaf);
  }

  onunload() {}

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  dataPath() {
    return normalizePath(this.settings.dataFile);
  }

  dataFile() {
    const file = this.app.vault.getAbstractFileByPath(this.dataPath());
    return file && file.extension !== undefined ? file : null;
  }

  async loadData_() {
    const file = this.dataFile();
    if (!file) return docToData(parseDoc(skeletonMarkdown()));
    return docToData(parseDoc(await this.app.vault.read(file)));
  }

  /* Atomic read-modify-write on the file's current contents.
   * Returns false (and writes nothing) if the task acted on moved or changed. */
  async mutate(fn) {
    let file = this.dataFile();
    if (!file) file = await this.app.vault.create(this.dataPath(), skeletonMarkdown());
    let conflict = false;
    await this.app.vault.process(file, (content) => {
      const doc = parseDoc(content);
      try {
        fn(doc);
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
        conflict = true;
        return content;
      }
      return serializeDoc(doc);
    });
    if (conflict) {
      new Notice("Eisenhower Matrix changed — refreshed.");
      this.refreshViews();
    }
    return !conflict;
  }

  refreshViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      if (leaf.view instanceof EisenhowerView) leaf.view.requestRefresh();
    }
  }

  onVaultChange(path, oldPath) {
    const target = this.dataPath();
    if (path === target || oldPath === target) this.refreshViews();
  }

  addTask(quadrant, text, done, meta) {
    return this.mutate((doc) =>
      ops.add(doc, quadrant, { text, done, date: meta.date, person: meta.person })
    );
  }

  removeTask(quadrant, index, expectText) {
    return this.mutate((doc) => ops.remove(doc, quadrant, index, expectText));
  }

  toggleTask(quadrant, index, expectText) {
    return this.mutate((doc) => ops.toggle(doc, quadrant, index, expectText));
  }

  updateTaskText(quadrant, index, expectText, newText) {
    return this.mutate((doc) =>
      ops.updateText(doc, quadrant, index, expectText, newText)
    );
  }

  reorderTask(quadrant, fromIndex, toIndex, expectText) {
    return this.mutate((doc) =>
      ops.reorder(doc, quadrant, fromIndex, toIndex, expectText)
    );
  }

  moveTask(fromQuadrant, index, toQuadrant, expectText, meta) {
    return this.mutate((doc) =>
      ops.move(doc, fromQuadrant, index, toQuadrant, expectText, meta, this.settings)
    );
  }
}

/* Exposed for tests */
EisenhowerMatrixPlugin.model = { parseDoc, serializeDoc, docToData, skeletonMarkdown, ops, ConflictError };

module.exports = EisenhowerMatrixPlugin;
