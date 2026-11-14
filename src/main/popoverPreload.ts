import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("popover", {
  view: () => ipcRenderer.invoke("popover:view"),
  open: (key: string) => ipcRenderer.send("popover:open", String(key)),
  filter: (id: string) => ipcRenderer.send("popover:filter", String(id)),
  refresh: () => ipcRenderer.send("popover:refresh"),
  settings: () => ipcRenderer.send("popover:settings"),
  toggleTheme: () => ipcRenderer.send("popover:toggle-theme"),
  close: () => ipcRenderer.send("popover:close"),
  height: (h: number) => ipcRenderer.send("popover:height", Number(h)),
  onShow: (cb: (view: unknown) => void) => ipcRenderer.on("popover:show", (_e, v) => cb(v)),
  onUpdate: (cb: (view: unknown) => void) => ipcRenderer.on("popover:update", (_e, v) => cb(v)),
  onLayout: (cb: (l: { tailX: number; height: number }) => void) => ipcRenderer.on("popover:layout", (_e, l) => cb(l)),
});
