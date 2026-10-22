const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("editorEscritorio", {
  elegirCarpeta: () => ipcRenderer.invoke("elegir-carpeta"),
  inicioWindows: activar => ipcRenderer.invoke("inicio-windows", activar),
  actualizacion: () => ipcRenderer.invoke("actualizacion-estado"),
  revisarActualizacion: () => ipcRenderer.invoke("actualizacion-revisar"),
  instalarActualizacion: () => ipcRenderer.invoke("actualizacion-instalar"),
  alActualizar: fn => ipcRenderer.on("actualizacion", (_e, datos) => fn(datos))
});
