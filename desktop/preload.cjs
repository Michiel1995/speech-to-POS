const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("serviceEarsDesktop", {
  getStatus: () => ipcRenderer.invoke("desktop:get-status"),
  saveOpenAIKey: (key) => ipcRenderer.invoke("desktop:save-openai-key", key),
  clearOpenAIKey: () => ipcRenderer.invoke("desktop:clear-openai-key"),
  onServerError: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on("desktop:server-error", listener);
    return () => ipcRenderer.removeListener("desktop:server-error", listener);
  },
});
