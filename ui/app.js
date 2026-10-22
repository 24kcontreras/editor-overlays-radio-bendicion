"use strict";

// Nombres más claros para las opciones conocidas; las demás se muestran tal cual las nombró el diseño.
const ETIQUETAS = {
  usuarioRedes: "Usuario en redes sociales",
  programa: "Nombre del programa",
  detallePrograma: "Detalle del programa",
  segundosRotacion: "Segundos entre cada mensaje",
  minutosCuentaRegresiva: "Minutos de cuenta regresiva",
  direccionIglesia: "Dirección de la iglesia",
  mostrarTercio: "Mostrar rótulo del programa",
  mostrarAhoraSuena: "Mostrar «Ahora suena»",
  mostrarTicker: "Mostrar franja inferior",
  textoTicker: "Texto de la franja inferior",
  velocidadTicker: "Duración de cada vuelta de la franja",
  escena: "Pantalla que se muestra",
  proximoAutomatico: "Calcularlo solo con la programación de Horarios",
  proximoNombre: "Nombre (solo si el automático está apagado)",
  proximoCuando: "Día y hora (solo si el automático está apagado)",
  musicaAutomatica: "Mostrar lo que suena en YouTube Music o Spotify",
  ocultarSinMusica: "Mostrar «Ahora suena» solo mientras suena música",
  cancion: "Canción (si no suena YouTube Music ni Spotify)",
  artista: "Artista (si no suena YouTube Music ni Spotify)",
  modo: "Formato en pantalla",
  texto: "Texto del versículo",
  cita: "Cita",
  version: "Versión"
};

const $ = sel => document.querySelector(sel);
const el = (tag, attrs = {}, ...hijos) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (k === "value") n.value = v;
    else if (k in n && typeof v !== "string") n[k] = v;
    else n.setAttribute(k, v === true ? "" : v);
  }
  for (const h of hijos.flat()) if (h != null) n.append(h);
  return n;
};

const estado = {
  overlays: [],
  carpeta: null,
  actual: null,      // datos del overlay seleccionado (desde /api/overlay/:slug)
  herramienta: null, // herramienta de transmisión abierta (herramientas.js), en vez de un overlay
  borrador: null,    // { props, textos } que se está editando
  canalVista: "borrador",
  temporizador: null,
  autoPublicar: false,
  tAuto: null,       // publicación automática pendiente
  slugAuto: null,    // overlay al que corresponde esa publicación
  versiones: null,   // traducciones de la Biblia disponibles (desde /api/biblia/versiones)
  libros: null,      // los 66 libros con sus capítulos (desde /api/biblia/libros)
  musica: null,      // qué suena y estado de YouTube Music y Spotify (desde /api/musica/estado)
  tMusica: null,     // consulta periódica mientras se ve la tarjeta de música
  versionPredeterminada: null,
  // Lector de la Biblia: sobrevive a repintar el formulario y a cambiar de overlay
  biblia: {
    iniciado: false, version: null, libro: null, capitulo: null, versos: null, cargando: false, error: null,
    sel: null, ancla: null, paso: 1, enPantalla: null, aviso: null, cita: "", pedido: 0, irASeleccion: false
  }
};

const ESPERA_AUTO_MS = 2500;

const escritorio = window.editorEscritorio || null; // puente con Electron (preload.js)

