// Control de OBS: se conecta al servidor WebSocket que trae OBS (28 o más nuevo, protocolo obs-websocket 5).
// En OBS: Herramientas → Configuración del servidor WebSocket → «Habilitar servidor WebSocket».
// Desde aquí se cambian escenas, se inicia o detiene la transmisión y la grabación, y se silencian las
// fuentes de audio. Si OBS se cierra, la conexión se reintenta sola cada pocos segundos.

const crypto = require("crypto");

const REINTENTO_MS = 4000;
const CADA_ESTADO_MS = 2000;
const ESPERA_RESPUESTA_MS = 6000;
// Eventos: General (1) + Escenas (4) + Entradas (8) + Salidas (64) + Interfaz (1024)
const SUSCRIPCIONES = 1 | 4 | 8 | 64 | 1024;
// Fuentes que no son de audio (o que son los mismos overlays) no se ofrecen para silenciar
const NO_AUDIO = /browser_source|text_|image_source|color_source|monitor_capture|window_capture|game_capture|slideshow|scene|group/;

let config = { activo: false, host: "127.0.0.1", puerto: 4455, clave: "" };
let ws = null;
let tReintento = null, tEstado = null;
let pedidos = new Map(), contador = 0;
let alCambiar = () => {};

const vacio = () => ({
  conexion: "apagado", detalle: null, version: null,
  escenas: [], escena: null, audio: [],
  transmision: { activa: false, tiempo: null, congestion: 0, perdidos: 0, total: 0, reconectando: false },
  grabacion: { activa: false, pausada: false, tiempo: null },
  stats: null
});
let estado = vacio();

function avisar() { alCambiar(obtener()); }

function obtener() {
  return JSON.parse(JSON.stringify(estado));
}

function configurar(nueva) {
  config = { ...config, ...nueva };
  config.puerto = parseInt(config.puerto, 10) || 4455;
  desconectar();
  estado = { ...vacio(), conexion: config.activo ? "conectando" : "apagado" };
  avisar();
  if (config.activo) conectar();
}

function desconectar() {
  clearTimeout(tReintento); tReintento = null;
  clearInterval(tEstado); tEstado = null;
  if (ws) { ws.onclose = ws.onerror = ws.onmessage = null; try { ws.close(); } catch {} ws = null; }
  for (const p of pedidos.values()) p.reject(new Error("Se cortó la conexión con OBS"));
  pedidos.clear();
}

function reintentar() {
  clearTimeout(tReintento);
  if (config.activo) tReintento = setTimeout(conectar, REINTENTO_MS);
}

function conectar() {
  desconectar();
  if (typeof WebSocket === "undefined") {
    estado = { ...vacio(), conexion: "error", detalle: "Esta versión de la app no puede conectarse a OBS." };
    return avisar();
  }
  let socket;
  try { socket = new WebSocket(`ws://${config.host}:${config.puerto}`); }
  catch (err) { estado = { ...vacio(), conexion: "error", detalle: err.message }; avisar(); return reintentar(); }
  ws = socket;
  socket.onmessage = e => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.op === 0) identificar(socket, m.d);
    else if (m.op === 2) alIdentificar();
    else if (m.op === 5) alEvento(m.d);
    else if (m.op === 7) alResponder(m.d);
  };
  socket.onerror = () => {};
  socket.onclose = e => {
    if (ws !== socket) return;
    ws = null;
    clearInterval(tEstado); tEstado = null;
    for (const p of pedidos.values()) p.reject(new Error("Se cortó la conexión con OBS"));
    pedidos.clear();
    const conexion = e.code === 4009 ? "clave" : "sin-obs";
    const detalle = e.code === 4009 ? "La contraseña no coincide con la de OBS." : e.code === 4010 ? "Esta versión de OBS es muy antigua (se necesita OBS 28 o más nuevo)." : null;
    estado = { ...vacio(), conexion, detalle };
    avisar();
    // Con la contraseña equivocada no tiene sentido insistir hasta que la cambien
    if (conexion !== "clave") reintentar();
  };
}

function identificar(socket, hola) {
  const d = { rpcVersion: 1, eventSubscriptions: SUSCRIPCIONES };
  if (hola.authentication) {
    const { challenge, salt } = hola.authentication;
    const secreto = crypto.createHash("sha256").update(config.clave + salt).digest("base64");
    d.authentication = crypto.createHash("sha256").update(secreto + challenge).digest("base64");
  }
  estado.version = hola.obsWebSocketVersion || null;
  socket.send(JSON.stringify({ op: 1, d }));
}

async function alIdentificar() {
  estado.conexion = "ok";
  estado.detalle = null;
  try {
    await Promise.all([leerEscenas(), leerAudio(), leerSalidas()]);
  } catch {}
  avisar();
  tEstado = setInterval(() => leerSalidas().then(avisar, () => {}), CADA_ESTADO_MS);
  // Si OBS se abrió antes que el editor, sus fuentes de overlays quedaron en blanco: se recargan al conectarse.
  // Durante una transmisión o grabación no se tocan (se recargan con el botón, si hace falta).
  if (!estado.transmision.activa && !estado.grabacion.activa) recargarOverlays().catch(() => {});
}

