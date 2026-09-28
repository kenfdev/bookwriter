import "./styles.css";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import {
  createNode,
  deleteNode,
  isTrash,
  loadBook,
  manuscriptNodes,
  moveNode,
  saveBookTitle,
  saveNode,
  type Book,
  type DropZone,
} from "./book";
import { COMMANDS, applyCommand, latestLanguage, type CommandId } from "./commands";
import { exportBook } from "./export";
import { findNode, nodeWordCount, slugify, walk, type Header, type Status, type TreeNode } from "./model";
import { renderGroup, renderSection } from "./preview";
import { startupBookPath, tauriFs } from "./tauriFs";

const fs = tauriFs;
const bookTitle = document.querySelector<HTMLInputElement>("#book-title")!;
const saveState = document.querySelector<HTMLElement>("#save-state")!;
const warningsEl = document.querySelector<HTMLElement>("#warnings")!;
const outlineEl = document.querySelector<HTMLElement>("#outline")!;
const inspector = document.querySelector<HTMLFormElement>("#inspector")!;
const fieldTitle = document.querySelector<HTMLInputElement>("#field-title")!;
const fieldSynopsis = document.querySelector<HTMLTextAreaElement>("#field-synopsis")!;
const fieldStatus = document.querySelector<HTMLSelectElement>("#field-status")!;
const fieldRole = document.querySelector<HTMLSelectElement>("#field-role")!;
const fieldId = document.querySelector<HTMLElement>("#field-id")!;
const editProse = document.querySelector<HTMLButtonElement>("#btn-edit-prose")!;
const readGroup = document.querySelector<HTMLButtonElement>("#btn-read")!;
const editorHost = document.querySelector<HTMLElement>("#editor-host")!;
const readingEl = document.querySelector<HTMLElement>("#reading")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;
const workspace = document.querySelector<HTMLElement>(".workspace")!;
const palette = document.querySelector<HTMLElement>("#palette")!;
const paletteInput = document.querySelector<HTMLInputElement>("#palette-input")!;
const paletteList = document.querySelector<HTMLUListElement>("#palette-list")!;
const reminder = document.querySelector<HTMLElement>("#reminder")!;
const reminderRows = document.querySelector<HTMLElement>("#reminder-rows")!;
const createDialog = document.querySelector<HTMLDialogElement>("#create-dialog")!;
const contextMenu = document.querySelector<HTMLElement>("#context-menu")!;
const createLabel = document.querySelector<HTMLElement>("#create-label")!;
const createTitle = document.querySelector<HTMLInputElement>("#create-title")!;

let book: Book | null = null;
let selectedId: string | null = null;
const collapsed = new Set<string>();
let editingProse = false;
let previewOn = true;
let dirty = false;
let suppress = false;
let saveTimer = 0;
let paletteIndex = 0;

const editor = new EditorView({
  parent: editorHost,
  state: EditorState.create({
    doc: "",
    extensions: [
      history(),
      keymap.of([
        { key: "Mod-b", run: () => (runCommand("strong"), true) },
        { key: "Mod-i", run: () => (runCommand("emphasis"), true) },
        { key: "Mod-e", run: () => (runCommand("inline-code"), true) },
        ...historyKeymap,
        ...defaultKeymap,
      ]),
      markdown({ codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ spellcheck: "true" }),
      EditorView.theme({
        "&": { backgroundColor: "#fbf8f2", height: "100%" },
        ".cm-content": { caretColor: "#241f1a" },
        "&.cm-focused": { outline: "none" },
        ".cm-activeLine": { backgroundColor: "rgba(110, 75, 42, 0.04)" },
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || suppress) return;
        dirty = true;
        saveState.textContent = "Unsaved";
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => void flush(), 400);
        drawPreview();
        paintWordCount();
      }),
    ],
  }),
});

function selected(): { node: TreeNode; ancestors: TreeNode[] } | null {
  if (!book || !selectedId) return null;
  return findNode(book.nodes, selectedId);
}

function editing(): boolean {
  const current = selected();
  if (!current) return false;
  return current.node.kind === "section" || editingProse;
}

