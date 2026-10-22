# Editor de Overlays · Radio Bendición

App de escritorio para cambiar los textos de los overlays de OBS (exportados de Claude Design) sin tocar código.

## Uso diario

1. Abre **Editor de Overlays** desde el acceso directo del escritorio o el menú Inicio.
2. Elige un overlay a la izquierda, cambia los textos a la derecha y revisa la vista previa.
3. Presiona **Publicar en OBS** (o Ctrl + Enter). OBS se actualiza solo.

Deja la app abierta mientras transmites: OBS recibe los overlays desde ella.

## Instalar (una vez por PC)

Ejecuta **Instalar Editor de Overlays.exe**. No pide permisos de administrador y crea un acceso directo en el escritorio.
El instalador trae todo: la app, los overlays (con `support.js`, `_ds/`, `assets/` y las fuentes) y los textos,
programas, presentadores y anuncios que estaban configurados al crearlo.

- **En un PC nuevo**, la primera vez se crea la carpeta `Documentos\Radio Bendición\Overlays` con todo eso.
  No viajan la contraseña de OBS ni los celulares conectados; el control remoto queda apagado (el PIN sí viaja).
- **En un PC que ya tenía la app**, se sigue usando su carpeta de siempre. Al instalar una versión nueva, los overlays
  que nadie modificó se actualizan; los que se cambiaron o borraron a mano se respetan. Los textos y la configuración de
  ese PC no se tocan.

Para llevarla a otro PC basta con copiar el instalador. Para desinstalar: Configuración de Windows → Aplicaciones →
Editor de Overlays (la carpeta de overlays no se borra).

## Agregar un overlay a OBS (una sola vez)

Fuentes → **+** → **Navegador** → pega el enlace que copias desde la app (ej. `http://127.0.0.1:7878/o/overlay-obs-lateral`) → Ancho 1920, Alto 1080.

## Overlays nuevos

Pon el nuevo `.dc.html` exportado de Claude Design en la misma carpeta (junto a `support.js`, `_ds/` y `assets/`).
La app detecta sola los textos visibles, las opciones del diseño (`data-props`) y las listas de datos del código (`const NOMBRE = [...]`).

Si agregas un overlay con la app abierta, presiona **Actualizar archivos** (abajo a la izquierda).
Solo se muestran diseños con formato de pantalla 16:9 (ej. 1920×1080); los diseños web, móviles o verticales se ignoran.

También sirven los diseños exportados como página autónoma (`.html` empaquetado, ej. `Overlay OBS Versiculos.html`):
la app los desempaqueta sola. Si un diseño está en los dos formatos, se usa el `.dc.html`.

## Versículos

En el overlay **Versiculos**, la sección «Biblia» es un lector completo (66 libros):

- Elige versión, libro y capítulo (o usa ‹ › para pasar de capítulo, también entre libros).
- Clic en un versículo para elegirlo, Mayús + clic para elegir varios, y **Mostrar** para enviarlo a OBS.
  Doble clic muestra un versículo al tiro.
- En Versículos la publicación automática va siempre encendida (no hay interruptor): lo que se muestra llega a OBS
  de inmediato, y lo que se escribe a mano, 2,5 segundos después de dejar de escribir.
- **Anterior / Siguiente** muestran el bloque de versículos anterior o siguiente (del mismo tamaño), ideal para
  seguir una lectura en vivo.
- «Ir a…» entiende citas escritas a mano (`Juan 3:16`, `sal 23`, `1 Co 13:4-7`, `Primera de Juan 4:8`).
- Los versículos que están en el overlay se marcan «● en pantalla», y las últimas citas quedan en «Recientes».

Versiones: RVR1960 (predeterminada), NTV, LBLA, RVG2004 y PDT (desde bolls.life), y RV1909, Valera 1602
Purificada, Nueva Biblia Viva, Biblia en Español Sencillo y Versión Biblia Libre (desde la API de HelloAO, la
misma del proyecto Biblia-Estudio). Necesita internet; sin conexión, el texto se puede escribir a mano en
«Texto del versículo».

Para tener el versículo abajo y a pantalla completa en escenas distintas de OBS, usa los enlaces
«Inferior» y «Pantalla completa» que aparecen bajo la vista previa.

## «Ahora suena» desde YouTube Music o Spotify

Los overlays Lateral y Minimal muestran solos la canción, el artista y la portada de lo que suena en
la app de escritorio **YouTube Music** (th-ch / Pear Desktop) o en **Spotify** de escritorio. Se actualizan solos
al cambiar de canción, sin recargarse, y el ecualizador se detiene cuando la música está en pausa. Si suenan las
dos, se muestra la que no está en pausa (y si ambas suenan, YouTube Music).

Con la opción «Mostrar «Ahora suena» solo mientras suena música» (encendida por defecto), el «Ahora suena»
aparece con su animación cuando empieza una canción y se va cuando la música se pausa o se detiene (espera unos
3 segundos, para no parpadear entre canciones). En Minimal, la diapositiva de la canción salta al frente cuando
empieza una canción y sale de la rotación cuando ya no suena. Apagada, se muestra siempre y, sin música, con la
canción escrita a mano.

