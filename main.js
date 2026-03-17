"use strict";

const { Plugin, ItemView, PluginSettingTab, Setting, Menu } = require("obsidian");

const VIEW_TYPE = "eisenhower-matrix-view";

const DEFAULT_SETTINGS = {
  dataFile: "Eisenhower Matrix.md",
  autoCompleteEliminate: true,
};

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
    this.hideCompleted = false;
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

  clearDropHighlights() {
    const quadrants = this.containerEl.querySelectorAll(".eisenhower-quadrant");
    quadrants.forEach((el) => el.classList.remove("quadrant-dragover"));
  }

  async render() {
    const container = this.containerEl.children[1];
    container.empty();

    const data = await this.plugin.loadData_();

    const wrap = container.createDiv({ cls: "eisenhower-container" });

    /* ── Header with hide-completed toggle ── */
    const header = wrap.createDiv({ cls: "eisenhower-header" });
    const headerRow = header.createDiv({ cls: "eisenhower-header-row" });
    headerRow.createEl("h2", { text: "Eisenhower Matrix" });

    const toggleBtn = headerRow.createEl("button", {
      cls: `eisenhower-hide-toggle ${this.hideCompleted ? "active" : ""}`,
      attr: { title: this.hideCompleted ? "Show completed" : "Hide completed" },
    });
    toggleBtn.createSpan({ text: this.hideCompleted ? "👁️‍🗨️" : "👁️" });
    toggleBtn.addEventListener("click", () => {
      this.hideCompleted = !this.hideCompleted;
      this.render();
    });

    /* ── Input area ── */
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

      const done =
        this.plugin.settings.autoCompleteEliminate && quadrant === "eliminate";

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

    /* ── Quadrant grid ── */
    const grid = wrap.createDiv({ cls: "eisenhower-grid" });

    for (const q of QUADRANTS) {
      const quadrantEl = grid.createDiv({
        cls: `eisenhower-quadrant ${q.cls}`,
      });

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
      quadrantEl.addEventListener("drop", async (e) => {
        e.preventDefault();
        this.clearDropHighlights();
        try {
          const transfer = JSON.parse(e.dataTransfer.getData("text/plain"));
          if (transfer.quadrant !== q.tag) {
            await this.plugin.moveTask(
              transfer.quadrant,
              transfer.index,
              q.tag
            );
            await this.render();
          }
        } catch (err) {
          /* ignore bad data */
        }
      });

      /* Quadrant data */
      const tasks = data[q.tag] || [];
      const pending = tasks.filter((t) => !t.done).length;

      /* Title + counter */
      const titleEl = quadrantEl.createDiv({ cls: "quadrant-title" });
      titleEl.createSpan({ text: q.icon });
      titleEl.createSpan({ text: q.title });
      titleEl.createSpan({
        cls: "quadrant-counter",
        text: `(${pending}/${tasks.length})`,
      });

      quadrantEl.createDiv({ cls: "quadrant-subtitle", text: q.subtitle });

      const taskList = quadrantEl.createDiv({ cls: "quadrant-tasks" });

      /* Filter display (hide completed) */
      const displayTasks = this.hideCompleted
        ? tasks.filter((t) => !t.done)
        : tasks;

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
    const today = new Date().toISOString().split("T")[0];
    const isOverdue =
      quadrant === "schedule" && task.date && task.date < today && !task.done;

    const card = parent.createDiv({
      cls: `eisenhower-task ${task.done ? "task-done-row" : ""} ${
        isOverdue ? "task-overdue" : ""
      }`,
    });

    /* Drag & Drop — draggable */
    card.setAttribute("draggable", "true");
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData(
        "text/plain",
        JSON.stringify({ quadrant, index })
      );
      card.classList.add("task-dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("task-dragging");
      this.clearDropHighlights();
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

    /* Date badge / overdue */
    if (quadrant === "schedule" && task.date) {
      if (isOverdue) {
        const badge = topRow.createSpan({ cls: "task-badge badge-overdue" });
        badge.createSpan({ text: "⚠️ " });
        badge.createSpan({ text: this.formatDate(task.date) });
      } else {
        const badge = topRow.createSpan({ cls: "task-badge badge-date" });
        badge.createSpan({ text: "📅 " });
        badge.createSpan({ text: this.formatDate(task.date) });
      }
    }

    if (quadrant === "delegate" && task.person) {
      const badge = topRow.createSpan({ cls: "task-badge badge-person" });
      badge.createSpan({ text: "👤 " });
      badge.createSpan({ text: task.person });
    }

    /* Move menu button */
    const moveBtn = topRow.createSpan({ cls: "task-move", text: "⇄" });
    moveBtn.addEventListener("click", (e) => {
      const menu = new Menu();
      for (const q of QUADRANTS) {
        if (q.tag !== quadrant) {
          menu.addItem((item) => {
            item.setTitle(`${q.icon} ${q.title}`).onClick(async () => {
              await this.plugin.moveTask(quadrant, index, q.tag);
              await this.render();
            });
          });
        }
      }
      menu.showAtMouseEvent(e);
    });

    /* Delete button */
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

    this.addSettingTab(new EisenhowerSettingTab(this.app, this));
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

  async loadData_() {
    const filePath = this.settings.dataFile;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file) {
      return { do: [], schedule: [], delegate: [], eliminate: [] };
    }
    const content = await this.app.vault.read(file);
    return this.parseMarkdown(content);
  }

  async saveData_(data) {
    const filePath = this.settings.dataFile;
    const content = this.toMarkdown(data);
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (file) {
      await this.app.vault.modify(file, content);
    } else {
      await this.app.vault.create(filePath, content);
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

  async moveTask(fromQuadrant, index, toQuadrant) {
    const data = await this.loadData_();
    if (!data[fromQuadrant] || !data[fromQuadrant][index]) return;

    const task = data[fromQuadrant].splice(index, 1)[0];

    if (toQuadrant === "eliminate" && this.settings.autoCompleteEliminate) {
      task.done = true;
    }
    if (fromQuadrant === "eliminate" && this.settings.autoCompleteEliminate) {
      task.done = false;
    }

    if (fromQuadrant === "schedule" && toQuadrant !== "schedule") {
      task.date = null;
    }
    if (fromQuadrant === "delegate" && toQuadrant !== "delegate") {
      task.person = null;
    }

    if (!data[toQuadrant]) data[toQuadrant] = [];
    data[toQuadrant].push(task);

    await this.saveData_(data);
  }
}

module.exports = EisenhowerMatrixPlugin;
