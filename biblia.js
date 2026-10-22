// Lector de la Biblia para el overlay de Versículos: lista de libros, capítulos completos en varias
// versiones y citas escritas a mano ("Juan 3:16", "1 Co 13:4-7", "Salmo 23").
// Los capítulos se piden a internet al momento y quedan en memoria mientras la app está abierta.
// Fuentes: bolls.life y la API de HelloAO (la misma que usa el proyecto Biblia-Estudio).

// Nombre que se muestra en el overlay -> de dónde se saca el texto
const VERSIONES = {
  RVR1960: { fuente: "bolls", codigo: "RV1960", nombre: "Reina-Valera 1960" },
  NTV: { fuente: "bolls", codigo: "NTV", nombre: "Nueva Traducción Viviente" },
  LBLA: { fuente: "bolls", codigo: "LBLA", nombre: "La Biblia de las Américas" },
  RVG2004: { fuente: "bolls", codigo: "RV2004", nombre: "Reina-Valera Gómez 2004" },
  PDT: { fuente: "bolls", codigo: "PDT", nombre: "Palabra de Dios para Todos" },
  RV1909: { fuente: "helloao", codigo: "spa_r09", nombre: "Reina-Valera 1909" },
  V1602P: { fuente: "helloao", codigo: "spa_v2p", nombre: "Valera 1602 Purificada" },
  NBV: { fuente: "helloao", codigo: "spa_onbv", nombre: "Nueva Biblia Viva" },
  BES: { fuente: "helloao", codigo: "spa_bes", nombre: "Biblia en Español Sencillo" },
  VBL: { fuente: "helloao", codigo: "spa_vbl", nombre: "Versión Biblia Libre" }
};
const VERSION_PREDETERMINADA = "RVR1960";

// Orden canónico: [nombre, capítulos, código USFM (HelloAO), ...abreviaturas comunes].
// El número del libro en bolls.life es la posición + 1.
const LIBROS = [
  ["Génesis", 50, "GEN", "gn", "gen"], ["Éxodo", 40, "EXO", "ex", "exo"], ["Levítico", 27, "LEV", "lv", "lev"],
  ["Números", 36, "NUM", "nm", "num"], ["Deuteronomio", 34, "DEU", "dt", "deut"], ["Josué", 24, "JOS", "jos"],
  ["Jueces", 21, "JDG", "jue", "jc"], ["Rut", 4, "RUT", "rt"], ["1 Samuel", 31, "1SA", "1 s", "1 sam"],
  ["2 Samuel", 24, "2SA", "2 s", "2 sam"], ["1 Reyes", 22, "1KI", "1 r", "1 re", "1 rey"], ["2 Reyes", 25, "2KI", "2 r", "2 re", "2 rey"],
  ["1 Crónicas", 29, "1CH", "1 cr", "1 cro"], ["2 Crónicas", 36, "2CH", "2 cr", "2 cro"], ["Esdras", 10, "EZR", "esd"],
  ["Nehemías", 13, "NEH", "neh"], ["Ester", 10, "EST", "est"], ["Job", 42, "JOB", "jb"],
  ["Salmos", 150, "PSA", "sal", "salmo", "sl", "ps"], ["Proverbios", 31, "PRO", "pr", "prov"], ["Eclesiastés", 12, "ECC", "ec", "ecl"],
  ["Cantares", 8, "SNG", "cnt", "cant", "cantar de los cantares"], ["Isaías", 66, "ISA", "is"], ["Jeremías", 52, "JER", "jer"],
  ["Lamentaciones", 5, "LAM", "lm", "lam"], ["Ezequiel", 48, "EZK", "ez", "eze"], ["Daniel", 12, "DAN", "dn", "dan"],
  ["Oseas", 14, "HOS", "os"], ["Joel", 3, "JOL", "jl"], ["Amós", 9, "AMO", "am"], ["Abdías", 1, "OBA", "abd"],
  ["Jonás", 4, "JON", "jon"], ["Miqueas", 7, "MIC", "mi", "miq"], ["Nahúm", 3, "NAM", "nah"], ["Habacuc", 3, "HAB", "hab"],
  ["Sofonías", 3, "ZEP", "sof"], ["Hageo", 2, "HAG", "hag"], ["Zacarías", 14, "ZEC", "zac"], ["Malaquías", 4, "MAL", "mal"],
  ["Mateo", 28, "MAT", "mt", "mat"], ["Marcos", 16, "MRK", "mr", "mc", "mar"], ["Lucas", 24, "LUK", "lc", "luc"],
  ["Juan", 21, "JHN", "jn"], ["Hechos", 28, "ACT", "hch", "hech"], ["Romanos", 16, "ROM", "ro", "rom"],
  ["1 Corintios", 16, "1CO", "1 co", "1 cor"], ["2 Corintios", 13, "2CO", "2 co", "2 cor"], ["Gálatas", 6, "GAL", "ga", "gal"],
  ["Efesios", 6, "EPH", "ef", "efe"], ["Filipenses", 4, "PHP", "fil", "flp"], ["Colosenses", 4, "COL", "col"],
  ["1 Tesalonicenses", 5, "1TH", "1 ts", "1 tes"], ["2 Tesalonicenses", 3, "2TH", "2 ts", "2 tes"], ["1 Timoteo", 6, "1TI", "1 ti", "1 tim"],
  ["2 Timoteo", 4, "2TI", "2 ti", "2 tim"], ["Tito", 3, "TIT", "tit"], ["Filemón", 1, "PHM", "flm", "filem"],
  ["Hebreos", 13, "HEB", "he", "heb"], ["Santiago", 5, "JAS", "stg", "sant"], ["1 Pedro", 5, "1PE", "1 p", "1 pe", "1 ped"],
  ["2 Pedro", 3, "2PE", "2 p", "2 pe", "2 ped"], ["1 Juan", 5, "1JN", "1 jn"], ["2 Juan", 1, "2JN", "2 jn"], ["3 Juan", 1, "3JN", "3 jn"],
  ["Judas", 1, "JUD", "jud"], ["Apocalipsis", 22, "REV", "ap", "apoc"]
].map(([nombre, capitulos, usfm, ...abreviaturas], i) => ({ nombre, capitulos, usfm, abreviaturas, testamento: i < 39 ? "AT" : "NT" }));