**Spotify** no necesita configuración: la app lee lo que Spotify informa al panel multimedia de Windows (el que
aparece al subir el volumen). Los anuncios de Spotify Free no se muestran como canción.

**YouTube Music**, configurar una vez:

1. En la app de YouTube Music: menú **Complementos** → activa **API Server** (puerto 26538, el predeterminado).
2. En el editor, abre Lateral o Minimal. En la tarjeta «Música que suena» presiona **Conectar YouTube Music**.
3. En la app de YouTube Music aparece un aviso: elige **Permitir**. El permiso queda guardado en
   `youtube-music.json` (en la carpeta de overlays).

Si la app de música está cerrada o no hay nada sonando, se muestran la canción y el artista escritos a mano
(sección «Ahora suena» de cada overlay). Ahí mismo se puede apagar lo automático por overlay.

## Cambios suaves en OBS

Al publicar, OBS no recarga el overlay de golpe: la versión nueva se prepara escondida y, cuando ya está
dibujada, se funde encima de la anterior (medio segundo). La animación de entrada del diseño solo se ve la
primera vez que aparece el overlay; en los cambios siguientes solo se ve el fundido. Las animaciones continuas
(nubes, franjas, pulsos) siguen normales. Los enlaces de OBS no cambian.

## Publicar automáticamente

El interruptor junto a «Publicar en OBS» envía los cambios solos a OBS 2,5 segundos después de que dejas de escribir.
Apagado, los cambios solo se ven en la vista previa hasta que presionas «Publicar en OBS». (En Versículos siempre
está encendido.)

## Próximo programa automático

La programación semanal se edita en el overlay **Horarios** (lista «Radio»), que muestra solo la programación de la
radio, igual que la gráfica «Programación semanal». La app la entrega a los demás overlays
en `window.__programacion`, y **Despedida** calcula con la hora del PC cuál es el siguiente programa
(«Hoy · 20:00 hrs», «Mañana · 19:00 hrs», «Jueves · 19:00 hrs»). Al publicar cambios en Horarios, Despedida se
actualiza sola. Se puede apagar en Despedida → «Próximo programa» y escribirlo a mano.

## Transmisión (menú de la izquierda)

Arriba de la lista de overlays está el menú **Transmisión**. Lo que se configura ahí se guarda en `estudio.json`
(en la carpeta de overlays).

### En vivo · OBS

Desde aquí se cambia de escena, se inicia o detiene la transmisión y la grabación, se silencian los micrófonos y se ve
si se están perdiendo cuadros. Hay que configurarlo una vez: en OBS, **Herramientas → Configuración del servidor WebSocket**,
marca «Habilitar servidor WebSocket», copia la contraseña y pégala en la app → **Conectar**. Si OBS se cierra, la app se
reconecta sola.

**Si un overlay se ve en blanco en OBS**: casi siempre es porque OBS se abrió antes que el editor (OBS carga los overlays
desde la app). Al conectarse con OBS, la app recarga sola esas fuentes (si no se está transmitiendo ni grabando), y
el botón «Recargar overlays en OBS» lo hace en cualquier momento. Con «Abrir el editor al encender el PC», el editor se
abre minimizado al iniciar Windows y ya está listo cuando se abre OBS. Las fuentes deben usar el enlace
(`http://127.0.0.1:7878/o/...`), no «Archivo local»: como archivo local el overlay no recibe los textos ni los versículos.

**Cuenta regresiva**: eliges la escena de espera y la del programa, y presionas «Iniciar cuenta regresiva». OBS pasa a la
escena de espera, la cuenta de «Ya comenzamos» empieza de nuevo y, al llegar a cero, OBS cambia solo a la escena del programa.

### Programa al aire

Con «Cambiar los rótulos solos según la programación», los rótulos de Principal, Lateral, Marco, Minimal y Multimedia
(«AL AIRE · MIÉRCOLES 19:00», el nombre del programa y «Con …») muestran solos el programa que corresponde según la
programación de **Horarios** y la hora del PC, unos minutos antes de su hora (se elige cuántos). Para cada programa se
escriben sus presentadores y, si se quiere, cuánto dura. Sin duración, el programa se muestra hasta 4 horas después de su
inicio o hasta que empiece el siguiente programa (lo que pase primero).

Cuando un programa sigue al aire y llega la hora del siguiente (ej: jueves 19:00 y 20:00), aparece un aviso arriba en
la app (y en el celular) para confirmar el cambio: **Cambiar ahora** o **Mantener** el programa actual. Si nadie responde,
el rótulo cambia solo a los 2 minutos. Con «Mantener», el programa actual sigue hasta que termina (su duración o 4 horas)
y el aviso deja un botón para cambiar cuando se quiera. Entre programas se muestra el texto de «Cuando no hay programa al aire».

