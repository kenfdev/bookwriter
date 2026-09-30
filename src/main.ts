import "./styles.css";
import { defaultKeymap, history, historyKeymap, redo, redoDepth, undo, undoDepth } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { findNext, findPrevious, getSearchQuery, openSearchPanel, search, searchKeymap, setSearchQuery } from "@codemirror/search";
import { EditorSelection, EditorState, Transaction } from "@codemirror/state";
import { EditorView, keymap, type Command } from "@codemirror/view";
import { convertFileSrc } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
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
import { nextMatch, previousMatch, type FindPart } from "./find";
import { exportPdfWithPictures } from "./pdf";
import { rasterizePicture } from "./rasterize";
import { formatAccelerator } from "./keys";
import { blockAtLine, lineOffset, offsetFraction, scrollToSpot, sourceOffset } from "./locate";
import { divisionLabel, divisions, effectiveUnit, findNode, nodeWordCount, slugify, UNITS, walk, type Division, type Header, type Status, type TreeNode, type Unit } from "./model";
import { joinPath, parentPath } from "./path";
import { PICTURE_EXTENSIONS, placePicture, resolvePictureSources } from "./pictures";
import { renderBook, renderGroup, renderSection } from "./preview";
import { clampPreviewWidth, previewWidthFromPointer } from "./split";
import { allowBook, startupBookPath, tauriFs } from "./tauriFs";
import { dropRedo, emptyTrail, historyStep, noteVisit, redoVisit, undoVisit } from "./trail";

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
const unitInputs = [...document.querySelectorAll<HTMLInputElement>('#inspector input[name="unit"]')];
const fieldId = document.querySelector<HTMLElement>("#field-id")!;
const editProse = document.querySelector<HTMLButtonElement>("#btn-edit-prose")!;
const readGroup = document.querySelector<HTMLButtonElement>("#btn-read")!;
const editorHost = document.querySelector<HTMLElement>("#editor-host")!;
const readingEl = document.querySelector<HTMLElement>("#reading")!;
const previewEl = document.querySelector<HTMLElement>("#preview")!;
const paneSplit = document.querySelector<HTMLElement>("#pane-split")!;
const outlineColumn = document.querySelector<HTMLElement>(".outline-column")!;
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
/** Outline row for the whole manuscript. Not a node id. */
const BOOK_ID = "\u0000book";

let selectedId: string | null = null;
const collapsed = new Set<string>();
let editingProse = false;
let previewOn = true;
let dirty = false;
let suppress = false;
let navigating = false;
let saveTimer = 0;
let paletteIndex = 0;
let pendingHistory: "undo" | "redo" | null = null;
let historyBusy = false;

type Visit = { id: string; prose: boolean; state: EditorState | null };
let trail = emptyTrail<Visit>();

function inMarkup(command: Command): Command {
  return (view) => editing() && command(view);
}

/** Survives a new editor state when Find Next opens another text. */
let searchWholeBook = false;

/** Find Next and Find Previous follow the whole-book checkbox. Other search commands stay as they are. */
function bookSearch(command: Command): Command {
  return (view) => {
    if (searchWholeBook && command === findNext) {
      void findInBook("next");
      return true;
    }
    if (searchWholeBook && command === findPrevious) {
      void findInBook("previous");
      return true;
    }
    const ran = command(view);
    if (ran) wireBookFind(view);
    return ran;
  };
}

const editorExtensions = [
  history(),
  search({ top: true }),
  keymap.of([
    { key: "Mod-b", run: () => (runCommand("strong"), true) },
    { key: "Mod-i", run: () => (runCommand("emphasis"), true) },
    { key: "Mod-e", run: () => (runCommand("inline-code"), true) },
    { key: "Mod-z", run: () => requestHistory("undo"), preventDefault: true },
    { key: "Mod-y", mac: "Mod-Shift-z", run: () => requestHistory("redo"), preventDefault: true },
    { linux: "Ctrl-Shift-z", run: () => requestHistory("redo"), preventDefault: true },
    ...searchKeymap.map((binding) => ({
      ...binding,
      run: binding.run ? inMarkup(bookSearch(binding.run)) : undefined,
      shift: binding.shift ? inMarkup(bookSearch(binding.shift)) : undefined,
    })),
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
    // Find Next and Find Previous mark the selection with this event. Select-all uses a longer name.
    if (update.transactions.some((tr) => tr.annotation(Transaction.userEvent) === "select.search")) {
      scrollPreviewToCursor();
    }
    if (!update.docChanged || suppress) return;
    const motion = update.transactions.some((tr) => {
      const event = tr.annotation(Transaction.userEvent);
      return event === "undo" || event === "redo";
    });
    if (!motion) trail = dropRedo(trail);
    dirty = true;
    if (navigating) return;
    saveState.textContent = "Unsaved";
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void flush(), 400);
    drawPreview();
    paintWordCount();
  }),
];

const editor = new EditorView({
  parent: editorHost,
  state: EditorState.create({ doc: "", extensions: editorExtensions }),
});

function viewingBook(): boolean {
  return selectedId === BOOK_ID;
}

function selectable(id: string): boolean {
  return id === BOOK_ID || (!!book && !!findNode(book.nodes, id));
}

