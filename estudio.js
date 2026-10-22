// Herramientas de transmisión que no pertenecen a un overlay en particular:
//   - Programa al aire: con la programación de Horarios y la hora del PC, los rótulos de todos los overlays
//     («AL AIRE · MIÉRCOLES 19:00», nombre del programa y «Con …») muestran solos el programa que está al aire,
//     con sus presentadores. También se puede poner un programa a mano por un rato.
//   - Anuncios: lista de avisos que pasan uno tras otro por la franja inferior (ticker).
//   - Comentarios: un mensaje del público que se muestra encima de la transmisión (overlay propio de la app).
//   - Control remoto: PIN y sesiones de los celulares conectados por Wi-Fi.
// Todo se guarda en estudio.json, en la carpeta de los overlays (viaja con ella a otro PC).

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");

const ARCHIVO = "estudio.json";
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const NOMBRE_DIA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
// Un programa sin duración escrita se muestra hasta 4 horas después de su inicio (o hasta que empiece el siguiente)
const DURACION_PREDETERMINADA = 240;
const MAX_COMENTARIOS = 30;
const MAX_SESIONES = 30;

let carpeta = null;
let datos = predeterminados();

function predeterminados() {
  return {
    alAire: {
      modo: "apagado",       // "auto": según Horarios · "apagado": cada overlay usa sus propios textos
      anticipacion: 10,      // minutos antes de la hora en que el rótulo ya muestra el programa
      fijo: null,            // { nombre, presentador, desde, hasta }: programa puesto a mano
      fuera: { nombre: "Radio Bendición", detalle: "Al aire · Las 24 horas", presentador: "" }
    },
    programas: {},           // nombre → { presentador, duracion } (sin duracion = hasta 4 horas)
    anuncios: { activo: true, lista: null }, // null = todavía no se toman los del overlay
    comentarios: { posicion: "arriba-izquierda", segundos: 20, actual: null, recientes: [] },
    obs: { activo: false, host: "127.0.0.1", puerto: 4455, clave: "", escenaEspera: "", escenaFinal: "" },
    remoto: { activo: false, pin: "", sesiones: [] }
  };
}