«Poner al aire ahora» muestra un programa a mano mientras dura (también sirve para un programa especial). Mientras está
encendido, esos textos aparecen bloqueados (🔒) en el panel de cada overlay.

### Anuncios

Lista de avisos que pasan uno tras otro por la franja inferior de Principal. Cada uno se puede apagar, ordenar y ponerle
fecha de inicio y de término (aparece y se va solo). La primera vez, la lista se arma con el texto que ya tenía la franja.
La franja mantiene la velocidad aunque haya más texto.

### Comentarios

Overlay propio de la app para mostrar un comentario del público (copiado del chat de YouTube, Facebook, WhatsApp…).
Se agrega una vez a OBS como fuente «Navegador» 1920 × 1080 con el enlace `http://127.0.0.1:7878/o/comentarios`, encima
de todo. Se elige la posición y cuántos segundos queda en pantalla (0 = hasta ocultarlo).

### Control remoto (celular)

Permite manejar todo lo anterior (y mostrar versículos con anterior/siguiente) desde un celular o tablet en el mismo Wi-Fi.
Se elige un PIN de 4 a 8 números, se enciende el interruptor y se escanea el código QR. El celular pide el PIN una vez.

- Funciona en el Wi-Fi al que esté conectado el PC; si cambia de red, la dirección y el QR se actualizan solos.
- La primera vez, Windows pregunta si permite que la app use la red: elige **Permitir**.
- Si Windows tiene la red como **Pública**, puede bloquear a los celulares: Configuración → Red e Internet → Wi-Fi →
  tu red → Tipo de perfil de red: **Privada**. La app avisa cuando pasa esto.
- El control remoto usa el puerto 7879 y solo está abierto mientras el interruptor está encendido. OBS sigue usando
  `127.0.0.1:7878`, que no se ve desde la red. Desde el celular no se puede cambiar el PIN ni la conexión con OBS.

## Fuentes

Las fuentes de Google que usan los overlays (Cormorant Garamond, Figtree, Caprasimo) van incluidas en la app,
así los overlays se ven igual sin internet. Si un overlay nuevo usa otra fuente, se descarga la primera vez que
haya internet y queda guardada en la carpeta `_fuentes/` (viaja con la carpeta a otro PC).

Los valores elegidos se guardan en `overlay-valores.json`; el editor nunca modifica los archivos de los overlays.
Ojo: Principal (sin «Ahora suena»), Horarios (sin cultos), Lateral, Minimal y Versiculos tienen cambios hechos a mano;
si se vuelven a exportar desde Claude Design, esos cambios hay que aplicarlos de nuevo.

## Para desarrolladores

- `server.js`: servidor local (puerto 7878) que entrega el editor y los overlays con los valores aplicados. `/o/<slug>` es
  un marco que muestra el overlay en una capa (`?capa=1`) y, cuando llega un cambio por Server-Sent Events, carga una
  capa nueva y la funde sobre la anterior.
- `overlay-parser.js`: detecta los campos editables y genera el HTML final.
- `biblia.js`: libros, versiones, citas escritas a mano y capítulos de la Biblia (con caché en memoria).
- `ytmusic.js`: lee la canción actual del API Server de YouTube Music Desktop.
- `spotify.js`: lee la canción y la portada de Spotify desde el panel multimedia de Windows (un PowerShell que corre
  solo mientras se usa). `server.js` junta ambas fuentes en `/api/musica`.
- `estudio.js`: programa al aire, anuncios, comentarios y PIN del control remoto (guardado en `estudio.json`). Los rótulos y
  la franja se cambian al generar el HTML de cada overlay (sin tocar los archivos), y `server.js` revisa cada 15 s si hay
  que actualizar algún overlay.
- `obs.js`: cliente de obs-websocket 5 (escenas, transmisión, grabación, audio).
- `ui/herramientas.js`: pantallas del menú «Transmisión»; `ui/remoto.*`: control remoto para el celular;
  `ui/overlay-comentarios.html`: overlay de comentarios.
- `main.js` / `preload.js`: ventana de Electron.
- `ui/`: interfaz del editor.
- `vendor/`: React, ReactDOM y Babel locales (para no depender de internet) y una copia de respaldo de `support.js`.

```
npm install
npm start            # abrir la app en modo desarrollo
npm run servidor     # solo el servidor; abrir http://127.0.0.1:7878 en el navegador
npm run fuentes      # incluye en la app las fuentes que usan los overlays de la carpeta
npm run construir    # genera dist/Instalar Editor de Overlays.exe con los overlays de la carpeta de arriba incluidos
                     # (preparar-instalador.js los copia a instalar/; instalacion.js los pone en la carpeta del PC)
```

Conviene construir en una copia de la carpeta completa de overlays fuera de OneDrive (para no sincronizar
`node_modules`), con la app en su subcarpeta «Editor de Overlays», igual que aquí.