function selected(): { node: TreeNode; ancestors: TreeNode[] } | null {
  if (!book || !selectedId || viewingBook()) return null;
  return findNode(book.nodes, selectedId);
}

function editing(): boolean {
  const current = selected();
  if (!current) return false;
  return current.node.kind === "section" || editingProse;
}

function selectedUnit(): Unit {
  const picked = unitInputs.find((input) => input.checked)?.value;
  if (picked && (UNITS as readonly string[]).includes(picked)) return picked as Unit;
  return "text";
}

function headerFromForm(node: TreeNode): Header {
  return {
    id: node.header.id,
    title: fieldTitle.value,
    synopsis: fieldSynopsis.value,
    status: fieldStatus.value as Status,
    role: fieldRole.value === "front" ? "front" : "body",
    unit: selectedUnit(),
  };
}

function cancelSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = 0;
}

function loadDocument(body: string, resetHistory: boolean): void {
  if (!resetHistory && editor.state.doc.toString() === body) return;
  suppress = true;
  if (resetHistory) editor.setState(EditorState.create({ doc: body, extensions: editorExtensions }));
  else editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: body } });
  suppress = false;
  dirty = false;
}

function takeVisit(): Visit | null {
  if (!selectedId) return null;
  return { id: selectedId, prose: editingProse, state: editing() ? editor.state : null };
}

function showCurrent(): void {
  renderOutline();
  fillInspector();
  drawReading();
  drawPreview();
  paintWordCount();
  if (editing()) editor.focus();
}

async function flush(): Promise<void> {
  cancelSave();
  const current = selected();
  if (!book || !current || !dirty) return;
  const body = editing() ? editor.state.doc.toString() : current.node.body;
  await saveNode(fs, current.node, headerFromForm(current.node), body);
  dirty = false;
  saveState.textContent = "Saved";
  paintWordCount();
}

function requestHistory(kind: "undo" | "redo"): boolean {
  if (activeField()) return true;
  if (pendingHistory) return true;
  pendingHistory = kind;
  queueMicrotask(() => {
    const which = pendingHistory;
    pendingHistory = null;
    if (which === "undo") void stepHistory("undo");
    else if (which === "redo") void stepHistory("redo");
  });
  return true;
}

function menuHistory(kind: "undo" | "redo"): void {
  if (activeField()) {
    document.execCommand(kind);
    return;
  }
  requestHistory(kind);
}

// A section change is an undo step of its own. Undoing it selects the section
// you left and restores the text there, rather than writing that text here.
async function stepHistory(kind: "undo" | "redo"): Promise<void> {
  if (historyBusy) return;
  const local = editing() ? (kind === "undo" ? undoDepth(editor.state) : redoDepth(editor.state)) : 0;
  const switches = kind === "undo" ? trail.undo.length : trail.redo.length;
  const step = historyStep(local, switches);
  if (step === "local") {
    if (kind === "undo") undo(editor);
    else redo(editor);
    return;
  }
  if (step === "none") return;
  const here = takeVisit();
  if (!here || !book) return;
  const moved = kind === "undo" ? undoVisit(trail, here) : redoVisit(trail, here);
  if (!moved || !selectable(moved.to.id)) return;
  trail = moved.trail;
  historyBusy = true;
  try {
    await land(moved.to);
  } finally {
    historyBusy = false;
  }
}

async function land(visit: Visit): Promise<void> {
  navigating = true;
  try {
    cancelSave();
    await flush();
    if (dirty) await flush();
    if (!book || !selectable(visit.id)) return;
    selectedId = visit.id;
    editingProse = visit.prose;
    if (visit.state) {
      suppress = true;
      editor.setState(visit.state);
      suppress = false;
    } else {
      const current = selected();
      loadDocument(current && editing() ? current.node.body : "", true);
    }
    const current = selected();
    if (current && editing() && current.node.body !== editor.state.doc.toString()) {
      dirty = true;
      await flush();
    } else {
      dirty = false;
      saveState.textContent = "Saved";
    }
  } finally {
    navigating = false;
  }
  showCurrent();
}

function showPictures(html: string): string {
  if (!book) return html;
  const root = book.root;
  return resolvePictureSources(html, (relative) => convertFileSrc(joinPath(root, relative)));
}

function paintViewToggle(): void {
  const button = document.querySelector<HTMLButtonElement>("#btn-preview")!;
  button.textContent = previewOn ? "Markup" : "Preview";
  button.setAttribute("aria-pressed", String(previewOn));
}

function placeCursor(offset: number): void {
  const pos = Math.max(0, Math.min(offset, editor.state.doc.length));
  editor.dispatch({
    selection: { anchor: pos, head: pos },
    scrollIntoView: true,
  });
  editor.focus();
}

function elementAt(target: EventTarget | null): Element | null {
  if (target instanceof Element) return target;
  if (target instanceof Node) return target.parentElement;
  return null;
}

