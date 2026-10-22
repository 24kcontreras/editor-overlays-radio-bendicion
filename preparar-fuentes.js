// Descarga a vendor/fuentes todas las fuentes de Google que usan los overlays de una carpeta,
// para incluirlas dentro de la app. Uso: node preparar-fuentes.js "C:\ruta\a\overlays"
const fs = require("fs");
const path = require("path");
const { descargarFuente, FUENTES_APP, RE_GOOGLE_FONTS } = require("./server");

function buscarArchivos(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", "Editor de Overlays", "_fuentes"].includes(e.name)) out.push(...buscarArchivos(p)); }
    else if (/\.(dc\.html|css)$/i.test(e.name)) out.push(p);
  }
  return out;
}

(async () => {
  const carpeta = path.resolve(process.argv[2] || path.join(__dirname, ".."));
  const urls = new Set();
  for (const f of buscarArchivos(carpeta)) {
    for (const u of fs.readFileSync(f, "utf8").match(RE_GOOGLE_FONTS) || []) urls.add(u.replace(/&amp;/g, "&"));
  }
  for (const u of urls) {
    await descargarFuente(u, FUENTES_APP);
    console.log("✓", u);
  }
})().catch(err => { console.error(err); process.exit(1); });
