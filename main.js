"use strict";

const { Plugin, ItemView, PluginSettingTab, Setting, Menu, Modal } = require("obsidian");

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
      contentEl.createEl("h3", { text: "📅 Schedule date" });
      contentEl.createEl("p", {
        text: "Select the due date for this task.",
        cls: "eisenhower-modal-desc",
      });

      /* Quick date buttons */
      const quickDatesRow = contentEl.createDiv({ cls: "eisenhower-modal-quick-dates" });
      const addDays = (days) => {
        const d = new Date();
        d.setDate(d.getDate() + days);
        return d.toISOString().split("T")[0];
      };
      const quickDates = [
        { label: "Tomorrow", value: addDays(1) },
        { label: "+7 days", value: addDays(7) },
        { label: "+30 days", value: addDays(30) },
      ];

      const today = new Date().toISOString().split("T")[0];
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
      contentEl.createEl("h3", { text: "👤 Assignee" });
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

  promptAndMoveTask(fromQuadrant, index, toQuadrant) {
    if (toQuadrant === "schedule") {
      new MoveTaskModal(this.app, "schedule", async (meta) => {
        await this.plugin.moveTask(fromQuadrant, index, toQuadrant, meta);
        await this.render();
      }, this.plugin).open();
    } else if (toQuadrant === "delegate") {
      new MoveTaskModal(this.app, "delegate", async (meta) => {
        await this.plugin.moveTask(fromQuadrant, index, toQuadrant, meta);
        await this.render();
      }, this.plugin).open();
    } else {
      this.plugin.moveTask(fromQuadrant, index, toQuadrant).then(() => this.render());
    }
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
    this.dateInput.addEventListener("input", () => {
      this.dateInput.classList.remove("input-error");
      if (this.dateError) this.dateError.classList.add("hidden");
    });

    /* Quick date buttons in main form */
    this.dateQuickBtns = extrasRow.createDiv({ cls: "eisenhower-modal-quick-dates hidden" });
    const addDays = (days) => {
      const d = new Date();
      d.setDate(d.getDate() + days);
      return d.toISOString().split("T")[0];
    };
    const mainQuickDates = [
      { label: "Tomorrow", value: addDays(1) },
      { label: "+7 days", value: addDays(7) },
      { label: "+30 days", value: addDays(30) },
    ];
    for (const qd of mainQuickDates) {
      const qBtn = this.dateQuickBtns.createEl("button", { text: qd.label });
      qBtn.addEventListener("click", () => {
        this.dateInput.value = qd.value;
        this.dateInput.classList.remove("input-error");
        if (this.dateError) this.dateError.classList.add("hidden");
      });
    }

    this.dateError = extrasRow.createDiv({ cls: "eisenhower-modal-error hidden" });

    this.delegateInput = extrasRow.createEl("input", {
      attr: { type: "text", placeholder: "Assignee..." },
      cls: "eisenhower-delegate-input hidden",
    });
    this.delegateInput.addEventListener("input", () => {
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
        if (date < new Date().toISOString().split("T")[0]) {
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
              this.plugin.reorderTask(q.tag, transfer.index, toIndex).then(() => this.render());
            }
          } else {
            this.promptAndMoveTask(transfer.quadrant, transfer.index, q.tag);
          }
        } catch (err) {
          /* ignore bad data */
        }
      });

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
    card.dataset.originalIndex = index;

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

    /* Inline editing on click */
    const textSpan = topRow.createSpan({
      cls: `task-text${task.done ? " done" : ""}`,
      text: task.text,
    });
    textSpan.addEventListener("click", (e) => {
      e.stopPropagation();
      if (task.done) return;
      const currentText = task.text;
      const editInput = document.createElement("input");
      editInput.type = "text";
      editInput.value = currentText;
      editInput.className = "task-text-editing";
      textSpan.replaceWith(editInput);
      editInput.focus();
      editInput.select();
      let saved = false;
      const save = async () => {
        if (saved) return;
        saved = true;
        const newText = editInput.value.trim();
        if (newText && newText !== currentText) {
          await this.plugin.updateTaskText(quadrant, index, newText);
        }
        await this.render();
      };
      const cancel = () => {
        if (saved) return;
        saved = true;
        this.render();
      };
      editInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); save(); }
        if (ev.key === "Escape") { ev.preventDefault(); cancel(); }
      });
      editInput.addEventListener("blur", save);
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
            item.setTitle(`${q.icon} ${q.title}`).onClick(() => {
              this.promptAndMoveTask(quadrant, index, q.tag);
            });
          });
        }
      }
      menu.showAtMouseEvent(e);
    });

    /* Delete button with confirmation */
    const del = topRow.createSpan({ cls: "task-delete", text: "✕" });
    del.addEventListener("click", (e) => {
      const menu = new Menu();
      menu.addItem((item) => {
        item
          .setTitle("Delete task")
          .setIcon("trash")
          .onClick(async () => {
            await this.plugin.removeTask(quadrant, index);
            await this.render();
          });
      });
      menu.showAtMouseEvent(e);
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

  async updateTaskText(quadrant, index, newText) {
    const data = await this.loadData_();
    if (data[quadrant] && data[quadrant][index]) {
      data[quadrant][index].text = newText;
      await this.saveData_(data);
    }
  }

  async reorderTask(quadrant, fromIndex, toIndex) {
    const data = await this.loadData_();
    if (!data[quadrant]) return;
    const tasks = data[quadrant];
    if (fromIndex < 0 || fromIndex >= tasks.length) return;
    const [task] = tasks.splice(fromIndex, 1);
    const insertAt = fromIndex < toIndex ? toIndex - 1 : toIndex;
    tasks.splice(insertAt, 0, task);
    await this.saveData_(data);
  }

  async moveTask(fromQuadrant, index, toQuadrant, meta) {
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

    if (meta && meta.date) task.date = meta.date;
    if (meta && meta.person) task.person = meta.person;

    if (!data[toQuadrant]) data[toQuadrant] = [];
    data[toQuadrant].push(task);

    await this.saveData_(data);
  }
}

module.exports = EisenhowerMatrixPlugin;
