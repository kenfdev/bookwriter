/** Preview-column width in pixels. A non-positive available width leaves the request unchanged. */
export function clampPreviewWidth(available: number, width: number, min: number): number {
  if (!(available > 0)) return Math.round(width);
  const floor = Math.min(min, available);
  const ceiling = Math.max(floor, available - Math.min(min, available));
  return Math.round(Math.min(ceiling, Math.max(floor, width)));
}

/** Preview width while dragging the separator. `clientX` grows the preview as it moves left. */
export function previewWidthFromPointer(
  workspaceWidth: number,
  workspaceLeft: number,
  clientX: number,
  outlineWidth: number,
  splitterWidth: number,
  min: number,
): number {
  const available = workspaceWidth - outlineWidth - splitterWidth;
  const width = workspaceLeft + workspaceWidth - clientX - splitterWidth / 2;
  return clampPreviewWidth(available, width, min);
}
