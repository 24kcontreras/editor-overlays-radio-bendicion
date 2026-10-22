// Envío de contenido entre PCs a través de GitHub (repositorio 24kcontreras/editor-overlays-radio-bendicion,
// rama «contenido», archivo contenido.json).
//   - PC de preparación: «Enviar al PC de transmisión» sube los diseños, los textos publicados, la programación,
//     los presentadores y los anuncios. Para escribir usa la sesión de GitHub de ese PC (gh auth token) o un token.
//   - PC de transmisión: revisa cada 2 minutos si hay contenido nuevo (sin contraseña: el repositorio es público) y
//     lo aplica solo. Si está transmitiendo o grabando, espera a que termine o a que alguien presione «Aplicar ahora».
// La configuración de cada PC (su rol, el token, lo último enviado o recibido) se guarda fuera de la carpeta de overlays.

const fs = require("fs");
const crypto = require("crypto");
const { execFile } = require("child_process");

const DUENO = "24kcontreras", REPO = "editor-overlays-radio-bendicion", RAMA = "contenido", RUTA = "contenido.json";
const API = `https://api.github.com/repos/${DUENO}/${REPO}`;
const CADA_MS = 2 * 60000;
const FORMATO = 1;

let archivoConfig = null;
let deps = null; // { generar(), aplicar(contenido, archivosAnteriores), enVivo(), avisar(evento) }
let cfg = {};
let estado = { trabajando: false, error: null, pendiente: null, revisado: null };
let tRevisar = null;

function leer() {
  try { cfg = JSON.parse(fs.readFileSync(archivoConfig, "utf8")) || {}; } catch { cfg = {}; }
}

function guardar() {
  if (!archivoConfig) return;
  try { fs.writeFileSync(archivoConfig, JSON.stringify(cfg, null, 2), "utf8"); } catch {}
}

function iniciar(opciones) {
  archivoConfig = opciones.archivo;
  deps = opciones;
  leer();
  if (!cfg.rol && opciones.rolPredeterminado) { cfg.rol = opciones.rolPredeterminado; guardar(); }
  programar();
}

function programar() {
  clearInterval(tRevisar);
  tRevisar = null;
  if (cfg.rol === "transmision") {
    tRevisar = setInterval(() => revisar().catch(() => {}), CADA_MS);
    setTimeout(() => revisar().catch(() => {}), 3000);
  }
}

function huella(contenido) {
  return crypto.createHash("sha1").update(JSON.stringify(contenido)).digest("hex");
}

// ---------- Sesión de GitHub (solo el PC de preparación escribe) ----------

function ejecutar(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout: 8000 }, (err, salida) => resolve(err ? "" : String(salida || "").trim()));
  });
}

async function token() {
  if (cfg.token) return cfg.token;
  // La sesión iniciada con «gh auth login» en este PC
  for (const gh of ["gh", "C:\\Program Files\\GitHub CLI\\gh.exe"]) {
    const t = await ejecutar(gh, ["auth", "token"]);
    if (/^[\w-]{20,}$/.test(t)) return t;
  }
  return null;
}

async function github(metodo, ruta, cuerpo, { autenticado = true, cabeceras = {} } = {}) {
  const h = { Accept: "application/vnd.github+json", "User-Agent": "editor-overlays-radio-bendicion", "X-GitHub-Api-Version": "2022-11-28", ...cabeceras };
  if (autenticado) {
    const t = await token();
    if (!t) throw new Error("Este PC no tiene sesión de GitHub. Pega un token en «Sincronización».");
    h.Authorization = `Bearer ${t}`;
  }
  if (cuerpo) h["Content-Type"] = "application/json";
  const r = await fetch(API + ruta, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined, signal: AbortSignal.timeout(60000) });
  return r;
}

async function errorDe(r) {
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) return new Error("GitHub rechazó la sesión de este PC (token vencido o incorrecto).");
  if (r.status === 403 || r.status === 404) return new Error(`GitHub no deja escribir en ${DUENO}/${REPO} (${d.message || r.status}).`);
  return new Error(`GitHub respondió ${r.status}: ${d.message || ""}`);
}

// ---------- PC de preparación ----------

