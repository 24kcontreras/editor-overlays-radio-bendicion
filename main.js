// App de escritorio: inicia el servidor local y abre la ventana del editor.
const { app, BrowserWindow, dialog, ipcMain, shell, Menu } = require("electron");
const fs = require("fs");
const path = require("path");
const servidor = require("./server");
const instalacion = require("./instalacion");

const archivoConfig = () => path.join(app.getPath("userData"), "config.json");

function leerConfig() {
  try { return JSON.parse(fs.readFileSync(archivoConfig(), "utf8")); } catch { return {}; }
}

function guardarConfig(cfg) {
  fs.mkdirSync(path.dirname(archivoConfig()), { recursive: true });
  fs.writeFileSync(archivoConfig(), JSON.stringify(cfg, null, 2));
}

// Se usa la carpeta elegida antes. Si no hay (primera vez en este PC), se crea Documentos\Radio Bendición\Overlays
// con los overlays que trae el instalador. Durante el desarrollo se usa la carpeta de arriba.
// Un PC instalado desde cero (carpeta en Documentos) queda como PC de transmisión: recibe lo que se prepara en el otro.
let pcNuevo = false;

function carpetaInicial() {
  const cfg = leerConfig();
  if (cfg.carpeta && fs.existsSync(cfg.carpeta)) return cfg.carpeta;
  if (!app.isPackaged) return path.join(__dirname, "..");
  const dir = path.join(app.getPath("documents"), "Radio Bendición", "Overlays");
  fs.mkdirSync(dir, { recursive: true });
  guardarConfig({ ...cfg, carpeta: dir });
  pcNuevo = true;
  return dir;
}

// ---------- Actualizaciones automáticas (GitHub Releases) ----------
// La versión nueva se descarga en segundo plano y se instala al cerrar la app (nunca en medio de una transmisión),
// o antes si alguien presiona «Reiniciar y actualizar».
let actualizacion = { estado: "sin-revisar", version: null, error: null };

function avisarActualizacion(cambios) {
  actualizacion = { ...actualizacion, ...cambios };
  if (ventana) ventana.webContents.send("actualizacion", actualizacion);
}

function iniciarActualizaciones() {
  if (!app.isPackaged) { actualizacion.estado = "desarrollo"; return; }
  let autoUpdater;
  try { ({ autoUpdater } = require("electron-updater")); } catch { return; }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => avisarActualizacion({ estado: "revisando", error: null }));
  autoUpdater.on("update-not-available", () => avisarActualizacion({ estado: "al-dia" }));
  autoUpdater.on("update-available", i => avisarActualizacion({ estado: "descargando", version: i.version }));
  autoUpdater.on("update-downloaded", i => avisarActualizacion({ estado: "lista", version: i.version }));
  autoUpdater.on("error", err => avisarActualizacion({ estado: "error", error: String(err && err.message || err).split("\n")[0] }));
  const revisar = () => autoUpdater.checkForUpdates().catch(() => {});
  ipcMain.handle("actualizacion-revisar", () => { revisar(); return actualizacion; });
  ipcMain.handle("actualizacion-instalar", () => { if (actualizacion.estado === "lista") autoUpdater.quitAndInstall(true, true); });
  setTimeout(revisar, 10000);
  setInterval(revisar, 4 * 60 * 60000);
}

ipcMain.handle("actualizacion-estado", () => ({ ...actualizacion, actual: app.getVersion() }));

// Pone en la carpeta los overlays que trae esta versión del instalador (ver instalacion.js)
function instalarOverlays(carpeta) {
  if (app.isPackaged) instalacion.sincronizar(process.resourcesPath, carpeta);
}

let ventana = null;

function crearVentana() {
  ventana = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    title: "Editor de Overlays · Radio Bendición",
    backgroundColor: "#f3ede6",
    autoHideMenuBar: true,
    icon: path.join(__dirname, "icono.png"),
    show: false, // se muestra cuando ya cargó, sin pantalla en blanco
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false }
  });
  // Si se abrió sola al encender el PC, queda minimizada en la barra de tareas
  ventana.once("ready-to-show", () => { if (process.argv.includes(ARG_INICIO)) ventana.minimize(); else ventana.show(); });
  ventana.loadURL(`http://127.0.0.1:${servidor.PUERTO}/`);
  // Los enlaces externos se abren en el navegador normal, no dentro de la app
  ventana.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" }; });
}

ipcMain.handle("elegir-carpeta", async () => {
  const r = await dialog.showOpenDialog(ventana, {
    title: "Elige la carpeta donde están tus overlays",
    defaultPath: servidor.getCarpeta() || undefined,
    properties: ["openDirectory"]
  });
  if (r.canceled || !r.filePaths[0]) return null;
  // Una carpeta vacía recibe los overlays del instalador; una que ya tiene diseños se deja como está
  if (!instalacion.tieneOverlays(r.filePaths[0])) instalarOverlays(r.filePaths[0]);
  servidor.setCarpeta(r.filePaths[0]);
  guardarConfig({ ...leerConfig(), carpeta: r.filePaths[0] });
  return r.filePaths[0];
});

// «Abrir al encender el PC»: así los overlays están listos antes de que se abra OBS. Se abre minimizada.
const ARG_INICIO = "--al-iniciar-windows";
ipcMain.handle("inicio-windows", (_e, activar) => {
  if (typeof activar === "boolean") app.setLoginItemSettings({ openAtLogin: activar, args: [ARG_INICIO] });
  return app.getLoginItemSettings({ args: [ARG_INICIO] }).openAtLogin;
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (ventana) { if (ventana.isMinimized()) ventana.restore(); ventana.focus(); }
  });

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    try {
      const carpeta = carpetaInicial();
      instalarOverlays(carpeta);
      await servidor.iniciar(carpeta, {
        configSincronizacion: path.join(app.getPath("userData"), "sincronizacion.json"),
        rolPredeterminado: pcNuevo ? "transmision" : null
      });
    } catch (err) {
      dialog.showErrorBox("No se pudo iniciar el Editor de Overlays",
        err.code === "EADDRINUSE"
          ? `El puerto ${servidor.PUERTO} ya está en uso. Puede que el editor ya esté abierto en otra ventana.`
          : String(err.message || err));
      app.quit();
      return;
    }
    crearVentana();
    iniciarActualizaciones();
  });

  app.on("window-all-closed", () => app.quit());
}
