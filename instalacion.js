// Los overlays que trae el instalador (resources/overlays) se copian a la carpeta de trabajo de la app,
// que es donde se guardan los textos elegidos y donde se pueden agregar overlays nuevos.
//   - Los archivos que faltan se copian.
//   - Un archivo que vino en una instalación anterior y nadie modificó se reemplaza por la versión nueva.
//   - Si alguien cambió o reemplazó un archivo a mano, se respeta. Si lo borró, no se vuelve a poner.
// Para saber qué se instaló se guarda una lista con la huella de cada archivo (.instalados.json).
// Los valores (overlay-valores.json, estudio.json) se copian solo si la carpeta todavía no tiene.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MANIFIESTO = ".instalados.json";

function huella(archivo) {
  return crypto.createHash("sha1").update(fs.readFileSync(archivo)).digest("hex");
}

function archivos(dir, base = dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...archivos(p, base));
    else out.push(path.relative(base, p));
  }
  return out;
}

function sincronizar(recursos, carpeta) {
  const origen = path.join(recursos, "overlays");
  if (!fs.existsSync(origen)) return;
  fs.mkdirSync(carpeta, { recursive: true });
  const rutaManifiesto = path.join(carpeta, MANIFIESTO);
  let instalados = {};
  try { instalados = JSON.parse(fs.readFileSync(rutaManifiesto, "utf8")); } catch {}

  for (const rel of archivos(origen)) {
    const de = path.join(origen, rel), a = path.join(carpeta, rel);
    const nueva = huella(de);
    try {
      if (!fs.existsSync(a)) {
        if (rel in instalados) continue; // lo borraron a propósito
        fs.mkdirSync(path.dirname(a), { recursive: true });
        fs.copyFileSync(de, a);
        instalados[rel] = nueva;
        continue;
      }
      const actual = huella(a);
      if (actual === nueva) instalados[rel] = nueva;
      else if (instalados[rel] === actual) { fs.copyFileSync(de, a); instalados[rel] = nueva; }
      // si no, el archivo se cambió a mano: se deja como está
    } catch (err) {
      console.error("No se pudo instalar", rel, err.message);
    }
  }

  for (const nombre of ["overlay-valores.json", "estudio.json"]) {
    const de = path.join(recursos, "valores", nombre), a = path.join(carpeta, nombre);
    if (fs.existsSync(de) && !fs.existsSync(a)) {
      try { fs.copyFileSync(de, a); } catch {}
    }
  }
  try { fs.writeFileSync(rutaManifiesto, JSON.stringify(instalados, null, 2), "utf8"); } catch {}
}

// ¿La carpeta ya tiene overlays? (para no llenar de archivos una carpeta que alguien eligió con otros diseños)
function tieneOverlays(carpeta) {
  try { return fs.readdirSync(carpeta).some(n => /\.html$/i.test(n)); } catch { return false; }
}

module.exports = { sincronizar, tieneOverlays };
