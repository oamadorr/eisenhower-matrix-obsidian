# Eisenhower Matrix — Obsidian Plugin

Organize your tasks using the **Eisenhower Matrix** directly inside [Obsidian](https://obsidian.md). Prioritize by urgency and importance across 4 quadrants.

## Features

- **4 Quadrants** — Do Now, Schedule, Delegate, Eliminate
- **Toggle-based input** — flip Urgent/Important switches and the task goes to the right quadrant automatically
- **Smart fields** — Schedule tasks prompt for a date; Delegate tasks prompt for an assignee
- **Markdown persistence** — all data is saved as a readable `.md` file in your vault
- **Mobile friendly** — works on desktop and mobile

## How to Use

1. Open the Eisenhower Matrix from the ribbon icon (grid icon) or via the command palette (`Open Eisenhower Matrix`)
2. Type a task in the input field
3. Toggle **Urgent** and/or **Important** to select the target quadrant
4. Click **Add** (or press Enter)
5. Check off tasks when done, or click ✕ to remove them

## Quadrants

| Quadrant | Urgent | Important | Action |
|----------|--------|-----------|--------|
| 🔴 Do Now | ✅ | ✅ | Execute immediately |
| 🔵 Schedule | ❌ | ✅ | Plan a date |
| 🟡 Delegate | ✅ | ❌ | Assign to someone |
| ⚫ Eliminate | ❌ | ❌ | Drop or defer |

## Screenshot

<!-- TODO: Add screenshot -->

## Installation

### From Community Plugins (pending approval)

1. Open **Settings → Community plugins → Browse**
2. Search for "Eisenhower Matrix"
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `manifest.json`, and `styles.css` from the [latest release](https://github.com/oamadorr/eisenhower-matrix-obsidian/releases)
2. Create a folder `.obsidian/plugins/eisenhower-matrix/` in your vault
3. Copy the 3 files into that folder
4. Enable the plugin in **Settings → Community plugins**

## License

[MIT](LICENSE)