function fractionAt(block: HTMLElement, x: number, y: number): number {
  const doc = block.ownerDocument as Document & {
    caretRangeFromPoint?: (px: number, py: number) => Range | null;
    caretPositionFromPoint?: (px: number, py: number) => { offsetNode: Node; offset: number } | null;
  };
  const total = block.textContent?.length ?? 0;
  const range = doc.caretRangeFromPoint?.(x, y);
  const point = range ? null : doc.caretPositionFromPoint?.(x, y);
  const node = range?.startContainer ?? point?.offsetNode;
  const nodeOffset = range?.startOffset ?? point?.offset;
  if (node && nodeOffset != null && block.contains(node) && total > 0) {
    try {
      const probe = doc.createRange();
      probe.setStart(block, 0);
      probe.setEnd(node, nodeOffset);
      return Math.min(1, Math.max(0, probe.toString().length / total));
    } catch {
      // The caret sits outside this block. Use the vertical fraction below.
    }
  }
  const rect = block.getBoundingClientRect();
  if (rect.height <= 0) return 0;
  return Math.min(1, Math.max(0, (y - rect.top) / rect.height));
}

function nearestBlock(root: HTMLElement, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestDist = Infinity;
  for (const block of root.querySelectorAll<HTMLElement>("[data-line]")) {
    const rect = block.getBoundingClientRect();
    const dist = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (dist < bestDist) {
      best = block;
      bestDist = dist;
    }
  }
  return best;
}

/** Approximate source offset for a click in rendered markup. */
function clickOffset(root: HTMLElement, event: MouseEvent, source: string): number {
  const element = elementAt(event.target);
  if (!element || !root.contains(element)) return 0;
  const direct = element.closest<HTMLElement>("[data-line]");
  if (direct && root.contains(direct)) return offsetOfBlock(direct, event, source);
  const heading = element.closest("h1, h2, h3, h4, h5, h6");
  if (heading && root.contains(heading)) return 0;
  const block = nearestBlock(root, event.clientY);
  if (!block) return 0;
  return offsetOfBlock(block, event, source);
}

function offsetOfBlock(block: HTMLElement, event: MouseEvent, source: string): number {
  const start = Number(block.dataset.line);
  const end = Number(block.dataset.end ?? String(start + 1));
  if (!Number.isInteger(start) || !Number.isInteger(end)) return 0;
  return sourceOffset(source, start, end, fractionAt(block, event.clientX, event.clientY));
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

const MIN_PANE = 180;
const PREVIEW_WIDTH_KEY = "bookwriter.preview-width";

function readPreviewWidth(): number | null {
  try {
    const value = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

function writePreviewWidth(width: number): void {
  try {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(width));
  } catch {
    // The width still applies for this session when storage is unavailable.
  }
}

function fittedPreviewWidth(width: number): number {
  const rect = workspace.getBoundingClientRect();
  const splitter = paneSplit.getBoundingClientRect().width || 5;
  const available = rect.width - outlineColumn.getBoundingClientRect().width - splitter;
  return clampPreviewWidth(available, width, MIN_PANE);
}

function applyPreviewWidth(width: number | null): void {
  if (width == null) {
    workspace.style.removeProperty("--preview-width");
    paneSplit.removeAttribute("aria-valuenow");
    return;
  }
  const fitted = fittedPreviewWidth(width);
  workspace.style.setProperty("--preview-width", `${fitted}px`);
  paneSplit.setAttribute("aria-valuemin", String(MIN_PANE));
  paneSplit.setAttribute("aria-valuenow", String(fitted));
}

let previewWidth = readPreviewWidth();
applyPreviewWidth(previewWidth);

function dragPreviewWidth(clientX: number): number {
  const rect = workspace.getBoundingClientRect();
  return previewWidthFromPointer(
    rect.width,
    rect.left,
    clientX,
    outlineColumn.getBoundingClientRect().width,
    paneSplit.getBoundingClientRect().width,
    MIN_PANE,
  );
}

let splitting = false;

paneSplit.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  splitting = true;
  paneSplit.classList.add("dragging");
  document.body.classList.add("pane-dragging");
  paneSplit.setPointerCapture(event.pointerId);
  event.preventDefault();
});
paneSplit.addEventListener("pointermove", (event) => {
  if (!splitting) return;
  previewWidth = dragPreviewWidth(event.clientX);
  applyPreviewWidth(previewWidth);
});
function endSplit(): void {
  if (!splitting) return;
  splitting = false;
  paneSplit.classList.remove("dragging");
  document.body.classList.remove("pane-dragging");
  if (previewWidth != null) writePreviewWidth(fittedPreviewWidth(previewWidth));
}
paneSplit.addEventListener("pointerup", endSplit);
paneSplit.addEventListener("pointercancel", endSplit);
paneSplit.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const current = previewWidth ?? previewEl.getBoundingClientRect().width;
  const step = event.shiftKey ? 80 : 24;
  previewWidth = fittedPreviewWidth(current + (event.key === "ArrowLeft" ? step : -step));
  applyPreviewWidth(previewWidth);
  writePreviewWidth(previewWidth);
});
window.addEventListener("resize", () => {
  if (previewWidth != null) applyPreviewWidth(previewWidth);
});

