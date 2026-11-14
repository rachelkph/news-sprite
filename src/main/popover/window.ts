// The popover window: frameless, transparent (for the stepped corners and the
// tail), above other windows, closes when it loses focus. The page measures its
// natural height; main anchors it above the cat and tells the page where the tail goes.

import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, screen } from "electron";
import path from "node:path";
import { anchorPopover, type Rect } from "./anchor.ts";
import type { View } from "./view.ts";

const PAGE = "app://newscat/renderer/popover/index.html";
export const POPOVER_WIDTH = 420; // wide enough for the nameplate at a good size (Rachel, 2026-11-11)

export type PopoverHandlers = {
  view: () => View;
  open: (key: string) => void;
  filter: (id: string) => void;
  refresh: () => void;
  settings: () => void;
  toggleTheme: () => void;
  visibility: (visible: boolean) => void;
};

let win: BrowserWindow | null = null;
let handlers: PopoverHandlers | null = null;
let anchorCat: Rect | null = null; // the cat, in screen points
let ready = false;
let pendingShow = false;
let blurHiddenAt = 0; // when it last closed because it lost focus

function fromPopover(e: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return win !== null && e.sender === win.webContents && (e.senderFrame?.url ?? "").startsWith("app://newscat/renderer/popover/");
}

export function registerPopoverIpc(h: PopoverHandlers): void {
  handlers = h;
  const H = () => handlers as PopoverHandlers;
  ipcMain.handle("popover:view", (e) => {
    if (!fromPopover(e)) throw new Error("not allowed");
    return H().view();
  });
  const on = (channel: string, fn: (arg: unknown) => void) =>
    ipcMain.on(channel, (e, arg: unknown) => {
      if (fromPopover(e)) fn(arg);
    });
  on("popover:open", (key) => typeof key === "string" && H().open(key));
  on("popover:filter", (id) => typeof id === "string" && H().filter(id));
  on("popover:refresh", () => H().refresh());
  on("popover:settings", () => H().settings());
  on("popover:toggle-theme", () => H().toggleTheme());
  on("popover:close", () => hidePopover());
  // The page reports its natural height whenever its content changes.
  on("popover:height", (h) => {
    if (typeof h === "number" && Number.isFinite(h) && h > 0) place(Math.min(Math.ceil(h), 2000));
  });
}

function place(naturalHeight: number): void {
  if (!win || !anchorCat) return;
  const display = screen.getDisplayMatching({ x: Math.round(anchorCat.x), y: Math.round(anchorCat.y), width: Math.max(1, Math.round(anchorCat.width)), height: Math.max(1, Math.round(anchorCat.height)) });
  const { bounds, tailX } = anchorPopover(anchorCat, { width: POPOVER_WIDTH, height: naturalHeight }, display.workArea);
  win.setBounds(bounds);
  win.webContents.send("popover:layout", { tailX, height: bounds.height });
  if (pendingShow) {
    pendingShow = false;
    win.show();
    win.focus();
    handlers?.visibility(true);
  }
}

function create(preloadDir: string): BrowserWindow {
  const w = new BrowserWindow({
    width: POPOVER_WIDTH,
    height: 400,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(preloadDir, "popoverPreload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  w.setAlwaysOnTop(true, "floating", 1);
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true }); // keep no Dock icon
  w.webContents.on("will-navigate", (e) => e.preventDefault());
  w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  w.webContents.on("console-message", (e) => console.log(`[popover:${e.level}] ${e.message}`));
  w.on("blur", () => {
    if (w.isVisible()) blurHiddenAt = Date.now();
    hidePopover();
  });
  w.on("closed", () => {
    win = null;
    ready = false;
  });
  w.webContents.once("did-finish-load", () => {
    ready = true;
  });
  void w.loadURL(PAGE);
  return w;
}

// Creates the window early so the first click opens instantly.
export function preparePopover(preloadDir: string): void {
  if (!win) win = create(preloadDir);
}

export function showPopover(preloadDir: string, cat: Rect): void {
  if (!win) win = create(preloadDir);
  anchorCat = cat;
  pendingShow = true;
  const send = () => win?.webContents.send("popover:show", handlers?.view());
  if (ready) send();
  else win.webContents.once("did-finish-load", send);
}

export function hidePopover(): void {
  if (win?.isVisible()) {
    win.hide();
    handlers?.visibility(false);
  }
  pendingShow = false;
}

// A click on the cat toggles the popover. A real click can make the popover lose
// focus (closing it) just before the click reaches us; treat that as "close".
export const TOGGLE_GRACE_MS = 400;
export function togglePopover(preloadDir: string, cat: Rect): void {
  if (win?.isVisible()) hidePopover();
  else if (Date.now() - blurHiddenAt >= TOGGLE_GRACE_MS) showPopover(preloadDir, cat);
}

export function pushPopoverView(view: View): void {
  if (win && ready) win.webContents.send("popover:update", view);
}