function normalizar(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

function setCarpeta(nueva) {
  carpeta = nueva;
  datos = predeterminados();
  transicion = { vigente: null, pendiente: null, mantenido: null };
  if (!carpeta) return;
  try {
    const leido = JSON.parse(fs.readFileSync(path.join(carpeta, ARCHIVO), "utf8"));
    for (const k of Object.keys(datos)) {
      if (leido[k] && typeof leido[k] === "object" && !Array.isArray(leido[k])) datos[k] = { ...datos[k], ...leido[k] };
      else if (leido[k] !== undefined) datos[k] = leido[k];
    }
    datos.alAire.fuera = { ...predeterminados().alAire.fuera, ...datos.alAire.fuera };
  } catch {}
}

function guardar() {
  if (!carpeta) return;
  fs.writeFileSync(path.join(carpeta, ARCHIVO), JSON.stringify(datos, null, 2), "utf8");
}

function get() { return datos; }

// ---------- Programa al aire ----------

// La programación viene de Horarios: [["Lunes", [["19:00", "Programa"], ...]], ...]
function horario(programacion) {
  const lista = [];
  for (const [dia, items] of programacion || []) {
    const d = DIAS.indexOf(normalizar(dia));
    if (d < 0 || !Array.isArray(items)) continue;
    for (const [hora, nombre] of items) {
      const m = /^(\d{1,2})[:.](\d{2})/.exec(String(hora || "").trim());
      if (!m || !String(nombre || "").trim()) continue;
      lista.push({ dia: d, hora: `${m[1].padStart(2, "0")}:${m[2]}`, minuto: +m[1] * 60 + +m[2], nombre: String(nombre).trim() });
    }
  }
  return lista;
}

// Programas distintos de la programación, con sus horarios y lo que se guardó de cada uno
function catalogo(programacion) {
  const porNombre = new Map();
  for (const h of horario(programacion)) {
    if (!porNombre.has(h.nombre)) porNombre.set(h.nombre, { nombre: h.nombre, horarios: [] });
    porNombre.get(h.nombre).horarios.push(`${NOMBRE_DIA[h.dia]} ${h.hora}`);
  }
  return [...porNombre.values()].map(p => ({ ...p, ...infoPrograma(p.nombre) }));
}

function infoPrograma(nombre) {
  const p = datos.programas[nombre] || {};
  const fija = +p.duracion > 0;
  return { presentador: p.presentador || "", duracion: fija ? +p.duracion : DURACION_PREDETERMINADA, duracionFija: fija };
}

function hhmm(fecha) {
  return `${String(fecha.getHours()).padStart(2, "0")}:${String(fecha.getMinutes()).padStart(2, "0")}`;
}

// Qué programa está al aire ahora. null = los overlays usan sus propios textos.
// { nombre, presentador, dia, hora, fuera, fijo, hasta }
function alAire(programacion, ahora = new Date()) {
  const a = datos.alAire;
  if (a.fijo && Date.parse(a.fijo.hasta) > ahora.getTime()) {
    const desde = new Date(a.fijo.desde);
    // Si el programa también está hoy en la programación, el rótulo usa su hora oficial
    const hoy = horario(programacion).find(h => h.nombre === a.fijo.nombre && h.dia === ahora.getDay());
    return {
      nombre: a.fijo.nombre, presentador: a.fijo.presentador ?? infoPrograma(a.fijo.nombre).presentador,
      dia: NOMBRE_DIA[ahora.getDay()], hora: hoy ? hoy.hora : hhmm(desde), fijo: true, hasta: a.fijo.hasta
    };
  }
  if (a.modo !== "auto") return null;
  // Mientras se espera la confirmación de un cambio de programa (o si se pidió mantenerlo), sigue el que estaba
  const t = transicion, v = t.vigente;
  const p = v && v.fin > ahora.getTime() && (t.pendiente || t.mantenido) ? v : programaSegunHorario(programacion, ahora);
  if (p) {
    return {
      nombre: p.nombre, presentador: infoPrograma(p.nombre).presentador,
      dia: NOMBRE_DIA[p.dia], hora: p.hora, hasta: new Date(p.fin).toISOString()
    };
  }
  return { nombre: a.fuera.nombre, presentador: a.fuera.presentador, detalle: a.fuera.detalle, fuera: true };
}

// El programa que corresponde por la programación: el que empezó más tarde (contando la anticipación) y no ha terminado.
// { clave, nombre, dia, hora, inicio, fin } o null
function programaSegunHorario(programacion, ahora) {
  const lista = horario(programacion);
  const antes = (+datos.alAire.anticipacion || 0) * 60000;
  let mejor = null;
  // Se revisan ayer, hoy y mañana para los programas que cruzan la medianoche o empiezan pasada la medianoche
  for (const delta of [-1, 0, 1]) {
    const base = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() + delta);
    for (const h of lista) {
      if (h.dia !== base.getDay()) continue;
      const inicio = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(h.minuto / 60), h.minuto % 60).getTime();
      const fin = inicio + infoPrograma(h.nombre).duracion * 60000;
      if (ahora.getTime() >= inicio - antes && ahora.getTime() < fin && (!mejor || inicio > mejor.inicio)) {
        mejor = { clave: h.nombre + "|" + inicio, nombre: h.nombre, dia: h.dia, hora: h.hora, inicio, fin };
      }
    }
  }
  return mejor;
}

// ---------- Cambio de un programa al siguiente ----------
// Si un programa sigue al aire y llega la hora del siguiente (ej: 19:00 y 20:00), el rótulo no cambia de golpe:
// la app pide confirmar. Si nadie responde en 2 minutos, cambia sola. «Mantener» deja el programa actual
// hasta que termine (su duración o 4 horas). Al terminar un programa sin que venga otro, no se pregunta nada.
const ESPERA_CONFIRMAR_MS = 2 * 60000;
let transicion = { vigente: null, pendiente: null, mantenido: null };