function drawPreview(): void {
  const current = selected();
  previewEl.hidden = !previewOn || !editing();
  paneSplit.hidden = previewEl.hidden;
  workspace.classList.toggle("preview-off", previewEl.hidden);
  if (!current || !editing()) {
    previewEl.innerHTML = "";
    return;
  }
  const node = { ...current.node, body: editor.state.doc.toString(), children: current.node.children };
  const rendered = renderSection(node, current.ancestors, divisionOf(current.node));
  const sameSection = previewEl.querySelector<HTMLElement>("section[data-id]")?.dataset.id === node.header.id;
  const scroll = sameSection ? previewEl.scrollTop : 0;
  previewEl.innerHTML = showPictures(rendered.html);
  previewEl.scrollTop = scroll;
  showWarnings([...(book?.warnings ?? []), ...rendered.warnings]);
}

const PREVIEW_SCROLL_PADDING = 48;

/** Scroll the preview to the rendered block around the editor cursor. */
function scrollPreviewToCursor(): void {
  if (previewEl.hidden || !editing()) return;
  const source = editor.state.doc.toString();
  const cursor = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(cursor).number - 1;
  const blocks = [...previewEl.querySelectorAll<HTMLElement>("[data-line]")];
  const spans = blocks.map((block) => {
    const start = Number(block.dataset.line);
    const end = block.dataset.end === undefined ? start + 1 : Number(block.dataset.end);
    return { start, end };
  });
  const picked = blockAtLine(spans, line);
  if (picked < 0) {
    previewEl.scrollTop = 0;
    return;
  }
  const span = spans[picked];
  const fraction = offsetFraction(cursor, lineOffset(source, span.start), lineOffset(source, span.end));
  const pane = previewEl.getBoundingClientRect();
  const rect = blocks[picked].getBoundingClientRect();
  const spot = rect.top + rect.height * fraction;
  previewEl.scrollTop = scrollToSpot(previewEl.scrollTop, pane.top, spot, PREVIEW_SCROLL_PADDING);
}

function drawReading(): void {
  if (viewingBook() && book && !editing()) {
    editorHost.hidden = true;
    readingEl.hidden = false;
    const rendered = renderBook(manuscriptNodes(book.nodes));
    readingEl.innerHTML = showPictures(rendered.html);
    showWarnings([...(book.warnings ?? []), ...rendered.warnings]);
    return;
  }
  const current = selected();
  if (!current || editing() || isTrash(current.node)) {
    readingEl.hidden = true;
    readingEl.innerHTML = "";
    editorHost.hidden = !editing();
    return;
  }
  editorHost.hidden = true;
  readingEl.hidden = false;
  const rendered = renderGroup(current.node, current.ancestors, book ? divisions(book.nodes) : undefined);
  readingEl.innerHTML = showPictures(rendered.html);
  showWarnings([...(book?.warnings ?? []), ...rendered.warnings]);
}

function divisionOf(node: TreeNode): Division | undefined {
  if (!book) return undefined;
  return divisions(book.nodes).get(node.header.id);
}

function outlineTitle(node: TreeNode): string {
  return node.header.title || node.slug;
}

function bookWordCount(): number {
  if (!book) return 0;
  return manuscriptNodes(book.nodes).reduce((sum, node) => sum + nodeWordCount(node), 0);
}

function renderOutline(): void {
  outlineEl.replaceChildren();
  if (!book) return;
  const bookRow = document.createElement("div");
  bookRow.className = `node book${viewingBook() ? " selected" : ""}`;
  bookRow.dataset.id = BOOK_ID;
  const bookOpen = !collapsed.has(BOOK_ID);
  const bookTwist = document.createElement("button");
  bookTwist.type = "button";
  bookTwist.className = "twist";
  bookTwist.textContent = bookOpen ? "▾" : "▸";
  bookTwist.setAttribute("aria-expanded", String(bookOpen));
  bookTwist.setAttribute("aria-label", bookOpen ? "Collapse book" : "Expand book");
  bookTwist.addEventListener("click", (event) => {
    event.stopPropagation();
    if (collapsed.has(BOOK_ID)) collapsed.delete(BOOK_ID);
    else collapsed.add(BOOK_ID);
    renderOutline();
  });
  const bookBody = document.createElement("div");
  bookBody.className = "node-body";
  const bookLabel = document.createElement("span");
  bookLabel.className = "title";
  bookLabel.textContent = book.title || "Book";
  const bookMeta = document.createElement("span");
  bookMeta.className = "meta";
  bookMeta.textContent = `${bookWordCount()} words`;
  bookBody.append(bookLabel, bookMeta);
  bookRow.append(bookTwist, bookBody);
  bookRow.addEventListener("click", () => void choose(BOOK_ID, false));
  outlineEl.append(bookRow);
  if (!bookOpen) return;
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
      const division = divisionOf(node);
      if (division) {
        const label = document.createElement("span");
        label.className = "chapter-number";
        label.textContent = divisionLabel(division);
        body.append(label);
      }
      const title = document.createElement("span");
      title.className = "title";
      title.textContent = outlineTitle(node);
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
  draw(book.nodes, 1);
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
  const unit = effectiveUnit(current.node);
  fieldId.textContent = current.node.header.id;
  const trash = isTrash(current.node);
  fieldTitle.disabled = trash;
  fieldSynopsis.disabled = trash;
  fieldStatus.disabled = trash;
  fieldRole.disabled = trash;
  for (const input of unitInputs) {
    input.checked = input.value === unit;
    input.disabled = trash;
  }
  const group = current.node.kind === "group";
  editProse.hidden = trash || !group || editingProse;
  readGroup.hidden = trash || !group || !editingProse;
}

