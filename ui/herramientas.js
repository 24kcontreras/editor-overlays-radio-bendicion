"use strict";

// Herramientas de transmisión (menú «Transmisión» de la izquierda): OBS, Programa al aire, Anuncios,
// Comentarios y Control remoto. Usa las funciones de app.js ($, el, api, toast, copiar, estado...).

const ICONOS = {
  obs: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.2"/>',
  programa: '<path d="M4 7h16v12H4z"/><path d="m8 3 4 4 4-4"/>',
  anuncios: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  comentarios: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  remoto: '<rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/>',
  sincronizacion: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16"/><path d="M3 21v-5h5"/><path d="M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v4"/>',
  micOff: '<path d="m2 2 20 20"/><path d="M9 9v2a3 3 0 0 0 5.1 2.1"/><path d="M15 9.3V5a3 3 0 0 0-5.9-.8"/><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.6 6"/><path d="M12 18v4"/>'
};

const HERRAMIENTAS = [
  { id: "obs", nombre: "En vivo · OBS", pintar: vistaObs, cargar: () => api("/api/obs"), cada: 1000 },
  { id: "programa", nombre: "Programa al aire", pintar: vistaPrograma, cargar: () => api("/api/estudio"), cada: 15000 },
  { id: "anuncios", nombre: "Anuncios", pintar: vistaAnuncios, cargar: () => api("/api/estudio") },
  { id: "comentarios", nombre: "Comentarios", pintar: vistaComentarios, cargar: () => api("/api/comentarios") },
  { id: "remoto", nombre: "Control remoto", pintar: vistaRemoto, cargar: () => api("/api/remoto/config"), cada: 10000 },
  { id: "sincronizacion", nombre: "Sincronización", pintar: vistaSincronizacion, cargar: cargarSincronizacion, cada: 15000 }
];

const H = { datos: null, tPoll: null, pendiente: false, firma: "", vivos: null };