// La revisa el servidor cada pocos segundos con la programación publicada. Devuelve true si cambió algo.
function actualizarTransicion(programacion, ahora = new Date()) {
  const antes = JSON.stringify(transicion);
  const t = transicion, a = datos.alAire;
  const fijo = a.fijo && Date.parse(a.fijo.hasta) > ahora.getTime();
  const cand = a.modo === "auto" && !fijo ? programaSegunHorario(programacion, ahora) : null;
  const v = t.vigente;
  if (!cand) {
    transicion = { vigente: null, pendiente: null, mantenido: null };
  } else if (!v || v.fin <= ahora.getTime() || v.clave === cand.clave) {
    transicion = { vigente: cand, pendiente: null, mantenido: null };
  } else if (t.mantenido && t.mantenido.clave === cand.clave) {
    // se pidió mantener el programa actual: no se vuelve a preguntar por este cambio
  } else if (!t.pendiente || t.pendiente.clave !== cand.clave) {
    t.pendiente = { ...cand, limite: ahora.getTime() + ESPERA_CONFIRMAR_MS };
    t.mantenido = null;
  } else if (ahora.getTime() >= t.pendiente.limite) {
    transicion = { vigente: cand, pendiente: null, mantenido: null };
  }
  return JSON.stringify(transicion) !== antes;
}

function responderTransicion(accion) {
  const t = transicion;
  const siguiente = t.pendiente || t.mantenido;
  if (!siguiente) return;
  if (accion === "cambiar") transicion = { vigente: { ...siguiente, limite: undefined }, pendiente: null, mantenido: null };
  else if (accion === "mantener" && t.pendiente) { t.mantenido = t.pendiente; t.pendiente = null; }
}

// Para las pantallas: { actual, pendiente: { nombre, hora, limite }, mantenido: { nombre, hora } }
function estadoTransicion() {
  const t = transicion;
  const info = x => x && { nombre: x.nombre, hora: x.hora, dia: NOMBRE_DIA[x.dia], limite: x.limite || null };
  return { actual: t.vigente ? t.vigente.nombre : null, pendiente: info(t.pendiente), mantenido: info(t.mantenido) };
}

function esMayusculas(s) {
  return /\p{L}/u.test(s) && s === s.toUpperCase();
}

// Respeta el estilo del diseño: «AL AIRE · MIÉRCOLES 19:00», «AL AIRE · 19:00» o «Al aire · Miércoles 19:00»
function textoDetalle(original, info) {
  let t;
  if (info.detalle != null) t = info.detalle;
  else {
    const conDia = DIAS.some(d => normalizar(original).includes(d));
    t = `Al aire · ${conDia ? info.dia + " " : ""}${info.hora}`;
  }
  return esMayusculas(original) ? t.toUpperCase() : t;
}

function textoPresentador(original, presentador) {
  const p = String(presentador || "").trim();
  if (!p) return "";
  if (/^con\s/i.test(original) && !/^con\s/i.test(p)) return "Con " + p;
  return p;
}

// ---------- Anuncios ----------

const SEPARADOR = " · ";

// La primera vez, la lista se arma con el texto que ya tiene la franja (separado por « · »)
function sembrarAnuncios(textoActual) {
  if (Array.isArray(datos.anuncios.lista)) return false;
  const partes = String(textoActual || "").split(/\s+·\s+/).map(s => s.trim()).filter(Boolean);
  datos.anuncios.lista = partes.map(texto => ({ id: nuevoId(), texto, activo: true, desde: null, hasta: null }));
  guardar();
  return true;
}

function nuevoId() {
  return crypto.randomBytes(5).toString("hex");
}

function fechaLocal(ahora) {
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
}