function sinAcentos(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// "1ra de Juan", "Primera Juan", "I Juan", "1Juan" -> "1 juan"
function normalizarLibro(s) {
  const t = sinAcentos(s).replace(/\./g, " ").replace(/\s+/g, " ").trim();
  const ordinales = { primer: 1, primera: 1, primero: 1, segunda: 2, segundo: 2, tercer: 3, tercera: 3, tercero: 3, i: 1, ii: 2, iii: 3 };
  // Números romanos y ordinales escritos solo cuentan si van separados del nombre (no la «I» de «Isaías»)
  let m = /^(primer[ao]?|segund[ao]|tercer[ao]?|iii|ii|i) (?:de )?(.+)$/.exec(t);
  if (m) return `${ordinales[m[1]]} ${m[2]}`;
  m = /^([123])(?:ra|ro|da|do|a|o|º|ª)? ?(?:de )?([a-z].*)$/.exec(t);
  if (m) return `${m[1]} ${m[2]}`;
  return t;
}

function buscarLibro(texto) {
  const q = normalizarLibro(texto);
  if (!q) return -1;
  // 1) Nombre completo o abreviatura exacta
  for (let i = 0; i < LIBROS.length; i++) {
    if ([LIBROS[i].nombre, ...LIBROS[i].abreviaturas].some(a => sinAcentos(a) === q)) return i;
  }
  // 2) Comienzo del nombre (ej: "Corin" no basta sin número, "1 corin" sí)
  if (q.replace(/^[123] /, "").length >= 2) {
    for (let i = 0; i < LIBROS.length; i++) {
      if (sinAcentos(LIBROS[i].nombre).startsWith(q)) return i;
    }
  }
  return -1;
}

// "Juan 3:16-18" -> { libro: 42, nombre: "Juan", capitulo: 3, desde: 16, hasta: 18 }
function interpretarCita(texto) {
  const t = String(texto || "").trim().replace(/[–—]/g, "-");
  const m = /^(.+?)\s*(\d+)\s*(?:[:.,]\s*(\d+)\s*(?:-\s*(\d+))?)?$/.exec(t);
  if (!m) throw new Error("Escribe la cita así: Juan 3:16  ·  Salmos 23:1-3  ·  1 Corintios 13");
  const libro = buscarLibro(m[1]);
  if (libro < 0) throw new Error(`No reconozco el libro «${m[1].trim()}». Prueba con el nombre completo, ej: Juan, Salmos, 1 Corintios.`);
  const capitulo = +m[2];
  if (capitulo < 1 || capitulo > LIBROS[libro].capitulos) {
    throw new Error(`${LIBROS[libro].nombre} tiene ${LIBROS[libro].capitulos} capítulo${LIBROS[libro].capitulos === 1 ? "" : "s"}.`);
  }
  const desde = m[3] ? +m[3] : null;
  const hasta = m[4] ? +m[4] : desde;
  if (desde && hasta < desde) throw new Error(`El rango ${desde}-${hasta} está al revés.`);
  return { libro, nombre: LIBROS[libro].nombre, capitulo, desde, hasta };
}

// Quita títulos de sección, marcas y etiquetas que algunas traducciones traen dentro del texto.
function limpiarVerso(s) {
  let t = String(s || "")
    .replace(/<p\b[^>]*>[\s\S]*?<\/p>/gi, " ")
    .replace(/<sup\b[^>]*>[\s\S]*?<\/sup>/gi, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/•/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?»)])/g, "$1")
    .trim();
  if (/^'.*'$/.test(t)) t = t.slice(1, -1).trim();
  return t;
}