function headerFromForm(node: TreeNode): Header {
  return {
    id: node.header.id,
    title: fieldTitle.value,
    synopsis: fieldSynopsis.value,
    status: fieldStatus.value as Status,
    role: fieldRole.value === "front" ? "front" : "body",
  };
}

function setDoc(body: string): void {
  suppress = true;
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: body },
  });
  suppress = false;
  dirty = false;
}

async function flush(): Promise<void> {
  const current = selected();
  if (!book || !current || !dirty) return;
  const body = editing() ? editor.state.doc.toString() : current.node.body;
  await saveNode(fs, current.node, headerFromForm(current.node), body);
  dirty = false;
  saveState.textContent = "Saved";
  paintWordCount();
}

function showWarnings(lines: string[]): void {
  const unique = [...new Set(lines.filter(Boolean))];
  warningsEl.hidden = unique.length === 0;
  warningsEl.textContent = unique.join(" ");
}

function paintWordCount(): void {
  const current = selected();
  if (!current) return;
  const row = outlineEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(current.node.header.id)}"] .meta`);
  if (!row) return;
  const copy = { ...current.node, body: editing() ? editor.state.doc.toString() : current.node.body };
  row.textContent = `${copy.header.status} · ${nodeWordCount(copy)} words`;
}

function drawPreview(): void {
  const current = selected();
  previewEl.hidden = !previewOn || !editing();
  workspace.classList.toggle("preview-off", previewEl.hidden);
  if (!current || !editing()) {
    previewEl.innerHTML = "";
    return;
  }
  const node = { ...current.node, body: editor.state.doc.toString(), children: current.node.children };
  const rendered = renderSection(node, current.ancestors);
  previewEl.innerHTML = rendered.html;
  showWarnings([...(book?.warnings ?? []), ...rendered.warnings]);
}

function drawReading(): void {
  const current = selected();
  if (!current || editing() || isTrash(current.node)) {
    readingEl.hidden = true;
    readingEl.innerHTML = "";
    editorHost.hidden = !editing();
    return;
  }
  editorHost.hidden = true;
  readingEl.hidden = false;
  const rendered = renderGroup(current.node, current.ancestors);
  readingEl.innerHTML = rendered.html;
  showWarnings([...(book?.warnings ?? []), ...rendered.warnings]);
}

function renderOutline(): void {
  outlineEl.replaceChildren();
  if (!book) return;
  const draw = (nodes: TreeNode[], depth: number) => {
    for (const node of nodes) {
      const row = document.createElement("div");
      row.className =
        `node ${node.kind}` +
        (isTrash(node) ? " trash" : "") +
        (node.header.id === selectedId ? " selected" : "");
      row.dataset.id = node.header.id;
      row.draggable = !isTrash(node);
      row.style.paddingLeft = `${0.35 + depth * 0.85}rem`;
      const body = document.createElement("div");
      body.className = "node-body";
      if (node.kind === "group") {
        const open = !collapsed.has(node.header.id);
        const twist = document.createElement("button");
        twist.type = "button";
        twist.className = "twist";
        twist.textContent = open ? "▾" : "▸";
        twist.setAttribute("aria-expanded", String(open));
        twist.setAttribute("aria-label", open ? "Collapse folder" : "Expand folder");
        twist.addEventListener("click", (event) => {
          event.stopPropagation();
          if (collapsed.has(node.header.id)) collapsed.delete(node.header.id);
          else collapsed.add(node.header.id);
          renderOutline();
        });
        row.append(twist);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "twist-spacer";
        row.append(spacer);
      }
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = node.header.title || node.slug;
      const meta = document.createElement("span");
      meta.className = "meta";
      meta.textContent = `${node.header.status} · ${nodeWordCount(node)} words`;
      body.append(title, meta);
      if (node.header.synopsis) {
        const synopsis = document.createElement("span");
        synopsis.className = "synopsis";
        synopsis.textContent = node.header.synopsis;
        body.append(synopsis);
      }
      row.append(body);
      row.addEventListener("click", () => void choose(node.header.id, false));
      row.addEventListener("contextmenu", (event) => {
        const found = book ? findNode(book.nodes, node.header.id) : null;
        if (found) showContextMenu(event, found.node, found.ancestors);
      });
      row.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", node.header.id);
        event.dataTransfer!.effectAllowed = "move";
      });
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        row.classList.remove("drop-before", "drop-after", "drop-inside");
        row.classList.add(dropClass(row, event.clientY, node.kind === "group"));
      });
      row.addEventListener("dragleave", () => row.classList.remove("drop-before", "drop-after", "drop-inside"));
      row.addEventListener("drop", (event) => {
        event.preventDefault();
        const zone = dropZone(row, event.clientY, node.kind === "group");
        row.classList.remove("drop-before", "drop-after", "drop-inside");
        const moving = event.dataTransfer?.getData("text/plain");
        if (moving) void drop(moving, node.header.id, zone);
      });
      outlineEl.append(row);
      if (node.kind === "group" && !collapsed.has(node.header.id)) draw(node.children, depth + 1);
    }
  };
  draw(book.nodes, 0);
}