async function enviar() {
  if (estado.trabajando) throw new Error("Ya se está enviando.");
  estado.trabajando = true;
  estado.error = null;
  try {
    const contenido = deps.generar();
    const datos = { formato: FORMATO, enviado: new Date().toISOString(), contenido };
    // La rama «contenido» se crea la primera vez, a partir de la rama principal
    let r = await github("GET", `/git/ref/heads/${RAMA}`);
    if (r.status === 404) {
      const repo = await github("GET", "");
      if (!repo.ok) throw await errorDe(repo);
      const principal = (await repo.json()).default_branch;
      const ref = await github("GET", `/git/ref/heads/${principal}`);
      if (!ref.ok) throw await errorDe(ref);
      const crear = await github("POST", "/git/refs", { ref: `refs/heads/${RAMA}`, sha: (await ref.json()).object.sha });
      if (!crear.ok) throw await errorDe(crear);
    } else if (!r.ok) throw await errorDe(r);
    r = await github("GET", `/contents/${RUTA}?ref=${RAMA}`);
    const sha = r.ok ? (await r.json()).sha : undefined;
    if (!r.ok && r.status !== 404) throw await errorDe(r);
    const put = await github("PUT", `/contents/${RUTA}`, {
      message: `Contenido enviado desde el PC de preparación (${datos.enviado})`,
      content: Buffer.from(JSON.stringify(datos)).toString("base64"),
      branch: RAMA, sha
    });
    if (!put.ok) throw await errorDe(put);
    cfg.ultimoEnvio = datos.enviado;
    cfg.huellaEnviada = huella(contenido);
    guardar();
    return obtener();
  } catch (err) {
    estado.error = err.message;
    throw err;
  } finally {
    estado.trabajando = false;
  }
}

// ---------- PC de transmisión ----------

async function revisar() {
  if (cfg.rol !== "transmision" || estado.trabajando) return obtener();
  estado.trabajando = true;
  try {
    // Pedido sin sesión (el repositorio es público). Con el ETag, si no hay nada nuevo GitHub responde 304.
    const cab = { Accept: "application/vnd.github.raw+json" };
    if (cfg.etag && cfg.ultimoRecibido) cab["If-None-Match"] = cfg.etag;
    const r = await github("GET", `/contents/${RUTA}?ref=${RAMA}`, null, { autenticado: false, cabeceras: cab });
    estado.revisado = new Date().toISOString();
    if (r.status === 304) { estado.error = null; return obtener(); }
    if (r.status === 404) { estado.error = null; return obtener(); } // todavía no se ha enviado nada
    if (!r.ok) throw new Error(`No se pudo revisar GitHub (${r.status}).`);
    const datos = await r.json();
    cfg.etag = r.headers.get("etag") || null;
    guardar();
    estado.error = null;
    if (datos.formato !== FORMATO || !datos.contenido) throw new Error("El contenido recibido es de otra versión de la app. Actualiza la app.");
    if (datos.enviado === cfg.ultimoRecibido) return obtener();
    estado.pendiente = datos;
  } catch (err) {
    estado.error = err.name === "TimeoutError" ? "Sin conexión con GitHub." : err.message;
  } finally {
    estado.trabajando = false;
  }
  if (estado.pendiente && !deps.enVivo()) aplicar();
  else if (estado.pendiente) deps.avisar({ tipo: "sincronizacion", pendiente: true });
  return obtener();
}

function aplicar() {
  const datos = estado.pendiente;
  if (!datos) return obtener();
  deps.aplicar(datos.contenido, cfg.archivosRecibidos || []);
  cfg.archivosRecibidos = Object.keys(datos.contenido.archivos || {});
  cfg.ultimoRecibido = datos.enviado;
  estado.pendiente = null;
  guardar();
  deps.avisar({ tipo: "sincronizacion", aplicado: datos.enviado });
  return obtener();
}

// ---------- Para las pantallas ----------

function configurar({ rol, token: t }) {
  if (["preparacion", "transmision"].includes(rol)) cfg.rol = rol;
  if (typeof t === "string") cfg.token = t.trim();
  estado.error = null;
  guardar();
  programar();
}

async function obtener(conDetalle) {
  const out = {
    rol: cfg.rol || null, repo: `${DUENO}/${REPO}`,
    ultimoEnvio: cfg.ultimoEnvio || null, ultimoRecibido: cfg.ultimoRecibido || null,
    revisado: estado.revisado, trabajando: estado.trabajando, error: estado.error,
    pendiente: estado.pendiente ? { enviado: estado.pendiente.enviado } : null,
    tokenPropio: !!cfg.token
  };
  if (conDetalle && cfg.rol === "preparacion") {
    out.sesion = !!(await token());
    try { out.cambiosSinEnviar = huella(deps.generar()) !== cfg.huellaEnviada; } catch { out.cambiosSinEnviar = null; }
  }
  return out;
}

module.exports = { iniciar, configurar, obtener, enviar, revisar, aplicar, DUENO, REPO };