function icono(nombre, tam = 18) {
  const s = el("span", { class: "icono-svg", "aria-hidden": "true" });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${tam}" height="${tam}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[nombre]}</svg>`;
  return s;
}

function postear(ruta, cuerpo) {
  return api(ruta, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo || {}) });
}

function tarjeta(titulo, ...hijos) {
  return el("section", { class: "tarjeta" }, titulo ? el("h2", {}, titulo) : null, ...hijos);
}

function herramienta() {
  return HERRAMIENTAS.find(h => h.id === estado.herramienta) || null;
}

// ---------- Menú y navegación ----------

function pintarHerramientas() {
  $("#listaHerramientas").replaceChildren(...HERRAMIENTAS.map(h => el("li", {},
    el("button", { type: "button", "aria-current": String(estado.herramienta === h.id), onclick: () => abrirHerramienta(h.id) },
      el("span", { class: "nav-herramienta" }, icono(h.id), el("span", {}, h.nombre)),
      h.id === "obs" ? el("span", { class: "punto-estado " + (H.obsVivo ? "rojo" : "gris"), id: "puntoObs", title: H.obsVivo ? "Transmitiendo" : "" }) : null))));
}

async function abrirHerramienta(id) {
  await guardarAhora();
  await publicarAutoYa();
  estado.herramienta = id;
  try { localStorage.setItem("vistaActual", "h:" + id); } catch {}
  document.querySelector(".layout").classList.add("modo-herramienta");
  $("#editor").hidden = true;
  $("#panel").hidden = true;
  $("#vacio").hidden = true;
  $("#herramienta").hidden = false;
  H.datos = null;
  H.firma = "";
  pintarLista();
  pintarHerramientas();
  $("#herramienta").replaceChildren(el("p", { class: "versos-estado" }, "Cargando…"));
  clearInterval(H.tPoll);
  const h = herramienta();
  if (h.cada) H.tPoll = setInterval(() => recargarHerramienta(), h.cada);
  await recargarHerramienta(true);
}

function cerrarHerramienta() {
  if (!estado.herramienta) return;
  estado.herramienta = null;
  clearInterval(H.tPoll);
  H.tPoll = null;
  document.querySelector(".layout").classList.remove("modo-herramienta");
  $("#herramienta").hidden = true;
  pintarHerramientas();
}

function escribiendo() {
  const a = document.activeElement;
  return !!a && $("#herramienta").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox";
}

// Vuelve a pedir los datos y repinta. Si se está escribiendo en un campo, se espera a que salga de él.
async function recargarHerramienta(forzar) {
  const h = herramienta();
  if (!h) return;
  let datos;
  try { datos = await h.cargar(); } catch (err) { if (forzar) $("#herramienta").replaceChildren(el("p", { class: "versos-estado error" }, err.message)); return; }
  if (herramienta() !== h) return;
  pintarConDatos(datos, forzar);
}

function pintarConDatos(datos, forzar) {
  const h = herramienta();
  H.datos = datos;
  if (h.id === "obs") actualizarPuntoObs(datos);
  // OBS se consulta cada segundo: si solo cambiaron los relojes, se actualizan sin repintar (así no se pierden clics)
  if (h.id === "obs" && !forzar && H.vivos && firmaObs(datos) === H.firma) return actualizarVivosObs(datos);
  if (!forzar && escribiendo()) { H.pendiente = true; return; }
  H.pendiente = false;
  const cont = $("#herramienta");
  const scroll = cont.scrollTop;
  H.vivos = null;
  cont.replaceChildren(...h.pintar(datos));
  cont.scrollTop = scroll;
  if (h.id === "obs") { H.firma = firmaObs(datos); actualizarVivosObs(datos); }
}

document.addEventListener("focusout", () => {
  setTimeout(() => { if (H.pendiente && !escribiendo() && H.datos) pintarConDatos(H.datos); }, 0);
});

function cabecera(titulo, texto, ...extra) {
  return el("div", { class: "cabecera-herramienta" },
    el("div", {}, el("h1", {}, titulo), el("p", {}, texto)), ...extra);
}

// Hace una acción en el servidor y repinta con lo que devuelve
async function hacer(ruta, cuerpo, mensaje) {
  try {
    const r = await postear(ruta, cuerpo);
    if (estado.herramienta) pintarConDatos(r, true);
    if (mensaje) toast(mensaje);
    return r;
  } catch (err) {
    toast(err.message, "error");
    return null;
  }
}

// ---------- Aviso de cambio de programa ----------
// Cuando llega la hora del siguiente programa y el anterior sigue al aire, se pide confirmar el cambio del rótulo
// (en cualquier pantalla de la app). Si nadie responde, el servidor cambia solo al terminar la cuenta.

const AVISO = { datos: null, t: null, notificado: null };

async function revisarAvisoCambio() {
  try { AVISO.datos = (await api("/api/estudio")).transicion; } catch { return; }
  pintarAvisoCambio();
}

function pintarAvisoCambio() {
  const caja = $("#avisoCambio");
  const t = AVISO.datos;
  clearInterval(AVISO.t);
  if (!t || (!t.pendiente && !t.mantenido)) { caja.hidden = true; return; }
  const responder = accion => postear("/api/estudio/transicion", { accion })
    .then(r => {
      AVISO.datos = r.transicion;
      pintarAvisoCambio();
      if (estado.herramienta === "programa") pintarConDatos(r, true);
      toast(accion === "cambiar" ? "El rótulo cambió de programa." : `Se mantiene «${t.actual}».`);
    })
    .catch(err => toast(err.message, "error"));
  if (t.pendiente) {
    const p = t.pendiente;
    const reloj = el("strong", { class: "aviso-reloj" });
    const tic = () => { reloj.textContent = mmss(p.limite - Date.now()); };
    tic();
    AVISO.t = setInterval(tic, 1000);
    caja.replaceChildren(
      el("div", { class: "aviso-texto" },
        el("strong", {}, `Son las ${p.hora}: empieza «${p.nombre}»`),
        el("span", {}, `«${t.actual}» sigue en los rótulos. Cambian solos en `, reloj, ".")),
      el("div", { class: "aviso-botones" },
        el("button", { class: "btn btn-primario btn-chico", type: "button", onclick: () => responder("cambiar") }, "Cambiar ahora"),
        el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => responder("mantener") }, `Mantener «${t.actual}»`)));
    // Aviso de Windows, por si la app está minimizada (una vez por cambio)
    const clave = p.nombre + p.limite;
    if (AVISO.notificado !== clave) {
      AVISO.notificado = clave;
      try { if (window.Notification) new Notification("Cambio de programa", { body: `Empieza «${p.nombre}». Confirma el cambio en el Editor de Overlays.` }); } catch {}
    }
  } else {
    const m = t.mantenido;
    caja.replaceChildren(
      el("div", { class: "aviso-texto" },
        el("strong", {}, `Se mantiene «${t.actual}» en los rótulos`),
        el("span", {}, `«${m.nombre}» empezaba a las ${m.hora}.`)),
      el("div", { class: "aviso-botones" },
        el("button", { class: "btn btn-primario btn-chico", type: "button", onclick: () => responder("cambiar") }, `Cambiar a «${m.nombre}»`)));
  }
  caja.hidden = false;
}

// ---------- Sincronización (PC de preparación → PC de transmisión) y actualizaciones de la app ----------

async function cargarSincronizacion() {
  const d = await api("/api/sincronizacion");
  d.app = H.app = escritorio && escritorio.actualizacion ? await escritorio.actualizacion() : null;
  return d;
}

function cuando(iso) {
  if (!iso) return "nunca";
  const f = new Date(iso), hoy = new Date();
  const hora = f.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  if (f.toDateString() === hoy.toDateString()) return `hoy a las ${hora}`;
  return `${f.toLocaleDateString("es-CL", { weekday: "long", day: "numeric", month: "long" })} a las ${hora}`;
}

function vistaSincronizacion(d) {
  const out = [cabecera("Sincronización", "En el PC de preparación se arman los cambios y se envían; el PC de transmisión los recibe solo. La app también se actualiza sola.")];
  const rol = (id, titulo, texto) => el("button", { type: "button", class: "rol" + (d.rol === id ? " elegido" : ""), "aria-pressed": String(d.rol === id),
    onclick: () => { if (d.rol !== id) hacer("/api/sincronizacion/config", { rol: id }, `Este PC quedó como PC de ${titulo.toLowerCase()}.`).then(() => recargarHerramienta(true)); } },
    el("strong", {}, titulo), el("span", {}, texto));
  out.push(tarjeta("Este PC es el de…", el("div", { class: "roles" },
    rol("preparacion", "Preparación", "Aquí se cambian textos, programación, presentadores, anuncios y diseños, y se envían."),
    rol("transmision", "Transmisión", "Aquí está OBS. Recibe solo lo que se envía desde el PC de preparación."))));

  if (d.rol === "preparacion") {
    const t = tarjeta("Enviar al PC de transmisión");
    if (d.sesion === false) {
      const token = el("input", { type: "password", placeholder: "Token de GitHub", autocomplete: "off", "aria-label": "Token de GitHub" });
      t.append(el("div", { class: "aviso" }, el("strong", {}, "Este PC no tiene sesión de GitHub. "), "Pega un token con permiso para escribir en ", el("code", {}, d.repo), "."),
        el("div", { class: "fila-botones" }, token, el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => hacer("/api/sincronizacion/config", { token: token.value }, "Token guardado.").then(() => recargarHerramienta(true)) }, "Guardar")));
    }
    t.append(
      el("div", { class: "estado-linea" },
        el("span", { class: "punto-estado " + (d.cambiosSinEnviar ? "ambar" : "verde") }),
        el("strong", {}, d.cambiosSinEnviar ? "Hay cambios que el PC de transmisión todavía no tiene" : "El PC de transmisión tiene lo último"),
        el("span", { class: "tenue" }, `Último envío: ${cuando(d.ultimoEnvio)}`)),
      el("div", { class: "fila-botones" },
        el("button", { class: "btn btn-primario", type: "button", disabled: d.trabajando || d.sesion === false,
          onclick: e => { e.currentTarget.disabled = true; e.currentTarget.textContent = "Enviando…"; hacer("/api/sincronizacion/enviar", {}, "¡Listo! El PC de transmisión lo recibirá en unos minutos.").then(r => { if (!r) recargarHerramienta(true); }); } }, "Enviar al PC de transmisión")),
      el("p", { class: "nota-campo" }, "Se envían los diseños, lo publicado en cada overlay (lo que está en borrador no), la programación, los presentadores, los anuncios y las opciones de los rótulos y comentarios. No se envía lo que es de cada PC: la conexión con OBS, el control remoto, el versículo en pantalla ni los comentarios."));
    out.push(t);
  } else if (d.rol === "transmision") {
    const t = tarjeta("Recibir del PC de preparación",
      el("div", { class: "estado-linea" },
        el("span", { class: "punto-estado " + (d.error ? "rojo" : d.pendiente ? "ambar" : "verde") }),
        el("strong", {}, d.pendiente ? "Hay cambios nuevos esperando" : "Al día"),
        el("span", { class: "tenue" }, `Último recibido: ${cuando(d.ultimoRecibido)}`)));
    if (d.pendiente) {
      t.append(el("p", {}, "Llegaron cambios mientras se transmite. Se aplicarán solos al terminar, o ahora con el botón (los overlays cambian con el fundido de siempre)."),
        el("button", { class: "btn btn-primario btn-chico", type: "button", onclick: () => hacer("/api/sincronizacion/aplicar", {}, "Cambios aplicados.") }, "Aplicar ahora"));
    }
    t.append(el("div", { class: "fila-botones" },
      el("button", { class: "btn btn-suave btn-chico", type: "button", disabled: d.trabajando, onclick: () => hacer("/api/sincronizacion/revisar", {}).then(r => { if (r && !r.pendiente) toast(r.error || "No hay cambios nuevos."); }) }, "Buscar cambios ahora")),
      el("p", { class: "nota-campo" }, "Revisa cada 2 minutos. Lo que es de este PC (OBS, control remoto, versículo en pantalla, comentarios, programa puesto a mano) no se toca."));
    out.push(t);
  } else {
    out.push(tarjeta(null, el("p", { class: "tenue" }, "Elige qué PC es este para empezar.")));
  }
  if (d.error) out.push(el("p", { class: "nota-biblia error" }, d.error));

  // Versión de la app
  const a = d.app || H.app; // las respuestas de las acciones no traen la versión
  if (a) {
    const textos = {
      "sin-revisar": "Se revisa al abrir la app y cada 4 horas.", revisando: "Buscando una versión nueva…", "al-dia": "Es la versión más reciente.",
      descargando: `Descargando la versión ${a.version}…`, lista: `La versión ${a.version} está lista: se instalará al cerrar la app.`,
      error: `No se pudo revisar: ${a.error}`, desarrollo: "Versión de desarrollo."
    };
    out.push(tarjeta("La app",
      el("div", { class: "estado-linea" }, el("strong", {}, `Versión ${a.actual}`), el("span", { class: "tenue" }, textos[a.estado] || "")),
      el("div", { class: "fila-botones" },
        a.estado === "lista"
          ? el("button", { class: "btn btn-primario btn-chico", type: "button", onclick: () => { if (confirm("La app se cerrará un momento para actualizarse. ¿Seguir?")) escritorio.instalarActualizacion(); } }, "Reiniciar y actualizar")
          : el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => escritorio.revisarActualizacion().then(() => setTimeout(() => recargarHerramienta(true), 2500)) }, "Buscar actualización"))));
  }
  return out;
}

// Aviso discreto abajo a la izquierda cuando hay una versión nueva lista
function pintarVersion(a) {
  const caja = $("#versionApp");
  if (!caja || !a) return;
  caja.replaceChildren(a.estado === "lista"
    ? el("button", { class: "btn btn-link", type: "button", onclick: () => abrirHerramienta("sincronizacion") }, `● Versión ${a.version} lista para instalar`)
    : `Versión ${a.actual || ""}`);
}

if (escritorio && escritorio.actualizacion) {
  escritorio.actualizacion().then(pintarVersion);
  escritorio.alActualizar(a => { escritorio.actualizacion().then(pintarVersion); if (estado.herramienta === "sincronizacion") recargarHerramienta(); });
}

// Eventos del servidor (app.js los reenvía)
function eventoHerramientas(d) {
  if (d.tipo === "sincronizacion") {
    if (d.aplicado) toast("Llegaron cambios del PC de preparación.");
    if (estado.herramienta === "sincronizacion") recargarHerramienta();
  }
  if (d.tipo === "estudio" || d.tipo === "carpeta") revisarAvisoCambio();
  if (d.tipo === "obs" && estado.herramienta === "obs") recargarHerramienta();
  if (d.tipo === "estudio" && (estado.herramienta === "programa" || estado.herramienta === "anuncios")) recargarHerramienta();
  if (d.tipo === "comentario" && estado.herramienta === "comentarios") recargarHerramienta();
  if (d.tipo === "obs") api("/api/obs").then(actualizarPuntoObs, () => {});
}

function actualizarPuntoObs(o) {
  const vivo = !!(o && o.conexion === "ok" && o.transmision && o.transmision.activa);
  if (vivo === H.obsVivo) return;
  H.obsVivo = vivo;
  pintarHerramientas();
}

// ---------- En vivo · OBS ----------

const TEXTO_CONEXION = {
  apagado: ["gris", "Sin conectar"],
  conectando: ["ambar", "Conectando con OBS…"],
  "sin-obs": ["ambar", "OBS está cerrado o no tiene activado el servidor WebSocket. Se reintenta solo."],
  clave: ["rojo", "La contraseña no coincide con la de OBS."],
  error: ["rojo", "No se pudo conectar."],
  ok: ["verde", "Conectado a OBS"]
};

function firmaObs(o) {
  return JSON.stringify([o.conexion, o.detalle, o.escena, o.escenas, o.audio, o.transmision.activa, o.grabacion.activa, o.grabacion.pausada, !!o.cuenta, o.cuenta && o.cuenta.fin, o.config]);
}

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function salud(o) {
  const t = o.transmision, partes = [];
  let nivel = "verde";
  if (t.activa && t.total > 0) {
    const pct = t.perdidos / t.total * 100;
    if (pct > 5 || t.reconectando) nivel = "rojo"; else if (pct > 1) nivel = "ambar";
    partes.push(`Cuadros perdidos: ${pct.toFixed(1).replace(".", ",")} %`);
  }
  if (o.stats) {
    partes.push(`CPU ${o.stats.cpu} %`, `${o.stats.fps} fps`);
    if (o.stats.cpu > 85 && nivel === "verde") nivel = "ambar";
  }
  if (t.reconectando) partes.unshift("Reconectando…");
  return { nivel, texto: partes.join(" · ") };
}

// Lo que cambia cada segundo (relojes, cuenta regresiva, salud) se actualiza sin repintar la vista
function actualizarVivosObs(o) {
  const v = H.vivos;
  if (!v) return;
  if (v.tiempoT) v.tiempoT.textContent = o.transmision.activa ? o.transmision.tiempo || "" : "Fuera del aire";
  if (v.tiempoG) v.tiempoG.textContent = o.grabacion.activa ? (o.grabacion.pausada ? "En pausa · " : "") + (o.grabacion.tiempo || "") : "Sin grabar";
  if (v.salud) {
    const s = salud(o);
    v.salud.className = "salud " + s.nivel;
    v.salud.textContent = s.texto;
  }
  if (v.cuenta && o.cuenta) v.cuenta.textContent = mmss(o.cuenta.fin - Date.now());
}

function vistaObs(o) {
  H.vivos = {};
  const [color, texto] = TEXTO_CONEXION[o.conexion] || TEXTO_CONEXION.error;
  const c = o.config;
  const out = [cabecera("En vivo · OBS", "Cambia de escena, inicia la transmisión y controla el audio sin salir de la app.")];

  // Conexión
  const host = el("input", { type: "text", value: c.host, "aria-label": "Equipo de OBS" });
  const puerto = el("input", { type: "number", value: c.puerto, min: 1, max: 65535, "aria-label": "Puerto" });
  const clave = el("input", { type: "password", value: "", placeholder: c.tieneClave ? "•••••••• (guardada)" : "Contraseña de OBS", "aria-label": "Contraseña", autocomplete: "off" });
  const conectar = () => hacer("/api/obs/config", { activo: true, host: host.value, puerto: puerto.value, ...(clave.value ? { clave: clave.value } : {}) });
  clave.addEventListener("keydown", e => { if (e.key === "Enter") conectar(); });
  const verDatos = o.conexion !== "ok" || H.verDatosObs;
  const conexion = tarjeta("Conexión",
    el("div", { class: "estado-linea" }, el("span", { class: `punto-estado ${color}` }), el("strong", {}, texto),
      o.conexion === "ok" && o.version ? el("span", { class: "tenue" }, `WebSocket ${o.version}`) : null,
      o.conexion === "ok" ? el("button", { class: "btn btn-link", type: "button", onclick: () => { H.verDatosObs = !H.verDatosObs; pintarConDatos(o, true); } }, H.verDatosObs ? "Ocultar datos" : "Cambiar datos") : null),
    o.detalle ? el("p", { class: "nota-biblia error" }, o.detalle) : null);
  if (verDatos) {
    if (o.conexion !== "ok") {
      conexion.append(el("ol", { class: "pasos-cortos" },
        el("li", {}, "En OBS, abre ", el("strong", {}, "Herramientas → Configuración del servidor WebSocket"), "."),
        el("li", {}, "Marca ", el("strong", {}, "Habilitar servidor WebSocket"), " y presiona ", el("strong", {}, "Mostrar información de conexión"), "."),
        el("li", {}, "Copia la ", el("strong", {}, "contraseña"), ", pégala aquí abajo y presiona ", el("strong", {}, "Conectar"), ". Solo se hace una vez.")));
    }
    conexion.append(el("div", { class: "fila-campos" },
      el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "Equipo"), host),
      el("label", { class: "campo chico" }, el("span", { class: "etiqueta" }, "Puerto"), puerto),
      el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "Contraseña"), clave)),
      el("div", { class: "fila-botones" },
        el("button", { class: "btn btn-primario btn-chico", type: "button", onclick: conectar }, c.activo ? "Guardar y reconectar" : "Conectar"),
        c.activo ? el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => hacer("/api/obs/config", { activo: false }) }, "Desconectar") : null),
      el("p", { class: "nota-campo" }, "«127.0.0.1» es este mismo PC. Si OBS no pide contraseña, deja ese campo vacío."));
  }
  // Abrir el editor al encender el PC (solo en la app de escritorio)
  if (escritorio && escritorio.inicioWindows) {
    const inicio = el("input", { type: "checkbox", role: "switch", checked: !!H.inicioWindows,
      onchange: e => escritorio.inicioWindows(e.target.checked).then(v => { H.inicioWindows = v; toast(v ? "El editor se abrirá solo al encender el PC." : "El editor ya no se abrirá solo."); }) });
    if (H.inicioWindows === undefined) escritorio.inicioWindows().then(v => { H.inicioWindows = v; inicio.checked = !!v; });
    conexion.append(el("label", { class: "interruptor", style: "margin-top:14px" }, el("span", {}, "Abrir el editor al encender el PC (antes que OBS)"), inicio),
      el("p", { class: "nota-campo" }, "OBS carga los overlays desde esta app: si OBS se abre primero, quedan en blanco. Con esto el editor ya está abierto (minimizado). Además, al conectarse con OBS la app recarga sola los overlays."));
  }
  if (o.conexion === "ok") {
    conexion.append(el("div", { class: "fila-botones" },
      el("button", { class: "btn btn-suave btn-chico", type: "button", title: "Vuelve a cargar en OBS las fuentes Navegador de los overlays (por si alguna quedó en blanco)",
        onclick: () => postear("/api/obs/recargar", {}).then(r => toast(r.recargados === 1 ? "Se recargó 1 overlay en OBS." : `Se recargaron ${r.recargados} overlays en OBS.`), err => toast(err.message, "error")) }, "Recargar overlays en OBS")));
  }
  out.push(conexion);
  if (o.conexion !== "ok") return out;

  // Transmisión y grabación
  const confirmar = (cual, accion) => {
    const textos = {
      "transmision|iniciar": "¿Iniciar la transmisión en vivo?", "transmision|detener": "¿Detener la transmisión? Saldrán del aire.",
      "grabacion|iniciar": "¿Iniciar la grabación?", "grabacion|detener": "¿Detener la grabación?"
    };
    if (confirm(textos[cual + "|" + accion])) hacer("/api/obs/salida", { cual, accion }, accion === "iniciar" ? "Listo, OBS recibió la orden." : "Listo, se detuvo.");
  };
  H.vivos.tiempoT = el("span", { class: "tiempo" });
  H.vivos.tiempoG = el("span", { class: "tiempo" });
  H.vivos.salud = el("p", { class: "salud" });
  const t = o.transmision, g = o.grabacion;
  out.push(el("div", { class: "fila-salidas" },
    el("div", { class: "salida" + (t.activa ? " activa" : "") },
      el("span", { class: "salida-nombre" }, t.activa ? "● EN VIVO" : "Transmisión"), H.vivos.tiempoT,
      el("button", { class: "btn btn-chico " + (t.activa ? "btn-suave" : "btn-primario"), type: "button", onclick: () => confirmar("transmision", t.activa ? "detener" : "iniciar") }, t.activa ? "Detener transmisión" : "Iniciar transmisión")),
    el("div", { class: "salida" + (g.activa ? " activa grabando" : "") },
      el("span", { class: "salida-nombre" }, g.activa ? "● GRABANDO" : "Grabación"), H.vivos.tiempoG,
      el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => confirmar("grabacion", g.activa ? "detener" : "iniciar") }, g.activa ? "Detener grabación" : "Iniciar grabación"))));
  out.push(H.vivos.salud);

  // Escenas
  out.push(tarjeta("Escenas",
    el("div", { class: "escenas" }, o.escenas.map(n => el("button", {
      type: "button", class: "escena" + (n === o.escena ? " al-aire" : ""), "aria-pressed": String(n === o.escena),
      onclick: () => { if (n !== o.escena) hacer("/api/obs/escena", { nombre: n }); }
    }, el("span", {}, n), n === o.escena ? el("small", {}, "AL AIRE") : null))),
    el("p", { class: "nota-campo" }, "Clic en una escena para mostrarla en vivo.")));

  // Cuenta regresiva
  if (o.hayOverlayCuenta) {
    const opciones = sel => [el("option", { value: "" }, "— No cambiar —"), ...o.escenas.map(n => el("option", { value: n, selected: n === sel }, n))];
    const espera = el("select", { "aria-label": "Escena de espera" }, opciones(c.escenaEspera));
    const final = el("select", { "aria-label": "Escena del programa" }, opciones(c.escenaFinal));
    const cuenta = tarjeta("Cuenta regresiva «Ya comenzamos»");
    if (o.cuenta) {
      H.vivos.cuenta = el("strong", { class: "cuenta-grande" });
      cuenta.append(el("div", { class: "cuenta-activa" }, H.vivos.cuenta,
        el("span", {}, o.cuenta.escenaFinal ? `Al llegar a cero, OBS pasa a «${o.cuenta.escenaFinal}».` : "Al llegar a cero, OBS se queda en la escena actual."),
        el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => hacer("/api/obs/cuenta", { accion: "cancelar" }, "Cuenta regresiva cancelada.") }, "Cancelar")));
    } else {
      cuenta.append(el("div", { class: "fila-campos" },
        el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "1. Mostrar esta escena"), espera),
        el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "2. Al terminar, pasar a"), final)),
        el("button", { class: "btn btn-primario btn-chico", type: "button", onclick: () => hacer("/api/obs/cuenta", { escenaEspera: espera.value, escenaFinal: final.value }, "Comenzó la cuenta regresiva.") }, "Iniciar cuenta regresiva"),
        el("p", { class: "nota-campo" }, "La cuenta del overlay «Ya comenzamos» vuelve a empezar (los minutos se cambian en ese overlay)."));
    }
    out.push(cuenta);
  }

  // Audio
  if (o.audio.length) {
    out.push(tarjeta("Audio",
      el("div", { class: "audios" }, o.audio.map(a => el("button", {
        type: "button", class: "audio" + (a.silenciado ? " silenciado" : ""), "aria-pressed": String(!a.silenciado),
        title: a.silenciado ? "Clic para activar" : "Clic para silenciar",
        onclick: () => hacer("/api/obs/silenciar", { nombre: a.nombre, silenciado: !a.silenciado })
      }, icono(a.silenciado ? "micOff" : "mic", 20), el("span", {}, a.nombre), el("small", {}, a.silenciado ? "Silenciado" : "Activo"))))));
  }
  return out;
}

// ---------- Programa al aire ----------

function hora(iso) {
  return new Date(iso).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

function vistaPrograma(d) {
  const a = d.alAire, ahora = a.ahora;
  const out = [cabecera("Programa al aire", "Los rótulos de los overlays («AL AIRE · …», el nombre del programa y «Con …») cambian solos según la programación de Horarios.")];

  // Lo que muestran ahora los rótulos
  let estadoTexto;
  if (a.fijo) estadoTexto = `Puesto a mano hasta las ${hora(a.fijo.hasta)}`;
  else if (a.modo !== "auto") estadoTexto = "Apagado: cada overlay muestra sus propios textos";
  else if (ahora && ahora.fuera) estadoTexto = "Fuera de programa";
  else if (ahora) estadoTexto = `Según la programación · hasta las ${hora(ahora.hasta)}`;
  const detalle = ahora ? (ahora.detalle != null ? ahora.detalle : `Al aire · ${ahora.dia} ${ahora.hora}`) : "";
  out.push(el("section", { class: "tarjeta rotulo-ahora" + (ahora ? "" : " apagado") },
    el("span", { class: "insignia" + (a.fijo ? " ambar" : ahora && !ahora.fuera ? " rojo" : "") }, estadoTexto),
    ahora ? el("div", { class: "rotulo" },
      el("span", { class: "rotulo-detalle" }, detalle.toUpperCase()),
      el("span", { class: "rotulo-nombre" }, ahora.nombre),
      ahora.presentador ? el("span", { class: "rotulo-con" }, "Con " + ahora.presentador.replace(/^con\s+/i, ""))
        : ahora.fuera ? null : el("span", { class: "rotulo-con tenue" }, "Sin presentadores escritos"))
      : el("p", { class: "tenue" }, "Enciende el modo automático o pon un programa a mano."),
    a.fijo ? el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => hacer("/api/estudio/soltar", {}, a.modo === "auto" ? "Volvió a la programación." : "Se quitó el programa puesto a mano.") }, a.modo === "auto" ? "Volver a la programación" : "Quitar") : null));

  // Modo automático
  const auto = el("input", { type: "checkbox", role: "switch", checked: a.modo === "auto", onchange: e => hacer("/api/estudio/al-aire", { modo: e.target.checked ? "auto" : "apagado" }, e.target.checked ? "Los rótulos ahora siguen la programación." : "Cada overlay vuelve a mostrar sus propios textos.") });
  const antic = el("input", { type: "number", min: 0, max: 60, value: a.anticipacion, class: "num-chico", onchange: e => hacer("/api/estudio/al-aire", { anticipacion: e.target.value }) });
  out.push(tarjeta(null,
    el("label", { class: "interruptor" }, el("span", {}, "Cambiar los rótulos solos según la programación"), auto),
    el("p", { class: "nota-campo" }, "Funciona en todos los overlays que tienen el rótulo del programa (Principal, Lateral, Marco, Minimal, Multimedia). Los cambios entran con el mismo fundido suave de siempre."),
    el("label", { class: "linea-campo" }, "Mostrar cada programa ", antic, " minutos antes de su hora")));

  // Programas de la programación
  if (!d.hayProgramacion) {
    out.push(tarjeta("Programas", el("p", { class: "tenue" }, "No encontré la programación semanal (overlay Horarios).")));
  } else {
    const filas = d.programas.map(p => {
      const pres = el("input", { type: "text", value: p.presentador, placeholder: "Ej: Pastora Ana y hno. Luis", "aria-label": `Presentadores de ${p.nombre}`,
        onchange: e => hacer("/api/estudio/programa", { nombre: p.nombre, presentador: e.target.value }, "Presentadores guardados.") });
      const dur = el("input", { type: "number", min: 5, max: 600, step: 5, value: p.duracionFija ? p.duracion : "", placeholder: "4 h", class: "num-chico", "aria-label": `Duración de ${p.nombre} en minutos (vacío: hasta 4 horas)`,
        onchange: e => hacer("/api/estudio/programa", { nombre: p.nombre, duracion: e.target.value }) });
      const alAire = ahora && !ahora.fuera && ahora.nombre === p.nombre;
      return el("div", { class: "programa" + (alAire ? " al-aire" : "") },
        el("div", { class: "programa-cabeza" },
          el("strong", {}, p.nombre),
          alAire ? el("span", { class: "insignia rojo" }, "AL AIRE") : null,
          el("button", { class: "btn btn-suave btn-chico", type: "button", title: "Muestra este programa en los rótulos ahora, por el tiempo que dura",
            onclick: () => hacer("/api/estudio/fijar", { nombre: p.nombre }, `«${p.nombre}» está ahora en los rótulos.`) }, "Poner al aire ahora")),
        el("div", { class: "chips" }, p.horarios.map(h => el("span", { class: "chip" }, h))),
        el("div", { class: "programa-campos" },
          el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "Presentadores (se muestra «Con …»)"), pres),
          el("label", { class: "campo chico" }, el("span", { class: "etiqueta" }, "Dura (min)"), dur)));
    });
    out.push(tarjeta("Programas",
      el("p", { class: "nota-campo" }, "Si un programa no tiene duración, el rótulo lo muestra hasta 4 horas después de su inicio, o hasta que empiece el siguiente programa. Los días y horas se cambian en el overlay Horarios. ",
        d.overlayHorarios ? el("button", { class: "btn btn-link", type: "button", onclick: () => abrirOverlay(d.overlayHorarios) }, "Editar horarios") : null),
      ...filas));
  }

  // Programa especial
  const nom = el("input", { type: "text", placeholder: "Ej: Especial de Navidad" });
  const pre = el("input", { type: "text", placeholder: "Ej: Equipo Radio Bendición" });
  const min = el("input", { type: "number", min: 5, max: 720, step: 5, value: "", placeholder: "4 h", class: "num-chico" });
  out.push(tarjeta("Programa especial (fuera de la programación)",
    el("div", { class: "fila-campos" },
      el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "Nombre"), nom),
      el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "Presentadores"), pre),
      el("label", { class: "campo chico" }, el("span", { class: "etiqueta" }, "Minutos (opcional)"), min)),
    el("button", { class: "btn btn-primario btn-chico", type: "button", onclick: () => {
      if (!nom.value.trim()) { nom.focus(); return toast("Escribe el nombre del programa.", "error"); }
      hacer("/api/estudio/fijar", { nombre: nom.value, presentador: pre.value, minutos: min.value }, `«${nom.value.trim()}» está ahora en los rótulos.`);
    } }, "Poner al aire")));

  // Fuera de programa
  const f = a.fuera;
  const campoFuera = (k, etiqueta) => el("label", { class: "campo" }, el("span", { class: "etiqueta" }, etiqueta),
    el("input", { type: "text", value: f[k], onchange: e => hacer("/api/estudio/al-aire", { fuera: { [k]: e.target.value } }) }));
  out.push(tarjeta("Cuando no hay programa al aire",
    el("p", { class: "nota-campo" }, "Con el modo automático, entre un programa y otro los rótulos muestran esto:"),
    el("div", { class: "fila-campos" }, campoFuera("detalle", "Línea de arriba"), campoFuera("nombre", "Nombre"), campoFuera("presentador", "Presentadores (opcional)"))));
  return out;
}

// ---------- Anuncios ----------

function vistaAnuncios(d) {
  const an = d.anuncios;
  const lista = an.lista.map(a => ({ ...a }));
  let tGuardar = null;
  const guardarLista = (inmediato) => {
    clearTimeout(tGuardar);
    const enviar = () => postear("/api/estudio/anuncios", { lista }).then(r => { H.datos = r; actualizarFranja(r); }).catch(err => toast(err.message, "error"));
    if (inmediato) { enviar(); pintarConDatos({ ...d, anuncios: { ...an, lista } }, true); }
    else tGuardar = setTimeout(enviar, 700);
  };
  const franja = el("div", { class: "franja-vista" });
  const actualizarFranja = r => {
    const v = r.anuncios.vigentes;
    franja.replaceChildren(v.length ? el("div", { class: "franja-texto" }, v.map(t => el("span", {}, t))) : el("span", { class: "tenue" }, "No hay anuncios vigentes: la franja muestra el texto del overlay."));
  };
  actualizarFranja(d);

  const filas = lista.map((a, i) => {
    const mover = delta => { const j = i + delta; if (j < 0 || j >= lista.length) return; [lista[i], lista[j]] = [lista[j], lista[i]]; guardarLista(true); };
    return el("div", { class: "anuncio" + (a.activo ? "" : " inactivo") },
      el("input", { type: "checkbox", checked: a.activo, title: a.activo ? "Se muestra" : "No se muestra", "aria-label": "Mostrar este anuncio", onchange: e => { a.activo = e.target.checked; guardarLista(true); } }),
      el("div", { class: "anuncio-cuerpo" },
        el("textarea", { rows: 2, value: a.texto, placeholder: "Escribe el anuncio…", "aria-label": `Anuncio ${i + 1}`, oninput: e => { a.texto = e.target.value; guardarLista(); } }),
        el("div", { class: "anuncio-fechas" },
          el("label", {}, "Desde ", el("input", { type: "date", value: a.desde || "", onchange: e => { a.desde = e.target.value || null; guardarLista(true); } })),
          el("label", {}, "Hasta ", el("input", { type: "date", value: a.hasta || "", onchange: e => { a.hasta = e.target.value || null; guardarLista(true); } })),
          a.hasta && a.hasta < new Date().toISOString().slice(0, 10) ? el("span", { class: "insignia" }, "Ya terminó") : null)),
      el("div", { class: "anuncio-acciones" },
        el("button", { class: "btn btn-suave btn-icono", type: "button", title: "Subir", "aria-label": "Subir", disabled: i === 0, onclick: () => mover(-1) }, "↑"),
        el("button", { class: "btn btn-suave btn-icono", type: "button", title: "Bajar", "aria-label": "Bajar", disabled: i === lista.length - 1, onclick: () => mover(1) }, "↓"),
        el("button", { class: "btn btn-suave btn-icono", type: "button", title: "Borrar", "aria-label": "Borrar", onclick: () => { if (!a.texto.trim() || confirm("¿Borrar este anuncio?")) { lista.splice(i, 1); guardarLista(true); } } }, "×")));
  });

  const activo = el("input", { type: "checkbox", role: "switch", checked: an.activo, onchange: e => hacer("/api/estudio/anuncios", { activo: e.target.checked }, e.target.checked ? "La franja ahora muestra los anuncios." : "La franja vuelve a mostrar el texto del overlay.") });
  return [
    cabecera("Anuncios", "Avisos que pasan uno tras otro por la franja inferior del overlay Principal. Los que tienen fecha aparecen y se van solos."),
    tarjeta(null,
      el("label", { class: "interruptor" }, el("span", {}, "Mostrar estos anuncios en la franja inferior"), activo),
      el("span", { class: "etiqueta" }, "Así pasa la franja ahora"), franja,
      el("p", { class: "nota-campo" }, "La franja va a la misma velocidad aunque agregues más anuncios: solo tarda más en dar la vuelta. ",
        d.overlayTicker ? el("button", { class: "btn btn-link", type: "button", onclick: () => abrirOverlay(d.overlayTicker) }, "Ver en el overlay") : null)),
    tarjeta("Lista de anuncios", ...filas,
      el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => { lista.push({ texto: "", activo: true, desde: null, hasta: null }); guardarLista(true); setTimeout(() => { const t = $("#herramienta .anuncio:last-of-type textarea"); if (t) t.focus(); }, 50); } }, "+ Agregar anuncio"))
  ];
}

// ---------- Comentarios ----------

const FUENTES = [["youtube", "YouTube"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["tiktok", "TikTok"], ["whatsapp", "WhatsApp"], ["", "Otro"]];
const POSICIONES = [["arriba-izquierda", "Arriba izq."], ["arriba-derecha", "Arriba der."], ["abajo-izquierda", "Abajo izq."], ["abajo-derecha", "Abajo der."], ["centro", "Centro"]];

function vistaComentarios(d) {
  H.fuenteComentario = H.fuenteComentario ?? "youtube";
  const botonesFuente = el("div", { class: "opciones-botones" }, FUENTES.map(([id, nombre]) => el("button", {
    type: "button", "aria-pressed": String(H.fuenteComentario === id),
    onclick: e => { H.fuenteComentario = id; for (const b of e.currentTarget.parentNode.children) b.setAttribute("aria-pressed", String(b === e.currentTarget)); }
  }, nombre)));
  const nombre = el("input", { type: "text", placeholder: "Nombre de quien comenta (opcional)", maxLength: 60 });
  const texto = el("textarea", { rows: 3, placeholder: "Escribe o pega el comentario…", maxLength: 400 });
  const mostrar = () => {
    if (!texto.value.trim()) { texto.focus(); return toast("Escribe el comentario.", "error"); }
    hacer("/api/comentarios/mostrar", { nombre: nombre.value, texto: texto.value, fuente: H.fuenteComentario }, "Comentario en pantalla.").then(r => { if (r) { nombre.value = ""; texto.value = ""; } });
  };
  texto.addEventListener("keydown", e => { if (e.key === "Enter" && e.ctrlKey) { e.preventDefault(); e.stopPropagation(); mostrar(); } });

  const actual = d.actual;
  const visible = actual && (!d.segundos || Date.now() - actual.desde < d.segundos * 1000);
  const marco = el("div", { class: "vista-marco mini" }, el("iframe", { src: "/o/comentarios?vista=1", title: "Vista previa de comentarios", width: 1920, height: 1080 }));
  requestAnimationFrame(() => { const f = marco.querySelector("iframe"); f.style.transform = `scale(${marco.clientWidth / 1920})`; });

  return [
    cabecera("Comentarios", "Muestra en la transmisión un comentario del público: escríbelo o pégalo desde el chat de YouTube, Facebook o WhatsApp."),
    el("div", { class: "dos-columnas" },
      el("div", {},
        tarjeta("Nuevo comentario",
          el("span", { class: "etiqueta" }, "Viene de"), botonesFuente,
          el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "Nombre"), nombre),
          el("label", { class: "campo" }, el("span", { class: "etiqueta" }, "Comentario"), texto),
          el("div", { class: "fila-botones" },
            el("button", { class: "btn btn-primario", type: "button", onclick: mostrar, title: "Atajo: Ctrl + Enter" }, "Mostrar en pantalla"),
            visible ? el("button", { class: "btn btn-suave", type: "button", onclick: () => hacer("/api/comentarios/ocultar", {}, "Comentario oculto.") }, "Ocultar el actual") : null)),
        tarjeta("Recientes",
          d.recientes.length ? el("div", { class: "recientes-com" }, d.recientes.map(c => el("div", { class: "com" + (actual && actual.id === c.id && visible ? " en-pantalla" : "") },
            el("div", {}, c.nombre ? el("strong", {}, c.nombre) : null, el("span", {}, c.texto)),
            el("div", { class: "com-acciones" },
              el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => hacer("/api/comentarios/mostrar", c, "Comentario en pantalla.") }, "Mostrar"),
              el("button", { class: "btn btn-suave btn-icono", type: "button", "aria-label": "Quitar de la lista", title: "Quitar de la lista", onclick: () => hacer("/api/comentarios/borrar", { id: c.id }) }, "×")))))
            : el("p", { class: "tenue" }, "Aquí quedan los comentarios que muestres, para repetirlos con un clic."))),
      el("div", {},
        tarjeta("Vista previa", marco,
          el("span", { class: "etiqueta" }, "Posición"),
          el("div", { class: "opciones-botones" }, POSICIONES.map(([id, n]) => el("button", { type: "button", "aria-pressed": String(d.posicion === id), onclick: () => hacer("/api/comentarios/config", { posicion: id }) }, n))),
          el("label", { class: "linea-campo" }, "Se oculta solo después de ",
            el("input", { type: "number", min: 0, max: 300, value: d.segundos, class: "num-chico", onchange: e => hacer("/api/comentarios/config", { segundos: e.target.value }) }),
            " segundos"),
          el("p", { class: "nota-campo" }, "Con 0 se queda en pantalla hasta que lo ocultes.")),
        tarjeta("Agregar a OBS (una sola vez)",
          el("p", { class: "nota-campo" }, "Crea una fuente «Navegador» de 1920 × 1080 con este enlace y ponla arriba de todo en las escenas donde quieras ver los comentarios."),
          el("div", { class: "enlace" }, el("input", { type: "text", value: d.url, readOnly: true, onfocus: e => e.target.select() }),
            el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => copiar(d.url) }, "Copiar enlace")))))
  ];
}

// ---------- Control remoto ----------

function vistaRemoto(d) {
  const pin = el("input", { type: "text", inputMode: "numeric", maxLength: 8, value: d.pin || "", placeholder: "4 a 8 números", class: "pin", "aria-label": "PIN",
    oninput: e => { e.target.value = e.target.value.replace(/\D/g, ""); } });
  const guardarPin = () => hacer("/api/remoto/config", { pin: pin.value }, "PIN guardado. Los celulares tienen que volver a escribirlo.");
  pin.addEventListener("keydown", e => { if (e.key === "Enter") guardarPin(); });
  const azar = () => { pin.value = String(Math.floor(100000 + Math.random() * 900000)); guardarPin(); };
  const activo = el("input", { type: "checkbox", role: "switch", checked: d.activo, disabled: !d.pin, onchange: e => hacer("/api/remoto/config", { activo: e.target.checked }, e.target.checked ? "Control remoto encendido." : "Control remoto apagado.") });

  const out = [cabecera("Control remoto", "Maneja la transmisión desde el celular o una tablet conectada al mismo Wi-Fi que este PC.")];
  out.push(tarjeta("1. Elige un PIN",
    el("div", { class: "fila-botones" }, pin,
      el("button", { class: "btn btn-primario btn-chico", type: "button", onclick: guardarPin, disabled: false }, "Guardar PIN"),
      el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: azar }, "Crear uno al azar")),
    el("p", { class: "nota-campo" }, "Quien tenga el PIN puede manejar la transmisión desde su celular. Al cambiarlo, todos los celulares tienen que volver a escribirlo.")));

  const encendido = tarjeta("2. Enciende el control remoto",
    el("label", { class: "interruptor" }, el("span", {}, d.pin ? "Permitir el control desde celulares" : "Permitir el control desde celulares (primero guarda un PIN)"), activo));
  if (d.error) encendido.append(el("p", { class: "nota-biblia error" }, d.error));
  out.push(encendido);

  if (d.activo && d.escuchando) {
    const principal = d.direcciones[0];
    const conectar = tarjeta("3. Abre esto en el celular");
    if (!principal) {
      conectar.append(el("p", { class: "nota-biblia error" }, "Este PC no está conectado a ninguna red. Conéctalo al Wi-Fi."));
    } else {
      const qr = el("div", { class: "qr", "aria-label": "Código QR del enlace" });
      try {
        const q = qrcode(0, "M");
        q.addData(principal.url);
        q.make();
        qr.innerHTML = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
      } catch {}
      conectar.append(el("div", { class: "remoto-conectar" }, qr,
        el("div", {},
          el("p", {}, d.wifi ? ["Conecta el celular al Wi-Fi ", el("strong", {}, `«${d.wifi}»`), " y escanea el código con la cámara."] : "Conecta el celular a la misma red que este PC y escanea el código con la cámara."),
          el("p", { class: "tenue" }, "O escribe esta dirección en el navegador del celular:"),
          el("div", { class: "enlace" }, el("input", { type: "text", value: principal.url, readOnly: true, onfocus: e => e.target.select() }),
            el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => copiar(principal.url) }, "Copiar")),
          el("p", { class: "tenue" }, `Después escribe el PIN. El celular queda recordado.`),
          d.direcciones.length > 1 ? el("details", { class: "otras" }, el("summary", {}, "¿No carga? Prueba otra dirección de este PC"),
            d.direcciones.slice(1).map(x => el("p", {}, el("code", {}, x.url), ` (${x.interfaz})`))) : null)));
      if (d.categoria === "Public") {
        conectar.append(el("div", { class: "aviso" }, el("strong", {}, "Windows tiene esta red como «Pública» "), "y puede bloquear a los celulares. Para arreglarlo: Configuración → Red e Internet → Wi-Fi → ",
          d.wifi ? `«${d.wifi}» → ` : "", "Tipo de perfil de red: ", el("strong", {}, "Privada"), "."));
      }
      conectar.append(el("p", { class: "nota-campo" }, "La primera vez, Windows puede preguntar si permite que «Editor de Overlays» use la red: elige ", el("strong", {}, "Permitir"), ". Si cambias de Wi-Fi, el código se actualiza solo."));
    }
    out.push(conectar);
    out.push(tarjeta("Celulares conectados",
      el("p", {}, d.sesiones === 1 ? "Hay 1 celular con sesión abierta." : `Hay ${d.sesiones} celulares con sesión abierta.`),
      d.sesiones ? el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => { if (confirm("¿Cerrar la sesión en todos los celulares? Tendrán que escribir el PIN de nuevo.")) hacer("/api/remoto/config", { cerrarSesiones: true }, "Se cerró la sesión en todos los celulares."); } }, "Cerrar sesión en todos") : null));
  }
  out.push(tarjeta("¿Qué se puede hacer desde el celular?",
    el("ul", { class: "lista-simple" },
      el("li", {}, "Cambiar de escena, iniciar la cuenta regresiva y silenciar micrófonos en OBS."),
      el("li", {}, "Poner un programa al aire o volver a la programación."),
      el("li", {}, "Mostrar versículos (con anterior y siguiente) y comentarios."),
      el("li", {}, "Prender y apagar anuncios de la franja."))));
  return out;
}