async function choose(id: string, prose: boolean): Promise<void> {
  if (selectedId === id && editingProse === prose) {
    showCurrent();
    return;
  }
  navigating = true;
  try {
    cancelSave();
    await flush();
    if (dirty) await flush();
    const leaving = takeVisit();
    if (leaving) trail = noteVisit(trail, leaving);
    selectedId = id;
    editingProse = prose;
    const current = selected();
    loadDocument(current && editing() ? current.node.body : "", true);
  } finally {
    navigating = false;
  }
  showCurrent();
}

async function refresh(keep: string | null, resetHistory = false): Promise<void> {
  if (!book) return;
  const previousId = selectedId;
  const previousProse = editingProse;
  book = await loadBook(fs, book.root);
  if (keep === BOOK_ID || (keep && findNode(book.nodes, keep))) selectedId = keep;
  else selectedId = BOOK_ID;
  const changed = resetHistory || selectedId !== previousId || editingProse !== previousProse;
  if (changed) trail = emptyTrail();
  bookTitle.value = book.title;
  const current = selected();
  if (current && editing()) loadDocument(current.node.body, changed);
  else if (changed) loadDocument("", true);
  renderOutline();
  fillInspector();
  drawReading();
  drawPreview();
  showWarnings(book.warnings);
}

async function openRoot(root: string): Promise<void> {
  let full: string;
  try {
    full = await fs.canonicalize(root);
  } catch (error) {
    showWarnings([String(error)]);
    return;
  }
  let pictureWarning = "";
  try {
    await allowBook(full);
  } catch (error) {
    pictureWarning = `Pictures in this book cannot be shown. ${String(error)}`;
  }
  book = await loadBook(fs, full);
  selectedId = null;
  editingProse = false;
  trail = emptyTrail();
  bookTitle.value = book.title;
  document.title = book.title || "Bookwriter";
  saveState.textContent = "Saved";
  await refresh(BOOK_ID, true);
  if (pictureWarning) showWarnings([...(book?.warnings ?? []), pictureWarning]);
}

async function openFolder(): Promise<void> {
  const picked = await open({
    directory: true,
    title: "Open book",
    defaultPath: book ? parentPath(book.root) : undefined,
  });
  if (typeof picked === "string") await openRoot(picked);
}