function dropClass(row: HTMLElement, clientY: number, group: boolean): string {
  return `drop-${dropZone(row, clientY, group)}`;
}

function dropZone(row: HTMLElement, clientY: number, group: boolean): DropZone {
  const rect = row.getBoundingClientRect();
  const ratio = (clientY - rect.top) / rect.height;
  if (group && ratio > 0.28 && ratio < 0.72) return "inside";
  return ratio < 0.5 ? "before" : "after";
}

function fillInspector(): void {
  const current = selected();
  inspector.hidden = !current;
  if (!current) return;
  fieldTitle.value = current.node.header.title;
  fieldSynopsis.value = current.node.header.synopsis;
  fieldStatus.value = current.node.header.status;
  fieldRole.value = current.node.header.role;
  fieldId.textContent = current.node.header.id;
  const trash = isTrash(current.node);
  fieldTitle.disabled = trash;
  fieldSynopsis.disabled = trash;
  fieldStatus.disabled = trash;
  fieldRole.disabled = trash;
  const group = current.node.kind === "group";
  editProse.hidden = trash || !group || editingProse;
  readGroup.hidden = trash || !group || !editingProse;
}

async function choose(id: string, prose: boolean): Promise<void> {
  await flush();
  selectedId = id;
  editingProse = prose;
  const current = selected();
  if (current && editing()) setDoc(current.node.body);
  renderOutline();
  fillInspector();
  drawReading();
  drawPreview();
  if (editing()) editor.focus();
}

async function refresh(keep: string | null): Promise<void> {
  if (!book) return;
  book = await loadBook(fs, book.root);
  if (keep && findNode(book.nodes, keep)) selectedId = keep;
  else selectedId = book.nodes[0]?.header.id ?? null;
  bookTitle.value = book.title;
  const current = selected();
  if (current && editing()) setDoc(current.node.body);
  renderOutline();
  fillInspector();
  drawReading();
  drawPreview();
  showWarnings(book.warnings);
}

async function openRoot(root: string): Promise<void> {
  book = await loadBook(fs, root);
  selectedId = book.nodes[0]?.header.id ?? null;
  editingProse = false;
  bookTitle.value = book.title;
  document.title = book.title || "Bookwriter";
  saveState.textContent = "Saved";
  await refresh(selectedId);
}

async function openFolder(): Promise<void> {
  const picked = await open({ directory: true, title: "Open book" });
  if (typeof picked === "string") await openRoot(picked);
}