// Recarga en OBS las fuentes «Navegador» que muestran overlays de este editor (enlaces 127.0.0.1:7878)
async function recargarOverlays() {
  const r = await pedir("GetInputList", { inputKind: "browser_source" });
  let n = 0;
  for (const i of r.inputs || []) {
    try {
      const s = (await pedir("GetInputSettings", { inputName: i.inputName })).inputSettings || {};
      if (s.is_local_file || !/\/\/(127\.0\.0\.1|localhost):7878\//.test(s.url || "")) continue;
      await pedir("PressInputPropertiesButton", { inputName: i.inputName, propertyName: "refreshnocache" });
      n++;
    } catch {}
  }
  return n;
}

function alResponder(d) {
  const p = pedidos.get(d.requestId);
  if (!p) return;
  pedidos.delete(d.requestId);
  clearTimeout(p.t);
  if (d.requestStatus && d.requestStatus.result) p.resolve(d.responseData || {});
  else p.reject(new Error((d.requestStatus && d.requestStatus.comment) || "OBS rechazó la orden"));
}

function pedir(tipo, datos) {
  return new Promise((resolve, reject) => {
    if (!ws || estado.conexion !== "ok") return reject(new Error("OBS no está conectado"));
    const id = "p" + (++contador);
    const t = setTimeout(() => { pedidos.delete(id); reject(new Error("OBS no respondió")); }, ESPERA_RESPUESTA_MS);
    pedidos.set(id, { resolve, reject, t });
    ws.send(JSON.stringify({ op: 6, d: { requestType: tipo, requestId: id, requestData: datos || {} } }));
  });
}

async function leerEscenas() {
  const r = await pedir("GetSceneList");
  // OBS las entrega al revés de como se ven en su lista
  estado.escenas = (r.scenes || []).slice().sort((a, b) => b.sceneIndex - a.sceneIndex).map(s => s.sceneName);
  estado.escena = r.currentProgramSceneName || null;
}

async function leerAudio() {
  const r = await pedir("GetInputList");
  const lista = [];
  for (const i of r.inputs || []) {
    if (NO_AUDIO.test(i.inputKind || "")) continue;
    try {
      const m = await pedir("GetInputMute", { inputName: i.inputName });
      lista.push({ nombre: i.inputName, silenciado: !!m.inputMuted });
    } catch {} // sin audio
  }
  estado.audio = lista;
}

async function leerSalidas() {
  const [t, g, s] = await Promise.all([
    pedir("GetStreamStatus").catch(() => null),
    pedir("GetRecordStatus").catch(() => null),
    pedir("GetStats").catch(() => null)
  ]);
  if (t) estado.transmision = {
    activa: !!t.outputActive, reconectando: !!t.outputReconnecting,
    tiempo: t.outputActive ? (t.outputTimecode || "").replace(/\.\d+$/, "") : null,
    congestion: t.outputCongestion || 0, perdidos: t.outputSkippedFrames || 0, total: t.outputTotalFrames || 0
  };
  if (g) estado.grabacion = {
    activa: !!g.outputActive, pausada: !!g.outputPaused,
    tiempo: g.outputActive ? (g.outputTimecode || "").replace(/\.\d+$/, "") : null
  };
  if (s) estado.stats = {
    cpu: Math.round(s.cpuUsage || 0), fps: Math.round(s.activeFps || 0),
    renderPerdidos: s.renderSkippedFrames || 0, renderTotal: s.renderTotalFrames || 0
  };
}

function alEvento(d) {
  const e = d.eventData || {};
  switch (d.eventType) {
    case "CurrentProgramSceneChanged": estado.escena = e.sceneName; break;
    case "SceneListChanged":
      estado.escenas = (e.scenes || []).slice().sort((a, b) => b.sceneIndex - a.sceneIndex).map(s => s.sceneName);
      break;
    case "SceneNameChanged":
      if (estado.escena === e.oldSceneName) estado.escena = e.sceneName;
      estado.escenas = estado.escenas.map(n => n === e.oldSceneName ? e.sceneName : n);
      break;
    case "InputMuteStateChanged": {
      const a = estado.audio.find(x => x.nombre === e.inputName);
      if (a) a.silenciado = !!e.inputMuted;
      break;
    }
    case "InputCreated": case "InputRemoved": case "InputNameChanged":
      leerAudio().then(avisar, () => {});
      return;
    case "StreamStateChanged": estado.transmision.activa = !!e.outputActive; break;
    case "RecordStateChanged": estado.grabacion.activa = !!e.outputActive; break;
    case "ExitStarted":
      estado = { ...vacio(), conexion: "sin-obs" };
      break;
    default: return;
  }
  avisar();
}

async function cambiarEscena(nombre) {
  await pedir("SetCurrentProgramScene", { sceneName: nombre });
  estado.escena = nombre;
  avisar();
}

async function salida(cual, accion) {
  const tipo = { transmision: "Stream", grabacion: "Record" }[cual];
  if (!tipo || !["iniciar", "detener"].includes(accion)) throw new Error("Orden no válida");
  await pedir((accion === "iniciar" ? "Start" : "Stop") + tipo);
  setTimeout(() => leerSalidas().then(avisar, () => {}), 800);
}

async function silenciar(nombre, silenciado) {
  await pedir("SetInputMute", { inputName: nombre, inputMuted: !!silenciado });
  const a = estado.audio.find(x => x.nombre === nombre);
  if (a) a.silenciado = !!silenciado;
  avisar();
}

module.exports = {
  configurar, obtener, cambiarEscena, salida, silenciar, recargarOverlays,
  alCambiar: fn => { alCambiar = fn; }
};