async function exportManuscript(): Promise<void> {
  if (!book) return;
  await flush();
  book = await loadBook(fs, book.root);
  const destination = await save({
    title: "Export manuscript",
    defaultPath: joinPath(book.root, `${slugify(book.title) || "manuscript"}.md`),
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (typeof destination !== "string") return;
  const result = exportBook(manuscriptNodes(book.nodes));
  const text = result.markdown.endsWith("\n") ? result.markdown : result.markdown + "\n";
  await fs.writeText(destination, text);
  showWarnings(result.warnings);
  saveState.textContent = result.warnings.length ? "Exported with warnings" : "Exported";
}

async function exportPdfManuscript(): Promise<void> {
  if (!book) return;
  try {
    await flush();
    book = await loadBook(fs, book.root);
    const destination = await save({
      title: "Export PDF",
      defaultPath: joinPath(book.root, `${slugify(book.title) || "manuscript"}.pdf`),
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (typeof destination !== "string") return;
    const result = await exportPdfWithPictures(manuscriptNodes(book.nodes), book.title, fs, book.root, { rasterize: rasterizePicture });
    await fs.writeText(destination, result.pdf);
    showWarnings(result.warnings);
    saveState.textContent = result.warnings.length ? "Exported with warnings" : "Exported";
  } catch (error) {
    showWarnings([`PDF export failed: ${String(error)}`]);
    saveState.textContent = "Export failed";
  }
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

createTitle.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || !createDialog.open) return;
  event.preventDefault();
  createDialog.querySelector<HTMLButtonElement>('button[value="ok"]')?.click();
});

function clearBarMenu(): void {
  delete contextMenu.dataset.menu;
  document.querySelector("#btn-file")?.setAttribute("aria-expanded", "false");
  document.querySelector("#btn-edit")?.setAttribute("aria-expanded", "false");
}

function closeContextMenu(): void {
  contextMenu.hidden = true;
  contextMenu.replaceChildren();
  clearBarMenu();
}

type MenuEntry = { label: string; shortcut?: string; run: () => void };

function usesMacShortcuts(): boolean {
  return /\bMac/.test(navigator.platform) || /\bMac/.test(navigator.userAgent);
}

function menuButton(entry: MenuEntry, keepFocus: boolean): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  const name = document.createElement("span");
  name.textContent = entry.label;
  button.append(name);
  if (entry.shortcut) {
    const key = document.createElement("span");
    key.className = "menu-key";
    key.textContent = entry.shortcut;
    button.append(key);
  }
  if (keepFocus) button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.addEventListener("click", (click) => {
    click.stopPropagation();
    closeContextMenu();
    entry.run();
  });
  return button;
}

function showBarMenu(anchor: HTMLElement, actions: MenuEntry[]): void {
  closeContextMenu();
  contextMenu.dataset.menu = anchor.id;
  for (const action of actions) contextMenu.append(menuButton(action, true));
  anchor.setAttribute("aria-expanded", "true");
  const rect = anchor.getBoundingClientRect();
  placeContextMenu(rect.left, rect.bottom + 4);
}

function toggleBarMenu(event: Event, anchor: HTMLElement, actions: MenuEntry[]): void {
  event.preventDefault();
  event.stopPropagation();
  if (!contextMenu.hidden && contextMenu.dataset.menu === anchor.id) {
    closeContextMenu();
    return;
  }
  showBarMenu(anchor, actions);
}

function placeContextMenu(x: number, y: number): void {
  contextMenu.hidden = false;
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  const rect = contextMenu.getBoundingClientRect();
  if (rect.right > window.innerWidth) contextMenu.style.left = `${Math.max(8, x - rect.width)}px`;
  if (rect.bottom > window.innerHeight) contextMenu.style.top = `${Math.max(8, y - rect.height)}px`;
}

function showContextMenu(event: MouseEvent, node: TreeNode, ancestors: TreeNode[]): void {
  event.preventDefault();
  clearBarMenu();
  const inTrash = isTrash(node) || ancestors.some(isTrash);
  const actions: { label: string; run: () => Promise<void> }[] = [];
  if (node.kind === "group") {
    actions.push({ label: "Add text", run: () => addTextAtTop(node.header.id) });
    actions.push({ label: "Add folder", run: () => addInside(node.header.id, "group") });
  } else {
    actions.push({ label: "Add text", run: () => addTextBelow(node.header.id) });
  }
  if (!inTrash) actions.push({ label: "Delete", run: () => deleteItem(node.header.id) });
  contextMenu.replaceChildren();
  for (const action of actions) {
    contextMenu.append(menuButton({ label: action.label, run: () => void action.run() }, false));
  }
  placeContextMenu(event.clientX, event.clientY);
}

function showCommandMenu(event: MouseEvent): void {
  event.preventDefault();
  clearBarMenu();
  const pos = editor.posAtCoords({ x: event.clientX, y: event.clientY });
  const range = editor.state.selection.main;
  const keepsSelection = pos != null && !range.empty && pos >= range.from && pos <= range.to;
  if (!keepsSelection) placeCursor(pos ?? editor.state.doc.length);
  contextMenu.replaceChildren();
  const mac = usesMacShortcuts();
  for (const command of COMMANDS) {
    contextMenu.append(menuButton({
      label: command.name,
      shortcut: command.accelerator ? formatAccelerator(command.accelerator, mac) : undefined,
      run: () => runCommand(command.id),
    }, false));
  }
  placeContextMenu(event.clientX, event.clientY);
}

async function addTextAtTop(parentId: string): Promise<void> {
  if (!book) return;
  const title = await askTitle("New text");
  if (!title) return;
  await flush();
  const id = await createNode(fs, book, parentId, "section", title);
  book = await loadBook(fs, book.root);
  const parent = findNode(book.nodes, parentId);
  const first = parent?.node.children.find((child) => child.header.id !== id);
  if (first) await moveNode(fs, book, id, first.header.id, "before");
  collapsed.delete(parentId);
  editingProse = false;
  await refresh(id);
  await choose(id, false);
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
  if (id === "picture") {
    void choosePicture();
    return;
  }
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

async function choosePicture(): Promise<void> {
  if (!book || !editing()) return;
  const root = book.root;
  const picked = await open({
    title: "Picture",
    defaultPath: root,
    multiple: false,
    filters: [{ name: "Pictures", extensions: PICTURE_EXTENSIONS }],
  });
  if (typeof picked !== "string" || !book || book.root !== root || !editing()) return;
  let relative: string;
  try {
    relative = await placePicture(fs, root, picked);
  } catch (error) {
    showWarnings([`The picture could not be moved into the book. ${String(error)}`]);
    return;
  }
  const range = editor.state.selection.main;
  const result = applyCommand("picture", editor.state.doc.toString(), range.anchor, range.head, "", relative);
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

function runEdit(action: () => Promise<void>, label: string): void {
  void action().catch((error: unknown) => showWarnings([`${label} failed. ${String(error)}`]));
}

function activeField(): HTMLInputElement | HTMLTextAreaElement | null {
  const active = document.activeElement;
  if ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && !active.readOnly && !active.disabled) {
    return active;
  }
  return null;
}

function replaceFieldSelection(field: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  const start = field.selectionStart ?? 0;
  const end = field.selectionEnd ?? 0;
  field.setRangeText(text, start, end, "end");
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
}

async function editCopy(): Promise<void> {
  const field = activeField();
  if (field) {
    await writeText(field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0));
    return;
  }
  if (!editing()) return;
  const range = editor.state.selection.main;
  await writeText(editor.state.sliceDoc(range.from, range.to));
}

async function editCut(): Promise<void> {
  const field = activeField();
  if (field) {
    await writeText(field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0));
    replaceFieldSelection(field, "");
    return;
  }
  if (!editing()) return;
  const range = editor.state.selection.main;
  await writeText(editor.state.sliceDoc(range.from, range.to));
  editor.dispatch({
    changes: { from: range.from, to: range.to, insert: "" },
    selection: { anchor: range.from, head: range.from },
  });
}

