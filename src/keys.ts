const MAC_ORDER = ["Ctrl", "Control", "Alt", "Option", "Shift", "Cmd", "Command", "CmdOrCtrl", "Super"];

const MAC_SYMBOL: Record<string, string> = {
  Ctrl: "⌃",
  Control: "⌃",
  Alt: "⌥",
  Option: "⌥",
  Shift: "⇧",
  Cmd: "⌘",
  Command: "⌘",
  CmdOrCtrl: "⌘",
  Super: "⌘",
};

/** The characters shown beside a menu item for an accelerator such as `CmdOrCtrl+Shift+E`. */
export function formatAccelerator(accelerator: string, mac: boolean): string {
  const parts = accelerator.split("+");
  const key = parts.at(-1) ?? "";
  const mods = parts.slice(0, -1);
  if (!mac) {
    const names = mods.map((mod) => (mod === "CmdOrCtrl" ? "Ctrl" : mod));
    return [...names, key].join("+");
  }
  const symbols = [...mods].sort((a, b) => rank(a) - rank(b));
  return symbols.map((mod) => MAC_SYMBOL[mod] ?? mod).join("") + key;
}

function rank(mod: string): number {
  const index = MAC_ORDER.indexOf(mod);
  return index < 0 ? MAC_ORDER.length : index;
}