function anunciosVigentes(ahora = new Date()) {
  if (!datos.anuncios.activo || !Array.isArray(datos.anuncios.lista)) return null;
  const hoy = fechaLocal(ahora);
  return datos.anuncios.lista.filter(a => a.activo && a.texto.trim() && (!a.desde || a.desde <= hoy) && (!a.hasta || a.hasta >= hoy)).map(a => a.texto.trim());
}

// ---------- Lo que se aplica a cada overlay ----------

// Campos del overlay que manejan estas herramientas, con el valor que deben mostrar ahora.
// { textos: { id: { valor, motivo } }, props: { key: { valor, motivo } } }
function controlados(parsed, programacion, valores, ahora = new Date()) {
  const out = { textos: {}, props: {} };
  const info = alAire(programacion, ahora);
  if (info) {
    const motivo = "programa";
    const t = parsed.texts;
    for (let i = 0; i < t.length; i++) {
      if (!/^al aire\b/i.test(t[i].orig.trim())) continue;
      out.textos[t[i].id] = { valor: textoDetalle(t[i].orig, info), motivo };
      if (t[i + 1]) out.textos[t[i + 1].id] = { valor: info.nombre, motivo };
      if (t[i + 2] && /^con\s/i.test(t[i + 2].orig.trim())) out.textos[t[i + 2].id] = { valor: textoPresentador(t[i + 2].orig, info.presentador), motivo };
    }
    for (const p of parsed.props) {
      if (p.key === "programa") out.props.programa = { valor: info.nombre, motivo };
      else if (p.key === "detallePrograma") out.props.detallePrograma = { valor: textoDetalle(String(p.default || ""), info), motivo };
      else if (/^(presentador|presentadores|conductor)$/.test(p.key)) out.props[p.key] = { valor: String(info.presentador || ""), motivo };
    }
  }
  const ticker = parsed.props.find(p => p.key === "textoTicker");
  const anuncios = ticker ? anunciosVigentes(ahora) : null;
  if (ticker && anuncios && anuncios.length) {
    const texto = anuncios.join(SEPARADOR);
    out.props.textoTicker = { valor: texto, motivo: "anuncios" };
    // La franja da una vuelta en «velocidadTicker» segundos: con más texto, la vuelta se alarga para que
    // las letras pasen a la misma velocidad que con el texto original del diseño.
    const vel = parsed.props.find(p => p.key === "velocidadTicker");
    if (vel) {
      const base = valores && valores.props && "velocidadTicker" in valores.props ? +valores.props.velocidadTicker : +vel.default;
      const largoDiseno = String(ticker.default || "").length || texto.length;
      out.props.velocidadTicker = { valor: Math.round(base * Math.max(1, texto.length / largoDiseno)), motivo: "anuncios", oculto: true };
    }
  }
  return out;
}

// Mezcla los campos controlados con los valores del usuario, para generar el HTML del overlay
function aplicar(parsed, programacion, valores) {
  const c = controlados(parsed, programacion, valores);
  const out = { props: { ...(valores && valores.props) }, textos: { ...(valores && valores.textos) } };
  for (const [key, x] of Object.entries(c.props)) out.props[key] = x.valor;
  for (const [id, x] of Object.entries(c.textos)) {
    const f = parsed.texts.find(t => t.id === id);
    if (f) out.textos[id] = { o: f.orig, v: x.valor };
  }
  return out;
}

// ---------- Comentarios ----------

function mostrarComentario(c) {
  const nombre = String(c.nombre || "").trim().slice(0, 60);
  const texto = String(c.texto || "").trim().slice(0, 400);
  if (!texto) throw new Error("Escribe el comentario");
  const fuente = ["youtube", "facebook", "instagram", "tiktok", "whatsapp"].includes(c.fuente) ? c.fuente : "";
  const nuevo = { id: nuevoId(), nombre, texto, fuente, desde: Date.now() };
  const r = datos.comentarios;
  r.actual = nuevo;
  r.recientes = [nuevo, ...r.recientes.filter(x => x.nombre !== nombre || x.texto !== texto)].slice(0, MAX_COMENTARIOS);
  guardar();
  return nuevo;
}