async function editPaste(): Promise<void> {
  const text = await readText();
  const field = activeField();
  if (field) {
    replaceFieldSelection(field, text);
    return;
  }
  if (!editing()) return;
  const range = editor.state.selection.main;
  editor.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length, head: range.from + text.length },
  });
  editor.focus();
}

function openFind(): void {
  if (!editing()) return;
  openSearchPanel(editor);
  wireBookFind(editor);
}

function openReplace(): void {
  if (!editing()) return;
  openSearchPanel(editor);
  wireBookFind(editor);
  editor.dom.querySelector<HTMLInputElement>(".cm-search input[name=replace]")?.focus();
}

function goToNextMatch(): void {
  if (!editing()) return;
  if (searchWholeBook) void findInBook("next");
  else findNext(editor);
}

function goToPreviousMatch(): void {
  if (!editing()) return;
  if (searchWholeBook) void findInBook("previous");
  else findPrevious(editor);
}

/** Texts in tree order. The open buffer is used for the current node, so unsaved words are included. Trash is left out. */
function searchParts(): FindPart[] {
  if (!book) return [];
  const current = selected();
  const parts: FindPart[] = [];
  walk(manuscriptNodes(book.nodes), (node) => {
    const text = current && node.header.id === current.node.header.id ? editor.state.doc.toString() : node.body;
    parts.push({ id: node.header.id, text });
  });
  if (current && editing() && !parts.some((part) => part.id === current.node.header.id)) {
    parts.push({ id: current.node.header.id, text: editor.state.doc.toString() });
  }
  return parts;
}

function selectMatch(from: number, to: number): void {
  const range = EditorSelection.range(from, to);
  editor.dispatch({
    selection: range,
    effects: EditorView.scrollIntoView(range),
    userEvent: "select.search",
  });
}

function focusSearch(): void {
  editor.dom.querySelector<HTMLInputElement>(".cm-search [main-field]")?.focus();
}

/** The panel's next, previous, and Enter follow the whole book checkbox once the panel is open. */
function wireBookFind(view: EditorView): void {
  const panel = view.dom.querySelector<HTMLElement>(".cm-search");
  if (!panel || panel.dataset.bookFind) return;
  panel.dataset.bookFind = "true";
  const box = document.createElement("input");
  box.type = "checkbox";
  box.name = "book";
  box.checked = searchWholeBook;
  box.addEventListener("change", () => {
    searchWholeBook = box.checked;
  });
  const label = document.createElement("label");
  label.append(box, view.state.phrase("whole book"));
  const word = panel.querySelector('input[name="word"]')?.parentElement;
  if (word) word.after(label);
  else panel.append(label);
  const take = (direction: "next" | "previous", event: Event) => {
    if (!searchWholeBook) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    void findInBook(direction);
  };
  panel.querySelector("button[name=next]")?.addEventListener("click", (event) => take("next", event), true);
  panel.querySelector("button[name=prev]")?.addEventListener("click", (event) => take("previous", event), true);
  panel.addEventListener("keydown", (event) => {
    if (!searchWholeBook || event.key !== "Enter" || event.altKey || event.metaKey || event.ctrlKey) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "search") return;
    take(event.shiftKey ? "previous" : "next", event);
  }, true);
}

let finding = false;