// En HelloAO cada versículo es una lista de textos y objetos (notas, saltos de línea, palabras de Jesús...)
function textoHelloAO(contenido) {
  return contenido.map(p => typeof p === "string" ? p : (p && p.text) || "").join(" ");
}

const cache = new Map(); // "VERSION|libro|capítulo" -> versos

async function pedirJson(url) {
  let r;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch {
    throw new Error("No hay conexión a internet. Revisa la conexión o escribe el versículo a mano en «Texto del versículo».");
  }
  if (!r.ok) throw new Error(`El servicio de la Biblia respondió con error ${r.status}. Intenta de nuevo en un momento.`);
  return r.json();
}

// Devuelve [{ v: número, t: texto }] del capítulo pedido (libro = índice 0-65).
async function capitulo(version, libro, cap) {
  const v = VERSIONES[version];
  if (!v) throw new Error(`Versión desconocida: ${version}`);
  const L = LIBROS[libro];
  if (!L) throw new Error("Libro desconocido.");
  if (!(cap >= 1 && cap <= L.capitulos)) throw new Error(`${L.nombre} tiene ${L.capitulos} capítulos.`);
  const clave = `${version}|${libro}|${cap}`;
  if (cache.has(clave)) return cache.get(clave);

  let versos;
  if (v.fuente === "bolls") {
    const datos = await pedirJson(`https://bolls.life/get-text/${v.codigo}/${libro + 1}/${cap}/`);
    versos = datos.map(x => ({ v: x.verse, t: limpiarVerso(x.text) }));
  } else {
    const datos = await pedirJson(`https://bible.helloao.org/api/${v.codigo}/${L.usfm}/${cap}.json`);
    versos = datos.chapter.content.filter(x => x.type === "verse").map(x => ({ v: x.number, t: limpiarVerso(textoHelloAO(x.content)) }));
  }
  // La NTV abre con » los versículos que continúan una cita del anterior
  versos = versos.filter(x => x.t).map(x => ({ v: x.v, t: x.t.replace(/^»\s*/, "") }));
  if (!versos.length) throw new Error(`${L.nombre} ${cap} no está disponible en ${version}.`);
  cache.set(clave, versos);
  return versos;
}

function listaVersiones() {
  return Object.entries(VERSIONES).map(([id, v]) => ({ id, nombre: v.nombre }));
}

function listaLibros() {
  return LIBROS.map((l, i) => ({ libro: i, nombre: l.nombre, capitulos: l.capitulos, testamento: l.testamento }));
}

module.exports = { capitulo, interpretarCita, listaVersiones, listaLibros, VERSION_PREDETERMINADA };