function ocultarComentario() {
  datos.comentarios.actual = null;
  guardar();
}

// ---------- Control remoto ----------

const hash = s => crypto.createHash("sha256").update(String(s)).digest("hex");

function pinValido(pin) {
  return /^\d{4,8}$/.test(String(pin || ""));
}

function revisarPin(pin) {
  const a = Buffer.from(hash(String(pin || ""))), b = Buffer.from(hash(datos.remoto.pin || crypto.randomBytes(8).toString("hex")));
  return !!datos.remoto.pin && crypto.timingSafeEqual(a, b);
}

function nuevaSesion() {
  const token = crypto.randomBytes(24).toString("base64url");
  datos.remoto.sesiones = [hash(token), ...(datos.remoto.sesiones || [])].slice(0, MAX_SESIONES);
  guardar();
  return token;
}

function sesionValida(token) {
  return !!token && (datos.remoto.sesiones || []).includes(hash(token));
}

function cambiarPin(pin) {
  datos.remoto.pin = String(pin);
  datos.remoto.sesiones = []; // con el PIN nuevo, los celulares tienen que volver a entrar
  guardar();
}

// Direcciones de este PC en la red (Wi-Fi primero). Se dejan fuera los adaptadores virtuales.
function direcciones() {
  const lista = [];
  for (const [nombre, ifaces] of Object.entries(os.networkInterfaces())) {
    if (/vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Bluetooth|docker|vbox/i.test(nombre)) continue;
    for (const d of ifaces || []) {
      if ((d.family !== "IPv4" && d.family !== 4) || d.internal || d.address.startsWith("169.254.")) continue;
      const prioridad = /wi-?fi|wlan|inal[aá]mbrica|wireless/i.test(nombre) ? 0 : /ethernet|local/i.test(nombre) ? 1 : 2;
      lista.push({ interfaz: nombre, ip: d.address, prioridad });
    }
  }
  return lista.sort((a, b) => a.prioridad - b.prioridad);
}

function ejecutar(cmd, args) {
  return new Promise(resolve => {
    execFile(cmd, args, { windowsHide: true, timeout: 5000, encoding: "latin1" }, (err, salida) => resolve(err ? "" : String(salida || "")));
  });
}

// Nombre de la red Wi-Fi y si Windows la tiene como «Privada» (en una red «Pública» Windows bloquea a los celulares)
let cacheRed = { t: 0, red: null };
async function infoRed() {
  if (process.platform !== "win32") return { wifi: null, categoria: null };
  if (Date.now() - cacheRed.t < 15000 && cacheRed.red) return cacheRed.red;
  const [wlan, categoria] = await Promise.all([
    ejecutar("netsh", ["wlan", "show", "interfaces"]),
    ejecutar("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-NetConnectionProfile | Where-Object { $_.IPv4Connectivity -ne 'Disconnected' } | Select-Object -ExpandProperty NetworkCategory) -join ','"])
  ]);
  const m = /^\s*SSID\s*:\s*(.+?)\s*$/m.exec(wlan);
  const cats = categoria.trim().split(",").map(s => s.trim()).filter(Boolean);
  const red = { wifi: m ? m[1] : null, categoria: cats.length ? (cats.includes("Public") ? "Public" : cats[0]) : null };
  cacheRed = { t: Date.now(), red };
  return red;
}

module.exports = {
  setCarpeta, guardar, get, catalogo, alAire, controlados, actualizarTransicion, responderTransicion, estadoTransicion, aplicar, horario, infoPrograma,
  sembrarAnuncios, anunciosVigentes, nuevoId, mostrarComentario, ocultarComentario,
  pinValido, revisarPin, nuevaSesion, sesionValida, cambiarPin, direcciones, infoRed,
  NOMBRE_DIA, DURACION_PREDETERMINADA
};