async function exportManuscript(): Promise<void> {
  if (!book) return;
  await flush();
  book = await loadBook(fs, book.root);
  const destination = await save({
    title: "Export manuscript",
    defaultPath: `${slugify(book.title) || "manuscript"}.md`,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (typeof destination !== "string") return;
  const result = exportBook(manuscriptNodes(book.nodes));
  const text = result.markdown.endsWith("\n") ? result.markdown : result.markdown + "\n";
  await fs.writeText(destination, text);
  showWarnings(result.warnings);
  saveState.textContent = result.warnings.length ? "Exported with warnings" : "Exported";
}

createDialog.addEventListener("click", (event) => {
  if (event.target === createDialog && createDialog.open) createDialog.close("cancel");
});

function askTitle(label: string): Promise<string | null> {
  createLabel.textContent = label;
  createTitle.value = "";
  createDialog.showModal();
  createTitle.focus();
  return new Promise((resolve) => {
    createDialog.addEventListener(
      "close",
      () => resolve(createDialog.returnValue === "ok" ? createTitle.value.trim() : null),
      { once: true },
    );
  });
}

function closeContextMenu(): void {
  contextMenu.hidden = true;
  contextMenu.replaceChildren();
}

function showContextMenu(event: MouseEvent, node: TreeNode, ancestors: TreeNode[]): void {
  event.preventDefault();
  const inTrash = isTrash(node) || ancestors.some(isTrash);
  const actions: { label: string; run: () => Promise<void> }[] = [];
  if (node.kind === "group") {
    actions.push({ label: "Add text", run: () => addInside(node.header.id, "section") });
    actions.push({ label: "Add folder", run: () => addInside(node.header.id, "group") });
  } else {
    actions.push({ label: "Add text", run: () => addTextBelow(node.header.id) });
  }
  if (!inTrash) actions.push({ label: "Delete", run: () => deleteItem(node.header.id) });
  contextMenu.replaceChildren();
  for (const action of actions) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = action.label;
    button.addEventListener("click", (click) => {
      click.stopPropagation();
      closeContextMenu();
      void action.run();
    });
    contextMenu.append(button);
  }
  contextMenu.hidden = false;
  contextMenu.style.left = `${event.clientX}px`;
  contextMenu.style.top = `${event.clientY}px`;
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) contextMenu.style.left = `${Math.max(8, event.clientX - rect.width)}px`;
  if (rect.bottom > window.innerHeight) contextMenu.style.top = `${Math.max(8, event.clientY - rect.height)}px`;
}

async function addInside(parentId: string, kind: "group" | "section"): Promise<void> {
  if (!book) return;
  const title = await askTitle(kind === "group" ? "New folder" : "New text");
  if (!title) return;
  await flush();
  const id = await createNode(fs, book, parentId, kind, title);
  collapsed.delete(parentId);
  editingProse = kind === "group";
  await refresh(id);
  await choose(id, kind === "group");
}

async function addTextBelow(sectionId: string): Promise<void> {
  if (!book) return;
  const title = await askTitle("New text");
  if (!title) return;
  await flush();
  const found = findNode(book.nodes, sectionId);
  if (!found) return;
  const parent = found.ancestors.at(-1);
  const id = await createNode(fs, book, parent?.header.id ?? null, "section", title);
  book = await loadBook(fs, book.root);
  await moveNode(fs, book, id, sectionId, "after");
  if (parent) collapsed.delete(parent.header.id);
  editingProse = false;
  await refresh(id);
  await choose(id, false);
}

async function deleteItem(id: string): Promise<void> {
  if (!book) return;
  const current = findNode(book.nodes, id);
  if (!current || isTrash(current.node) || current.ancestors.some(isTrash)) return;
  if (selectedId === id) await flush();
  const next =
    [...current.ancestors].reverse().find((node) => !isTrash(node))?.header.id ??
    manuscriptNodes(book.nodes)[0]?.header.id ??
    null;
  await deleteNode(fs, book, id);
  if (selectedId === id) editingProse = false;
  await refresh(selectedId === id ? next : selectedId);
}

async function create(kind: "group" | "section"): Promise<void> {
  if (!book) return;
  const title = await askTitle(kind === "group" ? "New folder" : "New text");
  if (!title) return;
  await flush();
  const current = selected();
  const underTrash = current ? isTrash(current.node) || current.ancestors.some(isTrash) : false;
  let parentId: string | null = null;
  if (!underTrash && current?.node.kind === "group") parentId = current.node.header.id;
  else if (!underTrash && current) parentId = current.ancestors.at(-1)?.header.id ?? null;
  const id = await createNode(fs, book, parentId, kind, title);
  editingProse = kind === "group";
  await refresh(id);
  await choose(id, kind === "group");
}

