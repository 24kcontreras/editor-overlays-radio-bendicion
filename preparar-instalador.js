// Prepara la carpeta instalar/ con todo lo que el instalador lleva además de la app: los overlays (.dc.html y .html),
// support.js, _ds/, assets/ y _fuentes/, más los valores actuales (textos, programas, anuncios) como punto de partida.
// Uso: node preparar-instalador.js "C:\ruta\a\overlays"   (lo corre «npm run construir»)
const fs = require("fs");
const path = require("path");

const origen = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const destino = path.join(__dirname, "instalar");
const OVERLAYS = path.join(destino, "overlays");
const VALORES = path.join(destino, "valores");

fs.rmSync(destino, { recursive: true, force: true });
fs.mkdirSync(OVERLAYS, { recursive: true });
fs.mkdirSync(VALORES, { recursive: true });

let n = 0;
for (const e of fs.readdirSync(origen, { withFileTypes: true })) {
  const p = path.join(origen, e.name);
  if (e.isDirectory() && ["_ds", "assets", "_fuentes"].includes(e.name)) {
    fs.cpSync(p, path.join(OVERLAYS, e.name), { recursive: true });
    n++;
  } else if (e.isFile() && (/\.html$/i.test(e.name) || e.name === "support.js")) {
    fs.copyFileSync(p, path.join(OVERLAYS, e.name));
    n++;
  }
}

// Valores iniciales: solo se usan en un PC donde todavía no hay. No viajan la contraseña de OBS, el PIN ni las
// sesiones de los celulares (son de este PC); el control remoto queda apagado hasta que lo enciendan allá.
const valores = path.join(origen, "overlay-valores.json");
if (fs.existsSync(valores)) fs.copyFileSync(valores, path.join(VALORES, "overlay-valores.json"));
const est = path.join(origen, "estudio.json");
if (fs.existsSync(est)) {
  const d = JSON.parse(fs.readFileSync(est, "utf8"));
  if (d.obs) { d.obs.clave = ""; d.obs.activo = false; }
  // El instalador se publica en GitHub: el PIN tampoco viaja (se elige de nuevo en cada PC)
  if (d.remoto) { d.remoto.sesiones = []; d.remoto.activo = false; d.remoto.pin = ""; }
  if (d.alAire) d.alAire.fijo = null;
  if (d.comentarios) d.comentarios.actual = null;
  fs.writeFileSync(path.join(VALORES, "estudio.json"), JSON.stringify(d, null, 2), "utf8");
}

if (!fs.existsSync(path.join(OVERLAYS, "support.js"))) throw new Error(`No encontré los overlays en ${origen}`);
console.log(`✓ ${n} archivos y carpetas de overlays listos en instalar/`);