async function api(ruta, opciones) {
  const r = await fetch(ruta, opciones);
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Error ${r.status}`);
  return r.json();
}

function toast(texto, tipo = "exito") {
  const t = $("#toast");
  t.textContent = texto;
  t.className = `toast ${tipo}`;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, 3200);
}

// ---------- Lista de overlays ----------

async function cargarEstado(recargarActual = false) {
  const datos = await api("/api/estado");
  estado.overlays = datos.overlays;
  estado.carpeta = datos.carpeta;
  $("#textoCarpeta").textContent = datos.carpeta || "Sin carpeta elegida";
  $("#textoCarpeta").title = datos.carpeta || "";
  $("#btnCarpeta").hidden = !escritorio;
  pintarLista();

  const hay = estado.overlays.length > 0;
  const enHerramienta = !!estado.herramienta;
  $("#vacio").hidden = hay || enHerramienta;
  $("#btnCarpetaVacio").hidden = !escritorio;
  $("#editor").hidden = !hay || enHerramienta;
  $("#panel").hidden = !hay || enHerramienta;
  if (!hay) { estado.actual = null; return; }
  if (enHerramienta) return;

  let guardado = null;
  try { guardado = localStorage.getItem("overlayActual"); } catch {}
  const sigue = estado.actual && estado.overlays.find(o => o.slug === estado.actual.slug);
  const elegido = sigue || estado.overlays.find(o => o.slug === guardado) || estado.overlays[0];
  if (!sigue || recargarActual) await abrirOverlay(elegido.slug);
}

async function actualizarArchivos() {
  const btn = $("#btnActualizar");
  btn.classList.add("girando");
  btn.disabled = true;
  const antes = new Set(estado.overlays.map(o => o.slug));
  try {
    await guardarAhora();
    await cargarEstado(true);
    const nuevos = estado.overlays.filter(o => !antes.has(o.slug));
    const quitados = [...antes].filter(s => !estado.overlays.some(o => o.slug === s)).length;
    if (nuevos.length) toast(nuevos.length === 1 ? `Se encontró un overlay nuevo: ${nuevos[0].nombre}` : `Se encontraron ${nuevos.length} overlays nuevos.`);
    else if (quitados) toast(quitados === 1 ? "Se quitó un overlay que ya no está en la carpeta." : `Se quitaron ${quitados} overlays que ya no están en la carpeta.`);
    else toast("Archivos actualizados. No hay overlays nuevos.");
  } catch (err) {
    toast("No se pudo actualizar: " + err.message, "error");
  } finally {
    btn.classList.remove("girando");
    btn.disabled = false;
  }
}

function pintarLista() {
  const ul = $("#listaOverlays");
  ul.replaceChildren(...estado.overlays.map(o => el("li", {},
    el("button", {
      type: "button",
      "aria-current": !estado.herramienta && estado.actual && estado.actual.slug === o.slug ? "true" : "false",
      title: o.pendiente ? "Tiene cambios sin publicar" : o.archivo,
      onclick: () => abrirOverlay(o.slug)
    }, el("span", {}, o.nombre), o.pendiente ? el("span", { class: "punto", "aria-label": "Cambios sin publicar" }) : null)
  )));
}

// ---------- Overlay seleccionado ----------

async function abrirOverlay(slug) {
  await guardarAhora();
  await publicarAutoYa();
  const datos = await api(`/api/overlay/${slug}`);
  if (estado.herramienta) {
    cerrarHerramienta();
    $("#editor").hidden = false;
    $("#panel").hidden = false;
  }
  estado.actual = datos;
  estado.borrador = JSON.parse(JSON.stringify(datos.borrador));
  try { localStorage.setItem("overlayActual", slug); localStorage.setItem("vistaActual", "o:" + slug); } catch {}
  $("#tituloOverlay").textContent = datos.nombre;
  $("#buscar").value = "";
  estado.biblia.aviso = null;
  pintarLista();
  // En Versículos no se ofrece apagar la publicación automática (ver autoActivo)
  $("#autoPublicar").closest("label").hidden = esVersiculo();
  if (esVersiculo() && datos.pendiente) {
    await accion("publicar");
    datos.pendiente = false;
  }
  pintarEstado(datos.pendiente);
  pintarEnlaces();
  pintarFormulario();
  cambiarCanal(estado.canalVista);
}

// El overlay abierto cambió desde otro lado (el celular, «Programa al aire» o «Anuncios»): se recargan sus
// datos, salvo que haya cambios escritos aquí que todavía no se guardan.
async function refrescarActual() {
  if (!estado.actual || estado.herramienta || estado.temporizador) return;
  const slug = estado.actual.slug;
  try {
    const datos = await api(`/api/overlay/${slug}`);
    if (!estado.actual || estado.actual.slug !== slug || estado.temporizador) return;
    estado.actual = datos;
    estado.borrador = JSON.parse(JSON.stringify(datos.borrador));
    pintarEstado(datos.pendiente);
    pintarFormulario();
  } catch {}
}

function pintarEstado(pendiente) {
  const e = $("#estadoOverlay");
  if (pendiente && autoActivo()) {
    e.className = "estado auto";
    e.textContent = "● Se enviará a OBS cuando termines de escribir…";
  } else {
    e.className = "estado " + (pendiente ? "pendiente" : "al-dia");
    e.textContent = pendiente ? "● Tienes cambios que aún no están en OBS" : "✓ OBS muestra la versión más reciente";
  }
  $("#btnPublicar").disabled = !pendiente;
  $("#btnDescartar").disabled = !pendiente;
  const o = estado.overlays.find(x => x.slug === estado.actual.slug);
  if (o && o.pendiente !== pendiente) { o.pendiente = pendiente; pintarLista(); }
}

function pintarEnlaces() {
  const a = estado.actual;
  const fila = (nombre, url) => {
    const input = el("input", { type: "text", value: url, readOnly: true, "aria-label": `Enlace ${nombre}`, onfocus: e => e.target.select() });
    return el("div", { class: "enlace" },
      el("span", { class: "enlace-nombre" }, nombre),
      input,
      el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => copiar(url) }, "Copiar enlace"));
  };
  const hijos = [];
  if (a.escenas.length) {
    hijos.push(el("p", { class: "ayuda" }, "Puedes usar un solo enlace y elegir la pantalla desde aquí, o crear una fuente en OBS por cada pantalla con su propio enlace."));
    hijos.push(fila("Según la app", a.url));
    for (const s of a.escenas) hijos.push(fila(s.nombre, s.url));
  } else {
    hijos.push(el("p", { class: "ayuda" }, "Pega este enlace en una fuente de tipo «Navegador» en OBS (1920 × 1080)."));
    hijos.push(fila(a.nombre, a.url));
  }
  $("#listaEnlaces").replaceChildren(...hijos);
}

async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    toast("Enlace copiado. Ahora pégalo en OBS.");
  } catch {
    toast("No se pudo copiar. Selecciona el enlace y presiona Ctrl + C.", "error");
  }
}

// ---------- Vista previa ----------

function cambiarCanal(canal) {
  estado.canalVista = canal;
  for (const t of document.querySelectorAll(".tab")) t.setAttribute("aria-selected", String(t.dataset.canal === canal));
  $("#vistaMarco").classList.toggle("en-obs", canal === "publicado");
  const f = $("#vistaFrame");
  f.width = estado.actual.ancho;
  f.height = estado.actual.alto;
  f.src = `/o/${estado.actual.slug}?canal=${canal}`;
  ajustarVista();
}

function ajustarVista() {
  if (!estado.actual) return;
  const marco = $("#vistaMarco");
  marco.style.aspectRatio = `${estado.actual.ancho} / ${estado.actual.alto}`;
  $("#vistaFrame").style.transform = `scale(${marco.clientWidth / estado.actual.ancho})`;
}

// ---------- Formulario ----------

function valorOpcion(op) {
  const p = estado.borrador.props;
  return op.key in p ? p[op.key] : op.default;
}

function valorTexto(campo) {
  const t = estado.borrador.textos[campo.id];
  return t && t.o === campo.original ? t.v : campo.original;
}

function cambiarOpcion(op, valor) {
  if (valor === op.default) delete estado.borrador.props[op.key];
  else estado.borrador.props[op.key] = valor;
  programarGuardado();
}

function cambiarTexto(campo, valor) {
  if (valor === campo.original) delete estado.borrador.textos[campo.id];
  else estado.borrador.textos[campo.id] = { o: campo.original, v: valor };
  programarGuardado();
}

function pintarFormulario() {
  const a = estado.actual;
  const secciones = [];

  if (usaMusica()) secciones.push(seccionMusica());
  if (esVersiculo()) secciones.push(seccionBiblia());

  // Opciones declaradas por el diseño, agrupadas por sección
  const porSeccion = new Map();
  for (const op of a.opciones) {
    if (!porSeccion.has(op.section)) porSeccion.set(op.section, []);
    porSeccion.get(op.section).push(op);
  }
  for (const [nombre, ops] of porSeccion) {
    secciones.push(seccion(nombre === "Opciones" ? "Opciones" : nombre, ops.map(campoOpcion)));
  }

  // Textos del diseño, agrupados por pantalla
  const grupos = new Map();
  for (const t of a.textos) {
    if (!grupos.has(t.grupo)) grupos.set(t.grupo, []);
    grupos.get(t.grupo).push(t);
  }
  const variosGrupos = grupos.size > 1;
  for (const [nombre, campos] of grupos) {
    secciones.push(seccion(variosGrupos ? `Textos · ${nombre}` : "Textos del diseño", campos.map(c => campoTexto(c))));
  }

  // Listas de datos (ej: programación de la radio)
  const listas = new Map();
  for (const t of a.listas) {
    if (!listas.has(t.grupo)) listas.set(t.grupo, []);
    listas.get(t.grupo).push(t);
  }
  for (const [nombre, campos] of listas) secciones.push(seccion(`Lista · ${nombre}`, camposLista(campos)));

  // Al repintar se conserva dónde estaba el usuario (en el panel y en la lista de versículos)
  const form = $("#formulario");
  const scrollForm = form.scrollTop;
  const lista = form.querySelector(".versos");
  const scrollVersos = lista ? lista.scrollTop : 0;
  form.replaceChildren(...secciones);
  form.scrollTop = scrollForm;
  if ($("#seccionMusica") && !estado.tMusica) {
    estado.tMusica = setInterval(actualizarMusica, CADA_MUSICA_MS);
    actualizarMusica();
  }
  const biblia = $("#seccionBiblia");
  if (biblia) {
    ajustarScrollVersos(biblia, scrollVersos);
    if (!estado.biblia.iniciado) iniciarBiblia();
  }
}

// ---------- Música (YouTube Music y Spotify) ----------
// Para overlays con la opción «musicaAutomatica»: muestra qué suena, de dónde viene y si cada app está conectada.

const CADA_MUSICA_MS = 3000;

function usaMusica() {
  return estado.actual.opciones.some(o => o.key === "musicaAutomatica");
}

async function actualizarMusica() {
  if (!$("#seccionMusica")) { clearInterval(estado.tMusica); estado.tMusica = null; return; }
  try {
    const r = await api("/api/musica/estado");
    estado.musica = { ...estado.musica, ...r };
  } catch {
    estado.musica = { ...estado.musica, actual: null };
  }
  repintarMusica();
}

async function conectarMusica() {
  estado.musica = { ...estado.musica, conectando: true, error: null };
  repintarMusica();
  try {
    const r = await api("/api/musica/conectar", { method: "POST" });
    estado.musica = { ...estado.musica, ...r, conectando: false };
    toast("¡Listo! YouTube Music quedó conectado.");
  } catch (err) {
    estado.musica = { ...estado.musica, conectando: false, error: err.message };
  }
  repintarMusica();
}

async function cambiarPuertoMusica(puerto) {
  try {
    const r = await api("/api/musica/puerto", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ puerto }) });
    estado.musica = { ...estado.musica, ...r, error: null };
  } catch (err) {
    estado.musica = { ...estado.musica, error: err.message };
  }
  repintarMusica();
}

function repintarMusica() {
  const viejo = $("#seccionMusica");
  if (viejo) viejo.replaceWith(seccionMusica());
}

// Una fila por app: punto de color + nombre + cómo está
function filaFuente(nombre, f, textos) {
  const c = f && f.cancion;
  let punto = "gris", texto = "Revisando…";
  if (f && f.conexion === "ok" && c) { punto = c.pausado ? "ambar" : "verde"; texto = c.pausado ? "En pausa" : "Sonando"; }
  else if (f && f.conexion === "ok") { punto = "verde"; texto = "Abierta, sin canción"; }
  else if (f && textos[f.conexion]) [punto, texto] = textos[f.conexion];
  return el("div", { class: "musica-fuente" }, el("span", { class: `punto-estado ${punto}` }), el("strong", {}, nombre), el("span", {}, texto));
}

function seccionMusica() {
  const m = estado.musica || {};
  const yt = m.youtube, sp = m.spotify;
  const opAuto = opcionPorClave("musicaAutomatica");
  const activa = opAuto ? valorOpcion(opAuto) !== false : true;
  const hijos = [];

  const c = m.actual;
  if (c) {
    hijos.push(el("div", { class: "musica-cancion" },
      c.portada ? el("img", { src: c.portada, alt: "" }) : el("span", { class: "musica-sin-portada" }, "♪"),
      el("div", {},
        el("strong", { title: c.titulo }, c.titulo),
        el("span", {}, [c.artista, c.album].filter(Boolean).join(" · ")),
        el("span", { class: "musica-origen" }, `${c.pausado ? "En pausa" : "Sonando"} en ${c.fuente}`))));
  } else if (yt || sp) {
    hijos.push(el("p", { class: "nota-campo" }, "No hay música sonando en YouTube Music ni en Spotify. Se muestra la canción escrita a mano."));
  }

  hijos.push(el("div", { class: "musica-fuentes" },
    filaFuente("YouTube Music", yt, {
      "sin-app": ["gris", "Cerrada o sin «API Server»"],
      "sin-autorizar": ["ambar", "Falta dar permiso"],
      "error": ["rojo", "No responde"]
    }),
    filaFuente("Spotify", sp, {
      "sin-app": ["gris", "Cerrada o sin reproducir"],
      "no-disponible": ["gris", "Solo funciona en Windows"],
      "error": ["rojo", "No se pudo leer"]
    })));

  if (m.conectando) {
    hijos.push(el("p", { class: "nota-campo" }, "En la app de YouTube Music apareció un aviso: elige «Permitir»."));
  } else if (yt && yt.conexion === "sin-autorizar") {
    hijos.push(el("p", { class: "nota-campo" }, "Para YouTube Music presiona «Conectar» y acepta el aviso que aparece en la app. Solo se hace una vez."));
  }
  if (m.error) hijos.push(el("p", { class: "nota-biblia error" }, m.error));
  if (!activa) hijos.push(el("p", { class: "nota-campo" }, "En este overlay está apagado: se muestra la canción escrita a mano (opción «Mostrar lo que suena en YouTube Music o Spotify»)."));

  const acciones = el("div", { class: "musica-acciones" });
  if (yt && (yt.conexion === "sin-autorizar" || m.error)) {
    acciones.append(el("button", { class: "btn btn-primario btn-chico", type: "button", disabled: !!m.conectando, onclick: conectarMusica }, "Conectar YouTube Music"));
  }
  // El puerto solo se ofrece si no está sonando nada (si Spotify suena, no hace falta molestar con YouTube Music)
  if (yt && !c && (yt.conexion === "sin-app" || yt.conexion === "error")) {
    const puerto = el("input", { type: "number", value: yt.puerto || 26538, min: 1, max: 65535, "aria-label": "Puerto del API Server de YouTube Music" });
    acciones.append(el("label", { class: "musica-puerto", title: "Puerto del complemento «API Server» de YouTube Music" }, "Puerto YT Music",
      puerto,
      el("button", { class: "btn btn-suave btn-chico", type: "button", onclick: () => cambiarPuertoMusica(puerto.value) }, "Probar")));
  }
  if (acciones.children.length) hijos.push(acciones);

  const s = seccion("Música que suena", [el("div", { class: "campo musica" }, ...hijos)]);
  s.id = "seccionMusica";
  s.classList.add("fija");
  return s;
}

// ---------- Lector de la Biblia ----------
// Para overlays con las opciones «texto» y «cita» (ej: Versículos): se recorre la Biblia completa,
// se eligen versículos y se mandan al overlay con un clic.

const MAX_RECIENTES = 8;
const LIBRO_INICIAL = 42; // Juan

function esVersiculo() {
  const claves = new Set(estado.actual.opciones.map(o => o.key));
  return claves.has("texto") && claves.has("cita");
}

function opcionPorClave(key) {
  return estado.actual.opciones.find(o => o.key === key) || null;
}

function leerRecientes() {
  try { return JSON.parse(localStorage.getItem("versiculosRecientes")) || []; } catch { return []; }
}

function guardarReciente(cita, version) {
  const lista = [{ cita, version }, ...leerRecientes().filter(r => r.cita !== cita || r.version !== version)].slice(0, MAX_RECIENTES);
  try { localStorage.setItem("versiculosRecientes", JSON.stringify(lista)); } catch {}
}

function guardarPosicion() {
  const b = estado.biblia;
  try { localStorage.setItem("bibliaPosicion", JSON.stringify({ version: b.version, libro: b.libro, capitulo: b.capitulo })); } catch {}
}

function leerPosicion() {
  try { return JSON.parse(localStorage.getItem("bibliaPosicion")) || null; } catch { return null; }
}

// El texto se achica según su largo; pasado cierto punto ya no se lee bien en pantalla.
function avisoLargo(texto) {
  const opModo = opcionPorClave("modo");
  const completo = opModo && /complet/i.test(String(valorOpcion(opModo)));
  const limite = completo ? 340 : 240;
  if (texto.length <= limite) return null;
  return completo
    ? `El texto es largo (${texto.length} letras) y se verá con letra pequeña. Considera mostrar menos versículos.`
    : `El texto es largo (${texto.length} letras) para el formato «Inferior». Considera «Pantalla completa» o menos versículos.`;
}

function citaDe(libro, capitulo, desde, hasta) {
  return `${estado.libros[libro].nombre} ${capitulo}:${desde}${hasta > desde ? "-" + hasta : ""}`;
}

// La primera vez abre el lector en la cita que ya tiene el overlay (o donde se quedó la última vez).
async function iniciarBiblia() {
  const b = estado.biblia;
  b.iniciado = true;
  try {
    if (!estado.libros) {
      const [libros, v] = await Promise.all([api("/api/biblia/libros"), api("/api/biblia/versiones")]);
      estado.libros = libros;
      estado.versiones = v.versiones;
      estado.versionPredeterminada = v.predeterminada;
    }
  } catch (err) {
    b.iniciado = false;
    b.aviso = { tipo: "error", texto: "No se pudo abrir la Biblia: " + err.message };
    repintarBiblia();
    return;
  }
  const pos = leerPosicion();
  const opVersion = opcionPorClave("version");
  const versionOverlay = opVersion ? String(valorOpcion(opVersion)).toUpperCase() : null;
  const conocida = id => estado.versiones.some(v => v.id === id);
  b.version = conocida(versionOverlay) ? versionOverlay : pos && conocida(pos.version) ? pos.version : estado.versionPredeterminada;

  const opCita = opcionPorClave("cita");
  try {
    const c = await api(`/api/biblia/cita?texto=${encodeURIComponent(valorOpcion(opCita))}`);
    if (c.desde) {
      b.enPantalla = { version: b.version, libro: c.libro, capitulo: c.capitulo, desde: c.desde, hasta: c.hasta };
      b.paso = c.hasta - c.desde + 1;
    }
    return irA(c.libro, c.capitulo, { sel: c.desde ? { desde: c.desde, hasta: c.hasta } : null });
  } catch {
    return irA(pos ? pos.libro : LIBRO_INICIAL, pos ? pos.capitulo : 3);
  }
}

// Carga un capítulo en el lector. sel: versículos a dejar elegidos; alFinal: elegir los últimos N;
// mostrar: mandar la selección al overlay apenas cargue.
async function irA(libro, capitulo, { sel = null, alFinal = 0, mostrar = false } = {}) {
  const b = estado.biblia;
  const pedido = ++b.pedido;
  Object.assign(b, { libro, capitulo, sel, versos: null, error: null, cargando: true, irASeleccion: true });
  if (sel) b.ancla = sel.desde;
  repintarBiblia();
  try {
    const r = await api(`/api/biblia/capitulo?version=${b.version}&libro=${libro}&capitulo=${capitulo}`);
    if (pedido !== b.pedido) return; // ya se pidió otro capítulo
    b.versos = r.versos;
  } catch (err) {
    if (pedido !== b.pedido) return;
    b.versos = [];
    b.error = err.message;
  }
  b.cargando = false;
  guardarPosicion();
  const ultimo = b.versos.length ? b.versos[b.versos.length - 1].v : 0;
  if (alFinal && ultimo) b.sel = { desde: Math.max(1, ultimo - alFinal + 1), hasta: ultimo };
  if (b.sel && b.sel.desde > ultimo && ultimo) {
    b.aviso = { tipo: "error", texto: `${estado.libros[libro].nombre} ${capitulo} llega hasta el versículo ${ultimo}.` };
    b.sel = null;
  } else if (b.sel) {
    b.sel.hasta = Math.min(b.sel.hasta, ultimo);
  }
  if (mostrar && b.sel) return mostrarSeleccion();
  repintarBiblia();
}

// Capítulo anterior o siguiente, pasando de un libro a otro.
function capituloVecino(delta) {
  const b = estado.biblia;
  let libro = b.libro, capitulo = b.capitulo + delta;
  if (capitulo < 1) {
    if (--libro < 0) return null;
    capitulo = estado.libros[libro].capitulos;
  } else if (capitulo > estado.libros[libro].capitulos) {
    if (++libro >= estado.libros.length) return null;
    capitulo = 1;
  }
  return { libro, capitulo };
}

function cambiarVersion(version) {
  const b = estado.biblia;
  b.version = version;
  irA(b.libro, b.capitulo, { sel: b.sel });
}

function elegirVerso(v, e) {
  const b = estado.biblia;
  if (e.shiftKey && b.sel) {
    b.sel = { desde: Math.min(b.ancla, v), hasta: Math.max(b.ancla, v) };
  } else {
    b.ancla = v;
    b.sel = { desde: v, hasta: v };
  }
  b.paso = b.sel.hasta - b.sel.desde + 1;
  b.aviso = null;
  repintarBiblia();
}

function mostrarSeleccion() {
  const b = estado.biblia;
  if (!b.sel || !b.versos) return;
  const texto = b.versos.filter(x => x.v >= b.sel.desde && x.v <= b.sel.hasta).map(x => x.t).join(" ");
  const cita = citaDe(b.libro, b.capitulo, b.sel.desde, b.sel.hasta);
  for (const [key, valor] of [["texto", texto], ["cita", cita], ["version", b.version]]) {
    const op = opcionPorClave(key);
    if (op) cambiarOpcion(op, valor);
  }
  b.enPantalla = { version: b.version, libro: b.libro, capitulo: b.capitulo, ...b.sel };
  guardarReciente(cita, b.version);
  const largo = avisoLargo(texto);
  b.aviso = largo
    ? { tipo: "alerta", texto: largo }
    : { tipo: "ok", texto: `✓ ${cita} (${b.version}) ya está en OBS.` };
  b.irASeleccion = true;
  pintarFormulario(); // también actualiza los campos de texto, cita y versión
  publicarAutoYa(); // en Versículos se publica siempre, y el versículo elegido va a OBS sin esperar
}

// Avanza o retrocede tantos versículos como se eligieron, y los muestra. El tamaño del bloque se
// recuerda (b.paso) aunque al final de un capítulo queden menos versículos.
function pasar(delta) {
  const b = estado.biblia;
  if (!b.sel || !b.versos || !b.versos.length) return;
  const n = b.paso || b.sel.hasta - b.sel.desde + 1;
  const ultimo = b.versos[b.versos.length - 1].v;
  if (delta > 0 && b.sel.hasta >= ultimo) {
    const sig = capituloVecino(1);
    if (sig) irA(sig.libro, sig.capitulo, { sel: { desde: 1, hasta: n }, mostrar: true });
    return;
  }
  if (delta < 0 && b.sel.desde <= 1) {
    const ant = capituloVecino(-1);
    if (ant) irA(ant.libro, ant.capitulo, { alFinal: n, mostrar: true });
    return;
  }
  const desde = delta > 0 ? b.sel.hasta + 1 : Math.max(1, b.sel.desde - n);
  b.sel = { desde, hasta: Math.min(desde + n - 1, ultimo) };
  b.ancla = desde;
  mostrarSeleccion();
}

async function irACita(texto, version, mostrar) {
  const b = estado.biblia;
  if (!texto.trim()) return;
  try {
    const c = await api(`/api/biblia/cita?texto=${encodeURIComponent(texto)}`);
    if (version && estado.versiones.some(v => v.id === version)) b.version = version;
    b.aviso = null;
    b.cita = "";
    b.paso = c.desde ? c.hasta - c.desde + 1 : 1;
    await irA(c.libro, c.capitulo, { sel: c.desde ? { desde: c.desde, hasta: c.hasta } : null, mostrar: mostrar && !!c.desde });
  } catch (err) {
    b.aviso = { tipo: "error", texto: err.message };
    repintarBiblia();
  }
}

function repintarBiblia() {
  const viejo = $("#seccionBiblia");
  if (!viejo) return;
  const lista = viejo.querySelector(".versos");
  const scroll = lista ? lista.scrollTop : 0;
  const nuevo = seccionBiblia();
  viejo.replaceWith(nuevo);
  ajustarScrollVersos(nuevo, scroll);
}

function ajustarScrollVersos(seccionEl, scroll) {
  const b = estado.biblia;
  const lista = seccionEl.querySelector(".versos");
  if (!lista) return;
  lista.scrollTop = scroll;
  if (b.irASeleccion && b.versos) {
    b.irASeleccion = false;
    const elegido = lista.querySelector('.verso[aria-pressed="true"]');
    if (elegido) lista.scrollTop = elegido.offsetTop - lista.clientHeight / 3;
    else lista.scrollTop = 0;
  }
}

function seccionBiblia() {
  const b = estado.biblia;
  const listo = !!estado.libros && b.libro != null;

  const irInput = el("input", {
    type: "text", id: "citaBiblia", value: b.cita,
    placeholder: "Ir a… Juan 3:16 · Sal 23 · 1 Co 13:4-7",
    "aria-label": "Ir a una cita",
    oninput: e => { b.cita = e.target.value; },
    onkeydown: e => { if (e.key === "Enter" && !e.ctrlKey) { e.preventDefault(); irACita(irInput.value, null, true); } }
  });
  const selVersion = el("select", { "aria-label": "Versión de la Biblia", title: "Versión de la Biblia", disabled: !listo, onchange: e => cambiarVersion(e.target.value) },
    (estado.versiones || []).map(v => el("option", { value: v.id, selected: v.id === b.version, title: v.nombre }, v.id)));

  const hijos = [el("div", { class: "biblia-fila" }, irInput, selVersion)];

  if (listo) {
    const ant = capituloVecino(-1), sig = capituloVecino(1);
    const grupo = (t, nombre) => el("optgroup", { label: nombre },
      estado.libros.filter(l => l.testamento === t).map(l => el("option", { value: l.libro, selected: l.libro === b.libro }, l.nombre)));
    const selLibro = el("select", { class: "sel-libro", "aria-label": "Libro", onchange: e => irA(+e.target.value, 1) },
      grupo("AT", "Antiguo Testamento"), grupo("NT", "Nuevo Testamento"));
    const caps = estado.libros[b.libro].capitulos;
    const selCap = el("select", { class: "sel-capitulo", "aria-label": "Capítulo", onchange: e => irA(b.libro, +e.target.value) },
      Array.from({ length: caps }, (_, i) => el("option", { value: i + 1, selected: i + 1 === b.capitulo }, `Cap. ${i + 1}`)));
    hijos.push(el("div", { class: "biblia-nav" },
      el("button", { class: "btn btn-suave btn-icono", type: "button", title: "Capítulo anterior", "aria-label": "Capítulo anterior", disabled: !ant, onclick: () => irA(ant.libro, ant.capitulo) }, "‹"),
      selLibro, selCap,
      el("button", { class: "btn btn-suave btn-icono", type: "button", title: "Capítulo siguiente", "aria-label": "Capítulo siguiente", disabled: !sig, onclick: () => irA(sig.libro, sig.capitulo) }, "›")));

    let contenido;
    if (b.cargando) contenido = el("p", { class: "versos-estado" }, "Cargando…");
    else if (b.error) contenido = el("p", { class: "versos-estado error" }, b.error);
    else {
      const p = b.enPantalla;
      const enPantalla = v => p && p.version === b.version && p.libro === b.libro && p.capitulo === b.capitulo && v >= p.desde && v <= p.hasta;
      contenido = b.versos.map(x => el("button", {
        type: "button",
        class: "verso" + (enPantalla(x.v) ? " en-pantalla" : ""),
        "aria-pressed": String(!!b.sel && x.v >= b.sel.desde && x.v <= b.sel.hasta),
        onclick: e => elegirVerso(x.v, e),
        ondblclick: () => { b.sel = { desde: x.v, hasta: x.v }; b.ancla = x.v; mostrarSeleccion(); }
      }, el("sup", {}, String(x.v)), x.t));
    }
    hijos.push(el("div", { class: "versos", role: "list", "aria-label": `${estado.libros[b.libro].nombre} ${b.capitulo}` }, contenido));

    const sel = b.sel;
    hijos.push(el("div", { class: "biblia-acciones" },
      el("button", { class: "btn btn-suave btn-chico", type: "button", disabled: !sel, title: "Muestra los versículos anteriores", onclick: () => pasar(-1) }, "‹ Anterior"),
      el("button", { class: "btn btn-primario btn-chico", type: "button", disabled: !sel, onclick: mostrarSeleccion },
        sel ? `Mostrar ${citaDe(b.libro, b.capitulo, sel.desde, sel.hasta)}` : "Elige un versículo"),
      el("button", { class: "btn btn-suave btn-chico", type: "button", disabled: !sel, title: "Muestra los versículos siguientes", onclick: () => pasar(1) }, "Siguiente ›")));
  } else if (!b.aviso) {
    hijos.push(el("p", { class: "versos-estado" }, "Abriendo la Biblia…"));
  }

  const aviso = b.aviso;
  hijos.push(el("p", { class: `nota-biblia ${aviso ? aviso.tipo : ""}`, "aria-live": "polite" },
    aviso ? aviso.texto : "Clic en un versículo para elegirlo, Mayús + clic para elegir varios, doble clic para mostrarlo al tiro."));

  const recientes = leerRecientes();
  if (recientes.length) {
    hijos.push(el("div", { class: "recientes" },
      el("span", { class: "etiqueta" }, "Recientes"),
      el("div", { class: "opciones-botones" }, recientes.map(r => el("button", {
        type: "button", title: `Volver a mostrar ${r.cita} (${r.version})`,
        onclick: () => irACita(r.cita, r.version, true)
      }, r.version === estado.versionPredeterminada ? r.cita : `${r.cita} · ${r.version}`)))));
  }

  const s = seccion("Biblia", [el("div", { class: "campo lector" }, ...hijos)]);
  s.id = "seccionBiblia";
  s.classList.add("fija");
  return s;
}

function seccion(titulo, hijos) {
  return el("details", { class: "seccion", open: true }, el("summary", {}, titulo), ...hijos);
}

function etiquetaDe(op) {
  return ETIQUETAS[op.key] || op.label;
}

let contadorId = 0;
const nuevoId = () => "c" + (++contadorId);

// Campos que manejan las herramientas de transmisión: se ven, pero se cambian desde la herramienta
const MOTIVOS = {
  programa: ["Lo pone «Programa al aire» según la programación.", "programa"],
  anuncios: ["Lo pone la lista de «Anuncios».", "anuncios"]
};

function campoControlado(etiqueta, c) {
  const [texto, herramientaId] = MOTIVOS[c.motivo] || ["Lo maneja una herramienta de transmisión.", null];
  const largo = String(c.valor).length > 60;
  return el("div", { class: "campo controlado", "data-buscar": `${etiqueta || ""} ${c.valor}`.toLowerCase() },
    etiqueta ? el("label", {}, etiqueta) : null,
    el(largo ? "textarea" : "input", { type: largo ? null : "text", value: String(c.valor), readOnly: true, rows: largo ? 2 : null, tabIndex: -1, "aria-label": etiqueta || "Texto automático" }),
    el("div", { class: "original" },
      el("span", {}, "🔒 " + texto),
      herramientaId ? el("button", { type: "button", onclick: () => abrirHerramienta(herramientaId) }, "Cambiar") : null));
}

function controlado(tipo, clave) {
  const c = estado.actual.controlados && estado.actual.controlados[tipo][clave];
  return c && !c.oculto ? c : null;
}

function campoOpcion(op) {
  const c = controlado("props", op.key);
  if (c) return campoControlado(etiquetaDe(op), c);
  const id = nuevoId();
  const v = valorOpcion(op);
  const etiqueta = etiquetaDe(op);
  const caja = el("div", { class: "campo", "data-buscar": `${etiqueta} ${v}`.toLowerCase() });

  if (op.editor === "boolean") {
    caja.append(el("label", { class: "interruptor", for: id },
      el("span", {}, etiqueta),
      el("input", { type: "checkbox", id, role: "switch", checked: !!v, onchange: e => cambiarOpcion(op, e.target.checked) })));
    return caja;
  }

  if (op.editor === "enum" && op.options) {
    const grupo = el("div", { class: "opciones-botones", role: "group", "aria-label": etiqueta });
    for (const opcion of op.options) {
      grupo.append(el("button", {
        type: "button", "aria-pressed": String(opcion === v),
        onclick: e => {
          for (const b of grupo.children) b.setAttribute("aria-pressed", String(b === e.currentTarget));
          cambiarOpcion(op, opcion);
        }
      }, opcion));
    }
    caja.append(el("span", { class: "etiqueta" }, etiqueta), grupo);
    if (op.urlParam) caja.append(el("p", { class: "nota-campo" }, "Si en OBS usas el enlace propio de cada pantalla, ese enlace manda sobre esta opción."));
    return caja;
  }

  if (op.editor === "range" || op.editor === "int" || op.editor === "number") {
    const min = op.min ?? 0, max = op.max ?? 100, step = op.step ?? 1;
    const salida = el("output", { for: id }, `${v}${op.unit ? " " + op.unit : ""}`);
    const rango = el("input", {
      type: "range", id, min, max, step, value: v,
      oninput: e => {
        const n = Number(e.target.value);
        salida.textContent = `${n}${op.unit ? " " + op.unit : ""}`;
        cambiarOpcion(op, n);
      }
    });
    caja.append(el("label", { for: id }, etiqueta), el("div", { class: "deslizador" }, rango, salida));
    return caja;
  }

  // Texto (y cualquier otro tipo desconocido)
  const largo = String(op.default ?? "").length > 60 || op.editor === "textarea";
  const input = el(largo ? "textarea" : "input", {
    id, type: largo ? null : "text", value: v ?? "", rows: largo ? 3 : null,
    placeholder: op.default ?? "",
    oninput: e => { cambiarOpcion(op, e.target.value); marcarCambio(caja, e.target.value !== op.default); }
  });
  caja.append(el("label", { for: id }, etiqueta), input, filaOriginal(String(op.default ?? ""), () => {
    input.value = op.default ?? "";
    cambiarOpcion(op, op.default);
    marcarCambio(caja, false);
  }));
  marcarCambio(caja, v !== op.default);
  return caja;
}

function campoTexto(campo, compacto) {
  const c = controlado("textos", campo.id);
  if (c) return campoControlado(null, c);
  const id = nuevoId();
  const v = valorTexto(campo);
  const largo = campo.original.length > 48 || campo.original.includes("\n");
  const caja = el("div", { class: "campo", "data-buscar": `${campo.original} ${v}`.toLowerCase() });
  const input = el(largo ? "textarea" : "input", {
    id, type: largo ? null : "text", value: v, rows: largo ? Math.min(4, campo.original.split("\n").length + 1) : null,
    placeholder: campo.original, "aria-label": `Texto: ${campo.original}`,
    oninput: e => { cambiarTexto(campo, e.target.value); marcarCambio(caja, e.target.value !== campo.original); }
  });
  caja.append(input);
  if (!compacto) {
    caja.append(filaOriginal(campo.original, () => {
      input.value = campo.original;
      cambiarTexto(campo, campo.original);
      marcarCambio(caja, false);
    }));
  }
  marcarCambio(caja, v !== campo.original);
  return caja;
}

// En listas como la programación, una hora (ej: "19:00") va al lado del texto que le sigue.
function camposLista(campos) {
  const filas = [];
  for (let i = 0; i < campos.length; i++) {
    const c = campos[i], sig = campos[i + 1];
    if (/^\d{1,2}[:.]\d{2}/.test(c.original) && sig && !/^\d{1,2}[:.]\d{2}/.test(sig.original)) {
      const fila = el("div", { class: "fila-lista" }, campoTexto(c, true), campoTexto(sig, true));
      fila.dataset.buscar = `${c.original} ${sig.original}`.toLowerCase();
      filas.push(fila);
      i++;
    } else {
      filas.push(campoTexto(c, true));
    }
  }
  return filas;
}

function filaOriginal(original, restaurar) {
  return el("div", { class: "original", hidden: true },
    el("span", { title: original }, `Original: ${original.replace(/\n/g, " ")}`),
    el("button", { type: "button", onclick: restaurar }, "Restaurar"));
}

function marcarCambio(caja, cambiado) {
  caja.classList.toggle("cambiado", cambiado);
  const o = caja.querySelector(".original");
  if (o) o.hidden = !cambiado;
}

function filtrar(texto) {
  const q = texto.trim().toLowerCase();
  for (const s of document.querySelectorAll("#formulario .seccion:not(.fija)")) {
    let visibles = 0;
    for (const c of s.querySelectorAll(":scope > .campo, :scope > .fila-lista")) {
      const valores = [...c.querySelectorAll("input, textarea")].map(i => i.value).join(" ").toLowerCase();
      const ok = !q || (c.dataset.buscar || "").includes(q) || valores.includes(q);
      c.hidden = !ok;
      if (ok) visibles++;
    }
    s.hidden = visibles === 0;
    if (q && visibles) s.open = true;
  }
  const hayAlgo = [...document.querySelectorAll("#formulario .seccion")].some(s => !s.hidden);
  let aviso = $("#formulario .sin-resultados");
  if (!hayAlgo && !aviso) $("#formulario").append(el("p", { class: "sin-resultados" }, "No hay textos que coincidan."));
  if (hayAlgo && aviso) aviso.remove();
}

// ---------- Guardado y publicación ----------

// En Versículos la publicación automática va siempre encendida: lo que se elige en vivo tiene que llegar a OBS.
function autoActivo() {
  return estado.autoPublicar || (!!estado.actual && esVersiculo());
}

function programarGuardado() {
  $("#indicadorGuardado").textContent = "Actualizando vista previa…";
  clearTimeout(estado.temporizador);
  estado.temporizador = setTimeout(guardarAhora, 450);
  if (autoActivo()) {
    clearTimeout(estado.tAuto);
    estado.slugAuto = estado.actual.slug;
    estado.tAuto = setTimeout(publicarAutoYa, ESPERA_AUTO_MS);
  }
}

// Envía a OBS la publicación automática pendiente (si la hay) sin esperar más.
async function publicarAutoYa() {
  if (!estado.tAuto) return;
  clearTimeout(estado.tAuto);
  estado.tAuto = null;
  const slug = estado.slugAuto;
  try {
    await guardarAhora();
    const r = await api(`/api/overlay/${slug}/publicar`, { method: "POST" });
    if (estado.actual && estado.actual.slug === slug) pintarEstado(r.pendiente);
    $("#indicadorGuardado").textContent = "Enviado a OBS ✓";
  } catch (err) {
    toast("No se pudo publicar automáticamente: " + err.message, "error");
  }
}

async function cambiarAuto(activo) {
  estado.autoPublicar = activo;
  try { localStorage.setItem("autoPublicar", activo ? "1" : "0"); } catch {}
  if (!activo) {
    clearTimeout(estado.tAuto);
    estado.tAuto = null;
    pintarEstado(!$("#btnPublicar").disabled);
    toast("Publicación automática desactivada. Usa «Publicar en OBS» para enviar los cambios.");
    return;
  }
  const pendiente = !$("#btnPublicar").disabled;
  if (pendiente) {
    await accion("publicar");
    toast("Publicación automática activada. Se enviaron los cambios pendientes a OBS.");
  } else {
    pintarEstado(false);
    toast("Publicación automática activada. Tus cambios llegarán a OBS solos.");
  }
}

async function guardarAhora() {
  if (!estado.temporizador || !estado.actual) return;
  clearTimeout(estado.temporizador);
  estado.temporizador = null;
  try {
    const r = await api(`/api/overlay/${estado.actual.slug}/borrador`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(estado.borrador)
    });
    pintarEstado(r.pendiente);
    $("#indicadorGuardado").textContent = "Vista previa al día";
  } catch (err) {
    $("#indicadorGuardado").textContent = "";
    toast("No se pudo guardar: " + err.message, "error");
  }
}

async function accion(nombre) {
  await guardarAhora();
  const r = await api(`/api/overlay/${estado.actual.slug}/${nombre}`, { method: "POST" });
  estado.borrador = JSON.parse(JSON.stringify(r.borrador));
  pintarEstado(r.pendiente);
  return r;
}

async function publicar() {
  if ($("#btnPublicar").disabled) return;
  clearTimeout(estado.tAuto);
  estado.tAuto = null;
  try {
    await accion("publicar");
    toast("¡Listo! OBS ya muestra los nuevos textos.");
  } catch (err) {
    toast("No se pudo publicar: " + err.message, "error");
  }
}

async function descartar() {
  if (!confirm("¿Descartar los cambios? Los textos volverán a ser los que se ven ahora en OBS.")) return;
  await accion("descartar");
  pintarFormulario();
  toast("Cambios descartados.");
}

async function restaurarOriginal() {
  if (!confirm("¿Volver todos los textos de este overlay al diseño original? Podrás revisarlos antes de publicar.")) return;
  await accion("restaurar");
  pintarFormulario();
  if (autoActivo()) {
    await accion("publicar");
    toast("Se restauró el diseño original y se envió a OBS.");
  } else {
    toast("Se restauró el diseño original en la vista previa. Publica para enviarlo a OBS.");
  }
}

async function elegirCarpeta() {
  if (!escritorio) return;
  const nueva = await escritorio.elegirCarpeta();
  if (nueva) { estado.actual = null; await cargarEstado(true); }
}

// ---------- Inicio ----------

function escucharEventos() {
  const es = new EventSource("/api/eventos");
  es.onmessage = e => {
    let d;
    try { d = JSON.parse(e.data); } catch { return; }
    if (d.tipo === "carpeta") cargarEstado();
    // Cambios que no hizo esta ventana (celular, programa al aire, anuncios)
    if (d.tipo === "cambio" && d.origen && d.canal === "borrador" && estado.actual && d.slug === estado.actual.slug) refrescarActual();
    if (d.tipo === "estudio" && estado.actual && estado.actual.controlados &&
      (Object.keys(estado.actual.controlados.textos).length || Object.keys(estado.actual.controlados.props).length)) refrescarActual();
    eventoHerramientas(d);
  };
  es.onerror = () => { es.close(); setTimeout(escucharEventos, 3000); };
}

function abrirAyuda() { $("#modalAyuda").hidden = false; $("#modalAyuda .modal-cerrar").focus(); }
function cerrarAyuda() { $("#modalAyuda").hidden = true; }

$("#btnPublicar").addEventListener("click", publicar);
$("#btnDescartar").addEventListener("click", descartar);
$("#btnRestaurar").addEventListener("click", restaurarOriginal);
$("#btnCarpeta").addEventListener("click", elegirCarpeta);
$("#btnActualizar").addEventListener("click", actualizarArchivos);
$("#autoPublicar").addEventListener("change", e => cambiarAuto(e.target.checked).catch(err => toast(err.message, "error")));
try { estado.autoPublicar = localStorage.getItem("autoPublicar") === "1"; } catch {}
$("#autoPublicar").checked = estado.autoPublicar;
$("#btnCarpetaVacio").addEventListener("click", elegirCarpeta);
$("#btnAyuda").addEventListener("click", abrirAyuda);
$("#buscar").addEventListener("input", e => filtrar(e.target.value));
for (const t of document.querySelectorAll(".tab")) t.addEventListener("click", () => cambiarCanal(t.dataset.canal));
$("#modalAyuda").addEventListener("click", e => { if (e.target.id === "modalAyuda" || e.target.closest("[data-cerrar]")) cerrarAyuda(); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") cerrarAyuda();
  if (e.key === "Enter" && e.ctrlKey && !estado.herramienta) { e.preventDefault(); publicar(); }
});
new ResizeObserver(ajustarVista).observe($("#vistaMarco"));

// Al terminar de cargar (herramientas.js va después de este archivo) se vuelve a abrir lo último que se
// estaba viendo: un overlay o una herramienta.
window.addEventListener("DOMContentLoaded", () => (async () => {
  pintarHerramientas();
  revisarAvisoCambio();
  let vista = null;
  try { vista = localStorage.getItem("vistaActual"); } catch {}
  const h = vista && vista.startsWith("h:") && HERRAMIENTAS.find(x => "h:" + x.id === vista);
  if (h) estado.herramienta = h.id;
  await cargarEstado();
  if (h) { estado.herramienta = null; await abrirHerramienta(h.id); }
})().catch(err => toast("No se pudo iniciar: " + err.message, "error")));
escucharEventos();
try { if (!localStorage.getItem("ayudaVista")) { abrirAyuda(); localStorage.setItem("ayudaVista", "1"); } } catch {}