async function deleteSelected(): Promise<void> {
  if (selectedId) await deleteItem(selectedId);
}

async function drop(movingId: string, targetId: string, zone: DropZone): Promise<void> {
  if (!book || movingId === targetId) return;
  await flush();
  await moveNode(fs, book, movingId, targetId, zone);
  await refresh(movingId);
}

function runCommand(id: CommandId): void {
  if (!editing()) return;
  const range = editor.state.selection.main;
  const bodies: string[] = [];
  if (book) {
    walk(book.nodes, (node) => {
      bodies.push(node.header.id === selectedId ? editor.state.doc.toString() : node.body);
    });
  }
  const result = applyCommand(id, editor.state.doc.toString(), range.anchor, range.head, latestLanguage(bodies));
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: result.text },
    selection: { anchor: result.anchor, head: result.head },
  });
  editor.focus();
}

function matchingCommands(): typeof COMMANDS {
  const query = paletteInput.value.trim().toLowerCase();
  return COMMANDS.filter((command) => command.name.toLowerCase().includes(query));
}

function drawPalette(): void {
  const matches = matchingCommands();
  if (paletteIndex >= matches.length) paletteIndex = 0;
  paletteList.replaceChildren();
  matches.forEach((command, index) => {
    const item = document.createElement("li");
    item.textContent = command.accelerator ? `${command.name}  ${command.inserts}` : `${command.name}  ${command.inserts}`;
    if (index === paletteIndex) item.className = "active";
    item.addEventListener("mousedown", (event) => {
      event.preventDefault();
      closePalette();
      runCommand(command.id);
    });
    paletteList.append(item);
  });
}

function openPalette(): void {
  palette.hidden = false;
  paletteInput.value = "";
  paletteIndex = 0;
  drawPalette();
  paletteInput.focus();
}

function closePalette(): void {
  palette.hidden = true;
}

function openReminder(): void {
  reminderRows.replaceChildren();
  for (const command of COMMANDS) {
    const row = document.createElement("tr");
    const name = document.createElement("td");
    name.textContent = command.accelerator ? `${command.name}` : command.name;
    const inserts = document.createElement("td");
    inserts.textContent = command.inserts;
    row.append(name, inserts);
    reminderRows.append(row);
  }
  reminder.hidden = false;
}

