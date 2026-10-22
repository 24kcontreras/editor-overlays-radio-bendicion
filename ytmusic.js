// «Ahora suena» automático: lee la canción que está sonando en la app de escritorio de YouTube Music
// (th-ch / Pear Desktop) a través de su complemento «API Server» (http://127.0.0.1:26538/api/v1).
// La API pide autorizar a esta app una vez: la app de música muestra un aviso con «Permitir».
// El token se guarda en la carpeta de overlays (youtube-music.json).

const fs = require("fs");
const path = require("path");

const PUERTO_PREDETERMINADO = 26538;
const ID_CLIENTE = "editor-overlays-radio-bendicion";
const ARCHIVO = "youtube-music.json";
const CADA_MS = 1500; // como mucho una consulta a la app de música cada 1,5 s, aunque haya varios overlays abiertos

let carpeta = null;
let config = { puerto: PUERTO_PREDETERMINADO, token: null };
let estado = { conexion: "sin-consultar", cancion: null, actualizado: 0 };
let consultando = null;

function setCarpeta(nueva) {
  carpeta = nueva;
  config = { puerto: PUERTO_PREDETERMINADO, token: null };
  try { Object.assign(config, JSON.parse(fs.readFileSync(path.join(carpeta, ARCHIVO), "utf8"))); } catch {}
  estado = { conexion: "sin-consultar", cancion: null, actualizado: 0 };
}

function guardarConfig() {
  if (!carpeta) return;
  try { fs.writeFileSync(path.join(carpeta, ARCHIVO), JSON.stringify(config, null, 2), "utf8"); } catch {}
}

function base() {
  return `http://127.0.0.1:${config.puerto}`;
}

// Las portadas de YouTube Music vienen en miniatura (ej: =w60-h60); se piden a 544 px para que se vean nítidas.
function portadaGrande(url) {
  if (!url) return null;
  return url.replace(/=w\d+-h\d+/, "=w544-h544");
}

async function consultar() {
  const cabeceras = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  let r;
  try {
    r = await fetch(`${base()}/api/v1/song`, { headers: cabeceras, signal: AbortSignal.timeout(2500) });
  } catch {
    return { conexion: "sin-app", cancion: null };
  }
  if (r.status === 401 || r.status === 403) return { conexion: "sin-autorizar", cancion: null };
  if (r.status === 204) return { conexion: "ok", cancion: null };
  if (!r.ok) return { conexion: "error", cancion: null, detalle: `La app de música respondió ${r.status}` };
  const s = await r.json();
  if (!s || !s.title) return { conexion: "ok", cancion: null };
  return {
    conexion: "ok",
    cancion: {
      titulo: s.title,
      artista: s.artist || "",
      album: s.album || "",
      portada: portadaGrande(s.imageSrc),
      pausado: !!s.isPaused
    }
  };
}

// Devuelve el último estado conocido y, si ya pasó un rato, pide uno nuevo (sin hacer esperar a quien pregunta).
async function obtener({ esperar = false } = {}) {
  if (Date.now() - estado.actualizado > CADA_MS && !consultando) {
    consultando = consultar()
      .then(nuevo => { estado = { ...nuevo, actualizado: Date.now() }; })
      .finally(() => { consultando = null; });
  }
  if ((esperar || estado.conexion === "sin-consultar") && consultando) await consultando;
  return estado;
}

// Pide permiso a la app de música. Allá aparece un aviso que hay que aceptar; se espera hasta 60 s.
async function autorizar() {
  let r;
  try {
    r = await fetch(`${base()}/auth/${ID_CLIENTE}`, { method: "POST", signal: AbortSignal.timeout(60000) });
  } catch (err) {
    if (err && err.name === "TimeoutError") throw new Error("No se aceptó el aviso en la app de YouTube Music a tiempo. Intenta de nuevo.");
    throw new Error("No encontré la app de YouTube Music. Ábrela y activa el complemento «API Server».");
  }
  if (r.status === 403) throw new Error("En la app de YouTube Music se eligió no permitir la conexión.");
  if (!r.ok) throw new Error(`La app de YouTube Music respondió ${r.status}.`);
  const datos = await r.json();
  if (!datos.accessToken) throw new Error("La app de YouTube Music no entregó la autorización.");
  config.token = datos.accessToken;
  guardarConfig();
  estado.actualizado = 0;
  return obtener({ esperar: true });
}

function setPuerto(puerto) {
  const n = parseInt(puerto, 10);
  if (!(n > 0 && n < 65536)) throw new Error("El puerto debe ser un número entre 1 y 65535.");
  config.puerto = n;
  guardarConfig();
  estado.actualizado = 0;
}

function getPuerto() {
  return config.puerto;
}

module.exports = { setCarpeta, obtener, autorizar, setPuerto, getPuerto };
