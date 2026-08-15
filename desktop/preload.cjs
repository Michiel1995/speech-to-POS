const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("serviceEarsDesktop", {
  getStatus: () => ipcRenderer.invoke("desktop:get-status"),
  onServerError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("desktop:server-error", listener);
    return () => ipcRenderer.removeListener("desktop:server-error", listener);
  },
});