async function findInBook(direction: "next" | "previous"): Promise<void> {
  if (finding || !editing() || !book) return;
  const query = getSearchQuery(editor.state);
  if (!query.valid) {
    openSearchPanel(editor);
    wireBookFind(editor);
    return;
  }
  const current = selected();
  if (!current) return;
  const from = direction === "next" ? editor.state.selection.main.to : editor.state.selection.main.from;
  const hit = direction === "next"
    ? nextMatch(searchParts(), current.node.header.id, from, query)
    : previousMatch(searchParts(), current.node.header.id, from, query);
  if (!hit) return;
  const fromPanel = editor.dom.querySelector(".cm-search")?.contains(document.activeElement) ?? false;
  if (hit.id !== current.node.header.id) {
    const found = findNode(book.nodes, hit.id);
    if (!found) return;
    finding = true;
    try {
      await choose(hit.id, found.node.kind === "group");
      openSearchPanel(editor);
      editor.dispatch({ effects: setSearchQuery.of(query) });
      wireBookFind(editor);
      if (hit.to <= editor.state.doc.length) selectMatch(hit.from, hit.to);
      if (fromPanel) focusSearch();
    } finally {
      finding = false;
    }
    return;
  }
  selectMatch(hit.from, hit.to);
  if (fromPanel) focusSearch();
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
          await MenuItem.new({ id: "export-pdf", text: "Export PDF…", action: () => void exportPdfManuscript() }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({ id: "new-section", text: "Text", action: () => void create("section") }),
          await MenuItem.new({ id: "new-group", text: "Folder", action: () => void create("group") }),
          await MenuItem.new({ id: "delete", text: "Delete", action: () => void deleteSelected() }),
        ],
      }),
      await Submenu.new({
        text: "Edit",
        items: [
          await MenuItem.new({ id: "undo", text: "Undo", accelerator: "CmdOrCtrl+Z", action: () => menuHistory("undo") }),
          await MenuItem.new({ id: "redo", text: "Redo", accelerator: "CmdOrCtrl+Shift+Z", action: () => menuHistory("redo") }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Cut" }),
          await PredefinedMenuItem.new({ item: "Copy" }),
          await PredefinedMenuItem.new({ item: "Paste" }),
          await PredefinedMenuItem.new({ item: "SelectAll" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({ id: "find", text: "Find…", accelerator: "CmdOrCtrl+F", action: openFind }),
          await MenuItem.new({ id: "find-next", text: "Find Next", accelerator: "CmdOrCtrl+G", action: goToNextMatch }),
          await MenuItem.new({ id: "find-previous", text: "Find Previous", accelerator: "CmdOrCtrl+Shift+G", action: goToPreviousMatch }),
          await MenuItem.new({ id: "replace", text: "Replace…", accelerator: "CmdOrCtrl+Alt+F", action: openReplace }),
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

const fileButton = document.querySelector<HTMLButtonElement>("#btn-file")!;
const editButton = document.querySelector<HTMLButtonElement>("#btn-edit")!;
const macShortcuts = usesMacShortcuts();
fileButton.addEventListener("pointerdown", (event) => {
  toggleBarMenu(event, fileButton, [
    { label: "Open", shortcut: formatAccelerator("CmdOrCtrl+O", macShortcuts), run: () => void openFolder() },
    { label: "Export", shortcut: formatAccelerator("CmdOrCtrl+Shift+E", macShortcuts), run: () => void exportManuscript() },
    { label: "Export PDF", run: () => void exportPdfManuscript() },
  ]);
});
editButton.addEventListener("pointerdown", (event) => {
  toggleBarMenu(event, editButton, [
    { label: "Undo", shortcut: formatAccelerator("CmdOrCtrl+Z", macShortcuts), run: () => menuHistory("undo") },
    { label: "Redo", shortcut: formatAccelerator("CmdOrCtrl+Shift+Z", macShortcuts), run: () => menuHistory("redo") },
    { label: "Cut", shortcut: formatAccelerator("CmdOrCtrl+X", macShortcuts), run: () => runEdit(editCut, "Cut") },
    { label: "Copy", shortcut: formatAccelerator("CmdOrCtrl+C", macShortcuts), run: () => runEdit(editCopy, "Copy") },
    { label: "Paste", shortcut: formatAccelerator("CmdOrCtrl+V", macShortcuts), run: () => runEdit(editPaste, "Paste") },
    { label: "Find", shortcut: formatAccelerator("CmdOrCtrl+F", macShortcuts), run: openFind },
  ]);
});
document.querySelector("#btn-preview")!.addEventListener("click", () => {
  previewOn = !previewOn;
  paintViewToggle();
  drawPreview();
});
paintViewToggle();
document.querySelector("#btn-palette")!.addEventListener("click", openPalette);
document.querySelector("#reminder-close")!.addEventListener("click", () => {
  reminder.hidden = true;
});
editor.dom.addEventListener("contextmenu", (event) => {
  if (!editing()) return;
  showCommandMenu(event);
});
editor.dom.addEventListener("click", (event) => {
  if (event.button !== 0 || !editing() || previewEl.hidden) return;
  const target = event.target;
  if (!(target instanceof Node) || !editor.contentDOM.contains(target)) return;
  scrollPreviewToCursor();
});
previewEl.addEventListener("click", (event) => {
  if (!editing()) return;
  event.preventDefault();
  placeCursor(clickOffset(previewEl, event, editor.state.doc.toString()));
});
readingEl.addEventListener("click", (event) => {
  if (!book) return;
  const element = elementAt(event.target);
  const section = element?.closest<HTMLElement>("section[data-id]");
  if (!section || !readingEl.contains(section)) return;
  const id = section.dataset.id;
  if (!id) return;
  const found = findNode(book.nodes, id);
  if (!found) return;
  event.preventDefault();
  const offset = clickOffset(section, event, found.node.body);
  void openAt(id, found.node.kind === "group", offset);
});

async function openAt(id: string, prose: boolean, offset: number): Promise<void> {
  if (selectedId !== id || prose !== editingProse || !editing()) await choose(id, prose);
  placeCursor(offset);
}
editProse.addEventListener("click", () => {
  if (selectedId) void choose(selectedId, true);
});
readGroup.addEventListener("click", () => {
  if (selectedId) void choose(selectedId, false);
});

for (const field of [fieldTitle, fieldSynopsis, fieldStatus, fieldRole, ...unitInputs]) {
  field.addEventListener("change", () => {
    dirty = true;
    const renumber = field === fieldRole || unitInputs.includes(field as HTMLInputElement);
    void flush().then(() => {
      const current = selected();
      if (!current) return;
      if (renumber) renderOutline();
      const row = outlineEl.querySelector<HTMLElement>(`[data-id="${CSS.escape(current.node.header.id)}"] .title`);
      if (row && !renumber) row.textContent = outlineTitle(current.node);
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
    renderOutline();
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
