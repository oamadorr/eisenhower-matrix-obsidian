"use strict";

const { Plugin, ItemView } = require("obsidian");

const VIEW_TYPE = "eisenhower-matrix-view";
const DATA_FILE = "Eisenhower Matrix.md";

const QUADRANTS = [
  {
    id: "q1",
    cls: "q1",
    icon: "🔴",
    title: "Do Now",
    subtitle: "Urgent + Important",
    tag: "do",
  },
  {
    id: "q2",
    cls: "q2",
    icon: "🔵",
    title: "Schedule",
    subtitle: "Important + Not Urgent",
    tag: "schedule",
  },
  {
    id: "q3",
    cls: "q3",
    icon: "🟡",
    title: "Delegate",
    subtitle: "Urgent + Not Important",
    tag: "delegate",
  },
  {
    id: "q4",
    cls: "q4",
    icon: "⚫",
    title: "Eliminate",
    subtitle: "Not Urgent + Not Important",
    tag: "eliminate",
  },
];

function getQuadrant(urgent, important) {
  if (urgent && important) return "do";
  if (!urgent && important) return "schedule";
  if (urgent && !important) return "delegate";
  return "eliminate";
}

class EisenhowerView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.isUrgent = false;
    this.isImportant = false;
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

  async render() {
    const container = this.containerEl.children[1];
    container.empty();

    const data = await this.plugin.loadData_();

    const wrap = container.createDiv({ cls: "eisenhower-container" });

    const header = wrap.createDiv({ cls: "eisenhower-header" });
    header.createEl("h2", { text: "Eisenhower Matrix" });

    const inputArea = wrap.createDiv({ cls: "eisenhower-input-area" });

    const inputRow = inputArea.createDiv({ cls: "eisenhower-input-row" });
    const input = inputRow.createEl("input", {
      attr: { type: "text", placeholder: "Type a task..." },
      cls: "eisenhower-input",
    });

    const extrasRow = inputArea.createDiv({ cls: "eisenhower-extras-row" });
    const today = new Date().toISOString().split("T")[0];
    this.dateInput = extrasRow.createEl("input", {
      attr: { type: "date", min: today },
      cls: "eisenhower-date-input hidden",
    });
    this.delegateInput = extrasRow.createEl("input", {
      attr: { type: "text", placeholder: "Assignee..." },
      cls: "eisenhower-delegate-input hidden",
    });

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

    const addTask = async () => {
      const text = input.value.trim();
      if (!text) return;

      const quadrant = getQuadrant(this.isUrgent, this.isImportant);

      let meta = {};

      if (quadrant === "schedule") {
        const date = this.dateInput.value;
        if (!date || date < new Date().toISOString().split("T")[0]) {
          this.dateInput.classList.add("input-error");
          this.dateInput.focus();
          return;
        }
        this.dateInput.classList.remove("input-error");
        meta.date = date;
      }

      if (quadrant === "delegate") {
        const person = this.delegateInput.value.trim();
        if (!person) {
          this.delegateInput.classList.add("input-error");
          this.delegateInput.focus();
          return;
        }
        this.delegateInput.classList.remove("input-error");
        meta.person = person;
      }

      const done = quadrant === "eliminate";

      await this.plugin.addTask(quadrant, text, done, meta);
      input.value = "";
      this.dateInput.value = "";
      this.delegateInput.value = "";
      await this.render();
    };

    addBtn.addEventListener("click", addTask);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") addTask();
    });

    const grid = wrap.createDiv({ cls: "eisenhower-grid" });

    for (const q of QUADRANTS) {
      const quadrant = grid.createDiv({
        cls: `eisenhower-quadrant ${q.cls}`,
      });

      const titleEl = quadrant.createDiv({ cls: "quadrant-title" });
      titleEl.createSpan({ text: q.icon });
      titleEl.createSpan({ text: q.title });

      quadrant.createDiv({ cls: "quadrant-subtitle", text: q.subtitle });

      const taskList = quadrant.createDiv({ cls: "quadrant-tasks" });

      const tasks = data[q.tag] || [];
      for (let i = 0; i < tasks.length; i++) {
        this.renderTask(taskList, tasks[i], q.tag, i);
      }

      if (tasks.length === 0) {
        taskList.createDiv({
          cls: "quadrant-empty",
          text: "No tasks",
        });
      }
    }
  }

  updateExtras() {
    const quadrant = getQuadrant(this.isUrgent, this.isImportant);

    if (quadrant === "schedule") {
      this.dateInput.classList.remove("hidden");
    } else {
      this.dateInput.classList.add("hidden");
    }

    if (quadrant === "delegate") {
      this.delegateInput.classList.remove("hidden");
    } else {
      this.delegateInput.classList.add("hidden");
    }
  }

  updatePreview(el) {
    const tag = getQuadrant(this.isUrgent, this.isImportant);
    const q = QUADRANTS.find((x) => x.tag === tag);
    el.textContent = `→ ${q.icon} ${q.title}`;
    el.className = `eisenhower-preview preview-${q.cls}`;
  }

  renderTask(parent, task, quadrant, index) {
    const card = parent.createDiv({
      cls: `eisenhower-task ${task.done ? "task-done-row" : ""}`,
    });

    const topRow = card.createDiv({ cls: "task-top-row" });

    const cb = topRow.createEl("input", { attr: { type: "checkbox" } });
    cb.checked = task.done;
    cb.addEventListener("change", async () => {
      await this.plugin.toggleTask(quadrant, index);
      await this.render();
    });

    topRow.createSpan({
      cls: `task-text${task.done ? " done" : ""}`,
      text: task.text,
    });

    if (quadrant === "schedule" && task.date) {
      const badge = topRow.createSpan({ cls: "task-badge badge-date" });
      badge.createSpan({ text: "📅 " });
      badge.createSpan({ text: this.formatDate(task.date) });
    }

    if (quadrant === "delegate" && task.person) {
      const badge = topRow.createSpan({ cls: "task-badge badge-person" });
      badge.createSpan({ text: "👤 " });
      badge.createSpan({ text: task.person });
    }

    const del = topRow.createSpan({ cls: "task-delete", text: "✕" });
    del.addEventListener("click", async () => {
      await this.plugin.removeTask(quadrant, index);
      await this.render();
    });
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

class EisenhowerMatrixPlugin extends Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new EisenhowerView(leaf, this));

    this.addRibbonIcon("layout-grid", "Eisenhower Matrix", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-eisenhower-matrix",
      name: "Open Eisenhower Matrix",
      callback: () => this.activateView(),
    });
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

  async loadData_() {
    const file = this.app.vault.getAbstractFileByPath(DATA_FILE);
    if (!file) {
      return { do: [], schedule: [], delegate: [], eliminate: [] };
    }
    const content = await this.app.vault.read(file);
    return this.parseMarkdown(content);
  }

  async saveData_(data) {
    const content = this.toMarkdown(data);
    const file = this.app.vault.getAbstractFileByPath(DATA_FILE);
    if (file) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(DATA_FILE, content);
    }
  }

  parseMarkdown(content) {
    const data = { do: [], schedule: [], delegate: [], eliminate: [] };
    let current = null;

    for (const line of content.split("\n")) {
      const headerMatch = line.match(
        /^## .*(Do Now|Schedule|Delegate|Eliminate)/i
      );
      if (headerMatch) {
        const h = headerMatch[1].toLowerCase();
        if (h === "do now") current = "do";
        else if (h === "schedule") current = "schedule";
        else if (h === "delegate") current = "delegate";
        else if (h === "eliminate") current = "eliminate";
        continue;
      }

      if (current) {
        const taskMatch = line.match(/^- \[([ xX])\] (.+)/);
        if (taskMatch) {
          const raw = taskMatch[2].trim();
          const done = taskMatch[1] !== " ";

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

          data[current].push({ text, done, date, person });
        }
      }
    }

    return data;
  }

  toMarkdown(data) {
    const lines = [
      "---",
      "tags:",
      "  - eisenhower",
      "---",
      "",
      "# Eisenhower Matrix",
      "",
    ];

    for (const q of QUADRANTS) {
      lines.push(`## ${q.icon} ${q.title}`);
      lines.push(`*${q.subtitle}*`);
      lines.push("");
      const tasks = data[q.tag] || [];
      if (tasks.length === 0) {
        lines.push("*No tasks*");
      } else {
        for (const t of tasks) {
          let line = `- [${t.done ? "x" : " "}] ${t.text}`;
          if (q.tag === "delegate" && t.person) {
            line += ` 👤 ${t.person}`;
          }
          if (q.tag === "schedule" && t.date) {
            line += ` 📅 ${t.date}`;
          }
          lines.push(line);
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }

  async addTask(quadrant, text, done, meta) {
    const data = await this.loadData_();
    if (!data[quadrant]) data[quadrant] = [];
    data[quadrant].push({
      text,
      done: done || false,
      date: meta.date || null,
      person: meta.person || null,
    });
    await this.saveData_(data);
  }

  async removeTask(quadrant, index) {
    const data = await this.loadData_();
    if (data[quadrant]) {
      data[quadrant].splice(index, 1);
      await this.saveData_(data);
    }
  }

  async toggleTask(quadrant, index) {
    const data = await this.loadData_();
    if (data[quadrant] && data[quadrant][index]) {
      data[quadrant][index].done = !data[quadrant][index].done;
      await this.saveData_(data);
    }
  }
}

module.exports = EisenhowerMatrixPlugin;