async function installMenu(): Promise<void> {
  const formatItems = await Promise.all(
    COMMANDS.map((command) =>
      MenuItem.new({
        id: command.id,
        text: command.name,
        accelerator: command.accelerator,
        action: () => runCommand(command.id),
      }),
    ),
  );
  const menu = await Menu.new({
    items: [
      await Submenu.new({
        text: "Bookwriter",
        items: [
          await PredefinedMenuItem.new({ item: "Hide" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Quit" }),
        ],
      }),
      await Submenu.new({
        text: "File",
        items: [
          await MenuItem.new({ id: "open", text: "Open Book…", accelerator: "CmdOrCtrl+O", action: () => void openFolder() }),
          await MenuItem.new({ id: "export", text: "Export Manuscript…", accelerator: "CmdOrCtrl+Shift+E", action: () => void exportManuscript() }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({ id: "new-section", text: "Text", action: () => void create("section") }),
          await MenuItem.new({ id: "new-group", text: "Folder", action: () => void create("group") }),
          await MenuItem.new({ id: "delete", text: "Delete", action: () => void deleteSelected() }),
        ],
      }),
      await Submenu.new({
        text: "Edit",
        items: [
          await PredefinedMenuItem.new({ item: "Undo" }),
          await PredefinedMenuItem.new({ item: "Redo" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Cut" }),
          await PredefinedMenuItem.new({ item: "Copy" }),
          await PredefinedMenuItem.new({ item: "Paste" }),
          await PredefinedMenuItem.new({ item: "SelectAll" }),
        ],
      }),
      await Submenu.new({ text: "Format", items: formatItems }),
      await Submenu.new({
        text: "View",
        items: [
          await MenuItem.new({ id: "palette", text: "Command Palette", accelerator: "CmdOrCtrl+K", action: openPalette }),
          await MenuItem.new({ id: "reminder", text: "Markup", action: openReminder }),
          await MenuItem.new({
            id: "preview",
            text: "Preview",
            accelerator: "CmdOrCtrl+Shift+P",
            action: () => document.querySelector<HTMLButtonElement>("#btn-preview")!.click(),
          }),
        ],
      }),
    ],
  });
  await menu.setAsAppMenu();
}

document.querySelector("#btn-open")!.addEventListener("click", () => void openFolder());
document.querySelector("#btn-export")!.addEventListener("click", () => void exportManuscript());
document.querySelector("#btn-new-section")!.addEventListener("click", () => void create("section"));
document.querySelector("#btn-new-group")!.addEventListener("click", () => void create("group"));
document.querySelector("#btn-delete")!.addEventListener("click", () => void deleteSelected());
document.querySelector("#btn-preview")!.addEventListener("click", (event) => {
  previewOn = !previewOn;
  (event.currentTarget as HTMLButtonElement).setAttribute("aria-pressed", String(previewOn));
  drawPreview();
});
document.querySelector("#btn-palette")!.addEventListener("click", openPalette);
document.querySelector("#btn-reminder")!.addEventListener("click", openReminder);
document.querySelector("#reminder-close")!.addEventListener("click", () => {
  reminder.hidden = true;
});
editProse.addEventListener("click", () => {
  if (selectedId) void choose(selectedId, true);
});
readGroup.addEventListener("click", () => {
  if (selectedId) void choose(selectedId, false);
});

for (const field of [fieldTitle, fieldSynopsis, fieldStatus, fieldRole]) {
  field.addEventListener("change", () => {
    dirty = true;
    void flush().then(() => {
      const current = selected();
      if (!current) return;
      const row = outlineEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(current.node.header.id)}"] .title`);
      if (row) row.textContent = current.node.header.title || current.node.slug;
      paintWordCount();
      const synopsis = outlineEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(current.node.header.id)}"] .synopsis`);
      if (synopsis) synopsis.textContent = current.node.header.synopsis;
      drawPreview();
      drawReading();
    });
  });
}

bookTitle.addEventListener("change", () => {
  if (!book) return;
  void saveBookTitle(fs, book, bookTitle.value).then(() => {
    document.title = bookTitle.value || "Bookwriter";
  });
});

paletteInput.addEventListener("input", () => {
  paletteIndex = 0;
  drawPalette();
});
paletteInput.addEventListener("keydown", (event) => {
  const matches = matchingCommands();
  if (event.key === "ArrowDown") {
    paletteIndex = Math.min(matches.length - 1, paletteIndex + 1);
    drawPalette();
    event.preventDefault();
  } else if (event.key === "ArrowUp") {
    paletteIndex = Math.max(0, paletteIndex - 1);
    drawPalette();
    event.preventDefault();
  } else if (event.key === "Enter") {
    const command = matches[paletteIndex];
    closePalette();
    if (command) runCommand(command.id);
    event.preventDefault();
  } else if (event.key === "Escape") closePalette();
});

document.addEventListener("keydown", (event) => {
  const meta = event.metaKey || event.ctrlKey;
  if (meta && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (palette.hidden) openPalette();
    else closePalette();
  } else if (meta && event.key.toLowerCase() === "s") {
    event.preventDefault();
    dirty = true;
    void flush();
  } else if (event.key === "Escape") {
    reminder.hidden = true;
    closeContextMenu();
  }
});

document.addEventListener("pointerdown", (event) => {
  if (contextMenu.hidden) return;
  if (event.target instanceof Node && contextMenu.contains(event.target)) return;
  closeContextMenu();
});
document.querySelector(".outline-column")!.addEventListener("scroll", closeContextMenu);

void installMenu().catch((error: unknown) => {
  showWarnings([`The menu bar could not be installed. ${String(error)}`]);
});

void startupBookPath()
  .then((path) => openRoot(path))
  .catch((error: unknown) => {
    saveState.textContent = "Open a book";
    showWarnings([String(error)]);
  });
