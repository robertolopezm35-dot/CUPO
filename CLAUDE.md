# CUPO

Plataforma que muestra en tiempo real los espacios de última hora en barberías, salones,
spas y estéticas, y permite reservar al instante. Nace de un problema validado con
pretotipo ("El Pinocho"): los negocios pierden el ingreso de cancelaciones de último
momento, y los clientes pierden tiempo escribiéndole a varios negocios por WhatsApp/
Instagram sin saber si hay disponibilidad real.

- **Cliente (quién paga):** el negocio de servicios, que paga por llenar los huecos de su agenda.
- **Usuario (quién usa):** la persona que necesita una cita de último momento cerca de donde está.
- **ODS al que contribuye:** ODS 8 · Trabajo decente y crecimiento económico.

## Estado actual

Prototipo estático (HTML/CSS/JS puro). Por defecto todo el "guardado de datos" vive en
`localStorage` del navegador. Ya está preparado el camino a una base de datos real en
Supabase (Postgres) — ver "Base de datos: Supabase" abajo — pero se activa solo cuando
se llenan las credenciales; hasta entonces la app funciona exactamente como antes.

### Archivos

- `index.html` — landing page
- `auth.html` + `js/auth.js` — login/registro con selector de rol **Cliente / Negocio**,
  y el flujo de "¿Olvidaste tu contraseña?"
- `reset-password.html` + `js/reset-password.js` — a donde llega el link del correo de
  recuperar contraseña para definir una nueva (solo funciona con Supabase conectado).
- `cliente.html` + `js/cliente.js` — panel del cliente: busca y reserva cupos
- `negocio.html` + `js/negocio.js` — panel del negocio: publica/gestiona su agenda
- `ventas.html` + `js/ventas.js` — dashboard de ventas del negocio (tipo Bewe): qué se
  está vendiendo, visible solo para el negocio dueño de la sesión.
- `css/styles.css` — estilos compartidos (paleta índigo del pitch deck)
- `js/store.js` — `CupoStore`: la "base de datos" en localStorage, datos semilla, y
  lógica de registro/reservas/áreas/categorías/países/servicios/ventas. Sigue siendo
  el modo por defecto.
- `js/supabase-config.js` — dos strings vacíos (`url`, `anonKey`) para las credenciales
  del proyecto de Supabase. Mientras estén vacíos, no pasa nada distinto.
- `js/supabase-store.js` — `SupabaseStore`: el mismo catálogo de funciones que
  `CupoStore`, pero async y respaldado por Postgres real en vez de localStorage.
- `js/schedule.js` — `CupoSchedule`: la lógica del horario semanal (qué cupos deben
  existir según los turnos, cierres y citas ya hechas). No toca ni el DOM ni la base:
  la usan igual `CupoStore` y `SupabaseStore` — ver "Horario semanal y calendario".
- `js/data-adapter.js` — define `DataStore`, que apunta a `SupabaseStore` si
  `supabase-config.js` tiene credenciales, o a `CupoStore` si no. `auth.js`,
  `cliente.js` y `negocio.js` solo hablan con `DataStore`, nunca directo con
  `CupoStore`/`SupabaseStore` — por eso cambiar de backend no toca esos tres archivos.
- `db/schema.sql` — el esquema completo de Postgres para Supabase (tablas, RLS,
  triggers, funciones RPC). Se corre una sola vez en el SQL Editor de Supabase.
- `db/migracion-horario-semanal.sql` — lo que le falta a una base que ya tenía
  `schema.sql` de antes para soportar el horario semanal (una instalación nueva no
  la necesita: `schema.sql` ya lo trae). Idempotente.
- `CNAME` — un archivo de una sola línea (`mycupo.com`) que le dice a GitHub Pages
  qué dominio propio debe servir — ver "Dominio propio: mycupo.com" abajo.
- `favicon.svg` — ícono del navegador, el mismo círculo índigo con "C" del logo.
- `404.html` — página de error con la marca de CUPO; GitHub Pages la sirve sola.
- `assets/app-screenshot.png` — screenshot real de `cliente.html` usado como mockup
  en el hero del landing (`index.html`).

## Base de datos: Supabase

Se eligió Supabase sobre otras opciones (Firebase/Firestore, un backend propio) porque
los datos de CUPO son claramente relacionales (negocio → cupo → reserva → cliente, con
llaves foráneas reales) y Supabase da Postgres real + autenticación seguro (reemplaza
las contraseñas en texto plano que localStorage tenía) + "realtime" (para que un cupo
reservado desaparezca al instante en otras pantallas) + plan gratis, todo sin necesitar
un servidor propio — encaja con que este proyecto no usa build tools.

**Para activarlo** (ninguno de estos pasos se puede hacer desde aquí — requieren tu
cuenta):
1. Crea un proyecto gratis en https://supabase.com
2. Ve a *Authentication → Providers → Email* y **apaga "Confirm email"** (si no, un
   registro nuevo no queda logueado de inmediato, distinto a como se comporta hoy).
3. Ve a *SQL Editor → New query*, pega todo `db/schema.sql` y dale Run.
4. Copia *Project Settings → API → Project URL* y la *anon public key*, y pégalas en
   `js/supabase-config.js`.
5. Listo — la app ya habla con Postgres, sin tocar ningún otro archivo.
6. Opcional: para tener los mismos 48 negocios de ejemplo de Monterrey en la base real
   (en vez de empezar vacía), abre la consola del navegador en cualquier página del
   sitio ya conectado y corre `await SupabaseStore.seedDemoBusinesses()` una sola vez.

**Importante:** esto solo puede funcionar en el sitio real (GitHub Pages / tu propio
hosting), **no en la demo de Artifact** — el sandbox de Artifacts bloquea cualquier
llamada de red a servicios externos como Supabase, así que esa demo se queda siempre en
modo localStorage.

**Sin probar en vivo:** escribí `supabase-store.js` y `schema.sql` siguiendo los
patrones oficiales del SDK de Supabase, pero no tengo credenciales para probarlos contra
un proyecto real — lo que sí se probó a fondo (con Playwright) es que el modo
localStorage sigue funcionando exactamente igual después de este cambio. Prueba el
flujo completo (registro, reservar, cancelar) apenas conectes tu proyecto.

## Decisiones de producto ya tomadas

- **Un solo flujo de autenticación** con pestañas Cliente/Negocio que llevan a paneles
  distintos (no dos apps separadas).
- **Registro de cliente:** nombre y apellido separados, teléfono con selector de país
  (código ISO + bandera, ~200 países, generadas automáticamente desde el código ISO) +
  validación de exactamente 10 dígitos antes de enviarse.
- **Categorías organizadas en Áreas → Subcategorías:**
  - Área **Estética** (activa): Barbería, Salón, Spa, Uñas, Maquillaje, Estética facial.
  - Área **Doctores** (marcada "Próximamente" — sin negocios todavía, solo panel de aviso).
- **Datos semilla:** 48 negocios reales de Monterrey (8 por subcategoría de Estética —
  30 originales + 18 agregados después para que el buscador y el orden por cercanía
  tuvieran más con qué demostrarse, repartidos en zonas nuevas como San Nicolás de los
  Garza y General Escobedo), investigados por web search — nombres y zonas reales,
  pero horarios/precios/logins (`nombre@cupo.mx` / `1234`) son datos de demo, no
  contacto real de esos negocios.
- **Patente más parecida encontrada:** US20220414607A1 (gestión de citas/reasignación de
  cancelaciones/notificaciones). Diferencia de CUPO: sincroniza *varios* negocios a la
  vez y notifica por geolocalización al cliente más cercano.
- **Fotos de negocio:** cada tarjeta muestra un banner con gradiente + emoji de categoría
  (generado por código, con color/tono variado por negocio). No son fotos reales — no
  hay licencia para usar fotos de Google Maps sin pasar por su Places API (requiere API
  key con facturación y no se puede cachear la imagen), así que se dejó como placeholder
  honesto hasta que haya backend o los negocios suban su propia foto.
- **Buscador, cancelar reserva, ordenar por cercanía y editar negocio:** el cliente puede
  buscar por nombre, cancelar una reserva ya hecha (reabre el cupo), y ordenar la lista
  por distancia real usando `navigator.geolocation` del navegador contra coordenadas
  aproximadas por colonia asignadas a cada negocio (no geocodificación exacta). El
  negocio puede editar nombre/categoría/dirección desde su panel.
- **Dashboard de Ventas (`ventas.html`), inspirado en Bewe:** cada cupo ahora tiene un
  campo `service` (lista de servicios predefinida por categoría — ej. Barbería: "Corte
  clásico", "Corte + barba"...; ver `SERVICES_BY_CATEGORY` en `js/store.js`). Cada
  reserva genera una fila en un historial de ventas permanente por negocio (`sales`:
  servicio, precio, cliente, fecha, estado `completada`/`cancelada` — no se borra al
  cancelar, solo cambia de estado). El dashboard (visible solo para el negocio dueño de
  la sesión) muestra: filtro por período (Hoy/7 días/30 días/Todo), total de ventas,
  ticket promedio, clientes atendidos, ingresos por día (o por semana si el rango es
  largo), **facturación por franja horaria** y **servicios más vendidos** — las tres
  métricas que Bewe realmente expone en sus reportes según su propio blog/documentación
  pública (investigado por web search, no inventado). Para que el dashboard no se vea
  vacío, los 48 negocios semilla traen ~20-35 ventas de demostración de los últimos 30
  días generadas por código (`seedSales` en `js/store.js`) — nombres de clientes
  genéricos, igual de "demo" que los logins `nombre@cupo.mx` / `1234`.

## Backlog ágil — funcionalidades agregadas esta fase

Se revisó el documento "Marco de trabajo ágil" del equipo (Product Backlog con
historias de usuario HU-01 a HU-18, prioridad MoSCoW) para ver qué le faltaba a la
app. De las historias que se podían construir sin depender de una cuenta o servicio
externo, se implementaron:

- **HU-05 — Folio de confirmación:** cada reserva genera un folio corto
  (`CUPO-XXXXXX`, ver `generateFolio()` en `js/store.js`) que se muestra en un modal
  de confirmación y queda guardado en la reserva del cliente.
- **HU-13 — Duración y política de cancelación:** cada cupo muestra su duración en
  minutos; el modal de reserva aclara "puedes cancelar sin costo hasta 1 hora antes,
  pagas en el negocio" (política de texto — el cobro en línea es HU-08, ver
  "Pendiente" abajo).
- **HU-10 — Filtro por servicio y horario:** en el panel del cliente, además del
  buscador por nombre, hay un filtro por servicio (depende de la categoría activa) y
  por franja horaria (mañana/tarde/noche).
- **HU-09 — Reservar para otros días:** el cliente ve y reserva cupos de los
  próximos 7 días (pestañas Hoy/Mañana/...), no solo hoy; el negocio elige el día al
  publicar un cupo.
- **HU-02 — Catálogo de servicios y fotos en el perfil:** el negocio edita su
  catálogo de servicios/precios y pega URLs de fotos propias desde "Editar negocio";
  el cliente las ve en la tarjeta. No se fabricaron fotos ni catálogos para los 48
  negocios reales de Monterrey — arrancan vacíos (`photos: []`, mismo criterio que ya
  regía las fotos — ver "Fotos de negocio" arriba) hasta que el negocio los llena.
- **HU-16 — Descuentos en cupos de cancelación:** el negocio publica un cupo con %
  de descuento; el cliente ve el precio original tachado, el precio final y un badge
  "-X%".
- **HU-17 — Elegir estilista/barbero:** el negocio da de alta a su personal desde
  "Editar negocio" y lo asigna a un cupo al publicarlo; el cliente ve "con [nombre]".
- **HU-06 — Reseñas de 1 a 5 estrellas:** solo quien ya reservó en ese negocio puede
  dejar una reseña (una por cliente-negocio, se actualiza si deja otra); el promedio
  y las reseñas recientes se muestran en la tarjeta del negocio.
- **HU-11 (ajustada) — Favoritos + aviso de cupos nuevos:** el cliente marca
  negocios favoritos y filtra "solo favoritos"; un banner avisa cuando un negocio
  favorito publica o reabre un cupo desde la última vez que se revisó
  (`createdAt`/`lastFavoritesCheck` en `js/store.js`). Es un aviso local dentro de la
  misma sesión del navegador, no una notificación push real — por eso el equipo la
  dejó "ajustada" en el Sprint 1 (la versión completa necesita una cuenta de servicio
  de push, ver "Pendiente" abajo).

Todo esto se construyó primero en `js/store.js` (localStorage) y se probó a fondo
con Playwright (flujo completo cliente+negocio, descuentos, favoritos, reseñas,
filtros, folio). Después se espejeó completo en `js/supabase-store.js` +
`db/schema.sql`: tablas nuevas `staff`, `reviews`, `favorites`; columnas nuevas en
`slots` (`original_price`, `discount_pct`, `staff_id`), `reservations`/`sales`
(`folio`), `sales` (`client_id`), `clients` (`last_favorites_check`), `businesses`
(`photos`, `services_catalog`); y funciones RPC nuevas (`generate_folio`,
`add_review`, `has_reservation_at`, `get_my_sales`, `toggle_favorite`,
`get_new_favorite_slots`, `touch_favorites_check`) — todas `security definer` para
que las reglas (solo quien reservó puede reseñar, un cliente nunca ve las ventas de
otro) se cumplan sin exponer de más vía RLS. Igual que el resto de Supabase, esto
**no se probó contra un proyecto real** (ver "Sin probar en vivo" arriba) — sí se
revisó a mano la lógica de RLS, en particular que el nombre de quien reservó sea
visible para el negocio dueño del cupo (política extra en `clients`) y que las
reseñas guarden `client_name` en la propia fila (no por join) para que no salgan en
null por la política de RLS de `clients`.

## Dashboard de Ventas — mejoras

Sobre el dashboard de Ventas original (ver "Dashboard de Ventas" arriba) se agregaron
cuatro mejoras, todas enfocadas en conectar el dashboard con features que ya existían
pero no se reportaban en ningún lado:

- **Tendencia vs. período anterior:** el total de ventas ahora muestra un "+X% vs.
  ayer" (o "vs. los 7/30 días anteriores", según la pestaña activa) comparando contra
  el período equivalente inmediato anterior. No aplica en la pestaña "Todo".
- **Tasa de cancelación:** nueva 4ta tarjeta de estadística — qué % de las citas del
  período se cancelaron, con la tarjeta en rojo si es ≥20%. Antes solo se veía
  cancelación por cancelación en la lista de historial, sin ningún resumen.
- **"Ventas con descuento":** nueva tarjeta de insight que muestra cuántas ventas,
  cuánto ingreso, qué % del total y qué descuento promedio vinieron de cupos
  publicados con descuento (HU-16) — para que el negocio sepa si sus descuentos de
  último momento realmente le están generando ventas o no.
- **"Ventas por colaborador":** nueva gráfica tipo ranking (igual que "Servicios más
  vendidos") agrupando ventas por el estilista/personal asignado al cupo (HU-17).
  Solo aparece si el negocio tiene al menos un colaborador dado de alta — para no
  mostrar una gráfica vacía en los negocios que no usan esa función (la mayoría de
  los 48 negocios semilla, que arrancan sin personal — ver "Fotos de negocio" arriba).

Para que estas dos últimas funcionen, cada venta ahora guarda una copia de
`discount_pct`/`original_price`/`staff_name` del cupo al momento de reservarlo (antes
se perdían). Esto requirió:

- `js/store.js` (`bookSlot`, `seedSales`): nuevos campos en cada venta.
- `js/supabase-store.js` (`mapSale`): lee las columnas nuevas.
- `db/schema.sql`: nuevas columnas `original_price`, `discount_pct`, `staff_name` en
  `sales`, y `book_slot()` actualizada para llenarlas (copia el staff del cupo por su
  nombre, no por id, por la misma razón que `reviews.client_name` — para que no se
  pierda si el negocio borra o cambia ese colaborador después).

**Acción pendiente tuya:** si ya conectaste Supabase, corre esto una sola vez en el
SQL Editor para traer tu base al día (es seguro de volver a correr, no borra nada):

```sql
alter table public.sales
  add column if not exists original_price numeric(10, 2),
  add column if not exists discount_pct int not null default 0,
  add column if not exists staff_name text;
```

y luego vuelve a pegar y correr la función `book_slot()` completa de `db/schema.sql`
(el `create or replace function` no afecta los datos existentes). Mientras no corras
esto, el sitio real sigue funcionando igual — las ventas nuevas simplemente no
tendrán esos tres campos hasta que lo hagas.

Todo esto se probó a fondo con Playwright en modo localStorage (datos inyectados a
mano para verificar los cálculos exactos de tendencia, tasa de cancelación, insight de
descuentos y ranking por colaborador) — no contra Supabase real, igual que el resto de
cambios de esquema de este proyecto (ver "Sin probar en vivo" arriba).

## Ronda de bugs y mejoras de UX

Se hizo una revisión completa de `cliente.js`/`negocio.js`/`auth.js`/`ventas.js` buscando
bugs reales y comparando contra patrones de plataformas como Booksy/Fresha, Booking.com y
Uber/DoorDash. Se encontraron y corrigieron:

- **XSS almacenado (bug de seguridad, el más serio):** el nombre del negocio, su
  dirección, catálogo de servicios, personal, URLs de fotos, y — el vector más grave —
  el nombre de cualquier cliente y el texto de sus reseñas, se insertaban sin escapar
  vía `innerHTML`/atributos en `cliente.js`, `negocio.js` y `ventas.js`. Cualquiera
  puede registrarse como cliente con el nombre que quiera o dejar una reseña con
  cualquier texto, así que sin esto un nombre o reseña con `<img onerror=...>` se
  ejecutaba como script en la pantalla de cualquiera que la viera — incluyendo al
  negocio dueño del cupo reservado, y a todos los clientes que vieran esa reseña en la
  tarjeta del negocio. Se agregó una función `esc()` (local en cada uno de los tres
  archivos) y se aplicó a todo texto libre antes de insertarlo en el DOM. Verificado
  con Playwright inyectando payloads reales (`<img src=x onerror=alert(1)>` como
  nombre de cliente y como comentario de reseña) y confirmando que no se ejecuta
  ningún diálogo/script y que el texto se ve escapado en `cliente.html`, `negocio.html`
  y `ventas.html`.
- **El registro de negocio nuevo no dejaba elegir Uñas ni Maquillaje:** `auth.html`
  traía un `<select>` de categoría fijo en el HTML (Barbería/Salón/Spa/**Estética**) —
  "Estética" no es una categoría válida, es el nombre del *área* que las agrupa a
  todas. Un negocio que la elegía quedaba con `category: "Estética"` sin validación
  (`registerBusiness` guarda lo que le llega, no valida contra una lista), lo cual lo
  hacía **invisible en todos los filtros del panel de cliente** (`area.categories
  .includes(b.category)` nunca es cierto para ese valor) — y de las 6 categorías reales
  solo 3 estaban en la lista. Se corrigió poblando el `<select>` por JS desde
  `DataStore.CATEGORIES`, la misma fuente que ya usa el negocio para editar su perfil
  después de registrado.
- **Un cupo "fantasma" tras perder la carrera por reservarlo:** si dos clientes
  intentaban reservar el mismo cupo casi al mismo tiempo, el que perdía solo veía un
  toast de error pero la lista no se refrescaba — el cupo seguía viéndose
  "disponible" y podía volver a fallar al intentarlo de nuevo. Se agregó
  `renderBusinesses()` también en la rama de error de `bookSlot`.
- **Sin protección de doble-submit en login/registro:** a diferencia del resto de
  botones async de la app (que ya se corrigieron antes esta sesión), los 4
  formularios de `auth.html` no deshabilitaban su botón mientras esperaban la
  respuesta — un doble clic podía disparar dos registros/logins a la vez. Se agregó
  el mismo guard (`disabled` + texto "Un momento...") usado en el resto de la app.
- **Autocomplete en los campos de auth.html:** se agregaron los atributos
  `autocomplete` estándar (`email`, `new-password`, `current-password`,
  `given-name`/`family-name`, etc.) — sin ellos, los gestores de contraseñas del
  navegador no pueden ofrecer autocompletar/guardar en estos formularios, algo que
  cualquier plataforma trae por default.
- **"Auto-refresh" silencioso (inspirado en cómo Uber/DoorDash muestran su
  inventario en vivo):** CLAUDE.md ya prometía "tiempo real" como una de las razones
  para elegir Supabase, pero ni `cliente.html` ni `negocio.html` se actualizaban
  solas — si otro cliente reservaba un cupo, o el negocio publicaba uno nuevo,
  había que recargar la página a mano para enterarse. Se agregó un refresco
  silencioso cada 20 segundos en ambos paneles (sin tocar la UI si hay un modal
  abierto o el cliente está escribiendo en el buscador, para no interrumpir).
- **Badge de escasez tipo Booking.com ("¡Solo queda 1!"):** cuando a un negocio le
  quedan 1 o 2 cupos disponibles ese día, la tarjeta ahora lo muestra con un badge
  ámbar junto a la categoría — refuerza justo la propuesta de valor de CUPO (cupos
  de último momento que se pueden acabar), el mismo patrón de urgencia que usan
  Booking.com/Airbnb con su disponibilidad.

Todo se probó con Playwright en modo localStorage: registro con nombre malicioso,
reseña con payload XSS, categorías del registro de negocio, doble-submit, una
reserva que pierde la carrera contra otro cliente, y el badge de escasez con un
negocio con exactamente 1 cupo — los 6 casos pasaron.

## Segunda ronda de mejoras

Seguimiento a la ronda anterior — esta vez enfocado en accesibilidad, resiliencia y
features inspiradas en cómo otras plataformas resuelven lo mismo:

- **Recuperar contraseña:** nuevo link "¿Olvidaste tu contraseña?" en los dos login
  (cliente/negocio) y una página nueva `reset-password.html` donde se define la
  contraseña nueva. Usa `resetPasswordForEmail`/`updateUser` de Supabase Auth (el
  SMTP de Resend que ya está configurado se encarga del correo) —
  `DataStore.requestPasswordReset(email)`/`DataStore.updatePassword(password)`
  nuevas en `js/supabase-store.js`. En modo localStorage (`js/store.js`) ambas
  regresan un error explicando que esto solo funciona en el sitio conectado a
  Supabase, en vez de fallar en silencio. **Acción pendiente tuya:** en el
  dashboard de Supabase, ve a *Authentication → URL Configuration → Redirect URLs*
  y agrega la URL de `reset-password.html` en tu sitio real (ej.
  `https://tu-dominio/reset-password.html`, o el wildcard `https://tu-dominio/**`)
  — Supabase rechaza el redirect del correo si no está en esa lista. Sin ese paso,
  el link del correo sigue llegando pero no deja completar el cambio de contraseña.
  No se probó contra un proyecto real (mismo criterio que el resto de Supabase en
  este documento — ver "Sin probar en vivo" arriba).
- **Accesibilidad:** los botones de solo-ícono (♡/♥ favorito, ★ reseña, ✕ quitar
  fila en Editar negocio) no tenían forma de que un lector de pantalla supiera qué
  hacían — se agregaron `aria-label`/`aria-pressed`.
- **Resiliencia ante fallos de red:** `renderBusinesses()` en `cliente.js` y
  `render()` en `negocio.js` ahora atrapan errores de red en vez de romperse en
  silencio — sobre todo importante ahora que ambos se vuelven a llamar solos cada
  20s (auto-refresh de la ronda anterior). Un fallo deja lo último que ya se había
  mostrado en pantalla (nunca la borra) y avisa con un toast, salvo en los refrescos
  silenciosos/de fondo donde solo queda en consola para no fastidiar con un toast
  repetido si la conexión sigue mal.
- **Loading state:** la lista de cupos del cliente se atenúa un poco mientras
  recarga al cambiar de pestaña/categoría/ubicación — no pasa en el buscador (para
  no parpadear en cada tecla) ni en el refresco silencioso de fondo.
- **Aviso de cambios sin guardar:** si el negocio modifica algo en "Editar negocio"
  y lo cierra (✕/clic afuera/Esc/Cancelar) sin guardar, ahora confirma antes de
  descartar.
- **Compartir un negocio (deep link):** cada tarjeta tiene un botón 🔗 que copia un
  link directo (`cliente.html?negocio=ID`) — igual que "compartir este lugar" en
  OpenTable/Booksy. Abrirlo sin sesión no lo pierde: pasa por el login y regresa
  exactamente ahí (`next=` en la URL), y la tarjeta se resalta un momento al llegar.

## Enlaces

- **Repo / rama de trabajo:** `feature/cupo-web-app` en
  https://github.com/robertolopezm35-dot/CUPO — GitHub Pages ya está activado y
  sirviendo justo esta rama (se redeploya solo en cada push; confirmado contra el
  historial de Actions del repo).
- **Sitio en vivo:** https://robertolopezm35-dot.github.io/CUPO/ — y pronto
  **https://mycupo.com**, ver "Dominio propio" abajo.
- **Demo interactiva (Artifact, un solo archivo, mismo diseño y lógica):**
  https://claude.ai/artifact/Tye5bmxEpK3d9RZjsMNZd7
- **Lean Canvas del proyecto (Artifact):**
  https://claude.ai/artifact/5FiGjj5526zhACDbA8KKGT

## Dominio propio: mycupo.com

Ya comprado. Para conectarlo a GitHub Pages:

- Ya se agregó el archivo `CNAME` (en la raíz del repo, rama `feature/cupo-web-app`)
  con el contenido `mycupo.com` — así es como GitHub Pages sabe qué dominio debe
  servir; sin este archivo, el DNS correcto no sirve de nada.
- **Acción pendiente tuya — en el DNS de donde compraste el dominio** (Namecheap,
  GoDaddy, Google Domains...), agrega:
  - 4 registros **A** para `mycupo.com` (el dominio raíz/apex) apuntando a:
    `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
  - (opcional, IPv6) 4 registros **AAAA** apuntando a:
    `2606:50c0:8000::153`, `2606:50c0:8001::153`, `2606:50c0:8002::153`,
    `2606:50c0:8003::153`
  - Si también quieres que `www.mycupo.com` funcione: un registro **CNAME** para
    el host `www` apuntando a `robertolopezm35-dot.github.io`
- El DNS puede tardar desde minutos hasta 24 horas en propagarse. Una vez que
  propague, ve a *Settings → Pages* del repo en GitHub: debería mostrar
  `mycupo.com` ya verificado (lo toma solo del archivo `CNAME`) — ahí mismo marca
  **"Enforce HTTPS"** en cuanto esa casilla deje de estar en gris (GitHub emite el
  certificado solo, pero tarda un rato después de que el DNS ya resuelve bien).
- Opcional pero recomendado por GitHub: agregar un registro **TXT** de verificación
  de dominio (`_github-pages-challenge-robertolopezm35-dot.mycupo.com`) desde
  *Settings → Pages → Add a domain* en GitHub, para que nadie más pueda reclamar
  este dominio en otro repo. No es necesario para que el sitio funcione, solo para
  esa capa extra de seguridad.
- Mientras el DNS no propague, `https://robertolopezm35-dot.github.io/CUPO/` sigue
  funcionando exactamente igual — no se rompe nada en lo que haces el cambio.

**Estado (10 nov 2026):** DNS ya configurado en Cloudflare (los 8 registros A/AAAA en
"DNS only", el CNAME de `www`), dominio ya verificado por GitHub (el TXT se aceptó).
Solo falta que GitHub termine de emitir el certificado SSL — la casilla "Enforce
HTTPS" en *Settings → Pages* sigue en "DNS Check in Progress"; es automático, no hay
nada más que hacer salvo esperar (y, si tarda mucho, volver a darle "Save" al campo
del dominio para forzar un chequeo).

## Tercera ronda de mejoras

Una pasada de diseño/pulido tras revisar screenshots reales de las 4 pantallas
principales en escritorio y móvil — encontrados y corregidos:

- **Texto cortado en "Publicar cupo" (escritorio):** los selects de Servicio y
  Estilista se truncaban (`.add-slot-row .field:has(select)` ahora con más
  `min-width`).
- **"Citas pasadas" vacío aunque Ventas mostrara historial:** `seedPastHistory()` en
  `js/store.js` (antes `seedSales`) ahora genera, para cada venta de demo no
  cancelada, un cupo "pasado" real en `business.slots` con el mismo día/servicio/
  precio/cliente — antes las ventas de demo no tenían ningún cupo vinculado
  (`slotId: null` siempre), así que negocio.js nunca tenía nada que mostrar ahí. Las
  ventas canceladas siguen sin generar cupo (en la vida real ese cupo se reabrió).
- **Estados vacíos rediseñados:** `.empty-state` pasó de 60px de padding flotando
  solo a una tarjeta con borde punteado, más compacta.
- **Grid de 2 columnas en escritorio para la lista de negocios:** `#businessList`
  usa `column-count` (no `grid`) a partir de 900px — así tarjetas de altura distinta
  no dejan huecos feos entre filas.
- **Filtros secundarios colapsados en móvil:** "Ordenar por cercanía"/"Solo
  favoritos"/los 2 selects ahora viven detrás de un botón "⚙️ Filtros" que solo
  aparece en pantallas chicas (≤700px) — el buscador se queda siempre visible. En
  escritorio no cambió nada.
- **Mockup de la app en el hero del landing:** un screenshot real de
  `cliente.html` (con datos demo) en un marco tipo ventana de navegador
  (`assets/app-screenshot.png`), más una fila de 3 stats honestos (48 negocios, 6
  categorías, "$0 — pagas en el negocio").
- **"Ingresos por día" en Ventas ahora es una línea con área rellena** (SVG puro,
  sin librerías) en vez de barras — con un solo punto (período "Hoy") cae de vuelta
  a las barras, porque una línea de un solo punto no dice nada.
- **Favicon** (`favicon.svg`, el mismo círculo índigo con "C") y **página 404**
  (`404.html`) con la marca de CUPO en vez de la genérica de GitHub Pages.

Probado con Playwright contra las 4 páginas principales en escritorio y móvil — sin
errores de JS, los 33 cupos pasados de demo aparecen en negocio.html, el toggle de
filtros en móvil funciona, el grid de 2 columnas y la gráfica de línea se ven
correctos en las capturas.

## Subida real de fotos (Supabase Storage)

Hasta ahora, tanto las fotos de perfil del negocio como (al agregarse en HU-02) las
reseñas solo aceptaban pegar una URL externa ya subida a otro lado. Se agregó subida
real de archivos desde el propio dispositivo, en dos lugares:

- **Fotos de negocio** (`negocio.html` → "Editar negocio"): junto al textarea de URLs
  ya existente, un `<input type="file" id="editPhotoFile" accept="image/*" multiple>`
  — al elegir uno o varios archivos, cada uno se sube de inmediato y su URL resultante
  se agrega como una línea más al textarea (que sigue funcionando exactamente igual
  para quien prefiera seguir pegando URLs a mano; ambos métodos conviven).
- **Foto en una reseña** (`cliente.html` → modal "Dejar reseña"): un campo de archivo
  opcional junto al comentario. Sigue aplicando la misma regla de siempre (HU-06) —
  solo puede dejar reseña, con o sin foto, quien ya reservó en ese negocio
  (`hasReservationAt`/`has_reservation_at`); esto no cambió, la foto es un campo más
  dentro del mismo flujo ya protegido.

Implementación, en los dos backends:

- **`js/store.js` (localStorage):** `uploadPhoto(ownerId, file)` nueva — no hay un
  servicio de archivos real en este modo, así que el archivo se convierte a un
  `data:` URI con `FileReader.readAsDataURL()` y así se guarda. Límite de 1.2 MB por
  imagen (localStorage tiene cupo total de ~5-10 MB por sitio compartido con el resto
  de la demo, y base64 infla el archivo original ~33%) — si el archivo pesa más, se
  rechaza con un mensaje explicando por qué, en vez de romper el storage del
  navegador. `addReview` ahora guarda también `photoUrl` en la reseña.
- **`js/supabase-store.js` (real):** `uploadPhoto(ownerId, file, kind)` nueva — sube
  el archivo de verdad a Supabase Storage (`client.storage.from('photos').upload(...)`)
  en la ruta `<kind>/<ownerId>/<timestamp>-<random>.<ext>` (`kind` es `"business"` o
  `"review"`) y regresa la URL pública (`getPublicUrl`). Límite de 5 MB (el plan
  gratis de Supabase Storage permite hasta 50 MB por archivo, pero 5 MB ya es más que
  suficiente para una foto de celular comprimida y evita que alguien use todo el 1 GB
  gratis con un solo archivo). `add_review()` (RPC) ahora acepta `p_photo_url` y lo
  guarda en la reseña.
- **`db/schema.sql`:** columna nueva `reviews.photo_url`; `add_review()` actualizada;
  nuevo bucket de Storage `photos` (público, para que cualquiera pueda *ver* las fotos
  sin necesitar sesión) con 3 políticas RLS sobre `storage.objects`: un negocio solo
  puede subir a su propia carpeta `business/<su-uid>/...`, un cliente solo a
  `review/<su-uid>/...` (comparando contra `auth.uid()`, no contra el id que manda el
  cliente, para que nadie pueda subir "como" otro negocio o cliente), y cualquiera
  puede leer (`select`) cualquier archivo del bucket.

Todo esto se probó a fondo con Playwright en modo localStorage: subir una foto de
negocio y verificar que su URL (`data:image/...`) aparece en el textarea y se guarda
en `business.photos`; que un archivo de más de 1.2 MB se rechaza con el mensaje
correcto sin tocar lo ya guardado; y el flujo completo de reseña con foto (seleccionar
estrellas, comentario, foto, enviar) verificando que la reseña guarda `photoUrl` y que
el thumbnail se renderiza en la tarjeta del negocio escapado con la misma función
`esc()` del resto del proyecto (defensa adicional, aunque la URL en este caso la genera
el propio backend, no texto libre del usuario). **No se probó contra Supabase real**
(mismo criterio que el resto de cambios de esquema de este proyecto — ver "Sin probar
en vivo" arriba).

**Acción pendiente tuya:** si ya conectaste Supabase, corre esto una sola vez en el
SQL Editor para traer tu base al día (es seguro de volver a correr, no borra nada):

```sql
alter table public.reviews add column if not exists photo_url text;

insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "Negocios suben fotos solo a su propia carpeta"
on storage.objects for insert
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = 'business'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "Clientes suben fotos de reseña solo a su propia carpeta"
on storage.objects for insert
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = 'review'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "Cualquiera puede ver las fotos del bucket"
on storage.objects for select
using (bucket_id = 'photos');
```

y luego vuelve a pegar y correr la función `add_review()` completa de `db/schema.sql`
(el `create or replace function` no afecta las reseñas existentes). Mientras no
corras esto, el sitio real sigue funcionando igual — las fotos de negocio seguirán
aceptando solo URL pegada a mano hasta que exista el bucket, y las reseñas nuevas
simplemente no tendrán foto.

## Vista previa del negocio

El negocio ahora puede ver, con un botón "👁️ Vista previa" junto a "Editar negocio",
exactamente la misma tarjeta que ve un cliente en `cliente.html`: foto/banner,
nombre, dirección, calificación, badge de categoría, badge de escasez si quedan 1-2
cupos hoy, catálogo de servicios, los cupos de hoy (con descuento/estilista/duración
tal como los ve un cliente) y sus reseñas recientes con foto. Es de solo lectura — no
se puede reservar ni dejar reseña desde ahí, solo mirar.

Se construyó como una vista independiente dentro de `negocio.js`
(`renderPreviewCard()`), en vez de reusar `cliente.html` directamente, porque esa
página exige una sesión de **cliente** (`session.role === "cliente"`) y un negocio
logueado no tiene (ni debería crear) una cuenta de cliente solo para mirar su propia
tarjeta. En cambio, se duplicaron los mismos helpers pequeños que ya arma la tarjeta
en `cliente.js` (`businessPhoto()`, `avgRating()`, el manejador de fotos rotas) —
mismo criterio que `esc()`, ya duplicada en cada archivo — así la vista previa usa
exactamente las mismas clases CSS (`biz-card`, `slot`, `catalog-details`,
`review-row`...) y se ve idéntica sin tener que cargar `cliente.js` entero ni tocar su
lógica de sesión/reservas.

Probado con Playwright en modo localStorage: botón abre el modal con los datos reales
del negocio (nombre, catálogo, cupo de hoy con descuento y estilista, badge de
escasez con 1 cupo disponible, badge de categoría, estado sin reseñas), y el botón
"Cerrar" cierra el modal correctamente.

## Horario semanal y calendario

Antes el negocio publicaba cupo por cupo, a mano. Ahora define su semana una sola vez
y los cupos se publican solos; el panel (`negocio.html`) pasó de una lista de cupos a
un calendario.

**Lo que hace el negocio**

- **Horario semanal** (botón en su panel): una tarjeta por persona del equipo (más
  "sin persona asignada" / "Mi negocio" si trabaja solo). En cada una: qué servicios
  del catálogo hace esa persona (uno puede ser solo barbero y otro hacer los tres) y
  sus turnos — días de la semana, de qué hora a qué hora, y cada cuánto es una cita.
  Se pueden tener varios turnos (mañana y tarde con comida en medio, sábado más
  corto) y copiar los turnos de otra persona. Necesita al menos un servicio con
  precio en el catálogo (de ahí salen servicio y precio de cada cupo); "Editar
  negocio" ahora puede sugerir los de la categoría y no deja guardar uno sin precio.
- **Calendario mensual:** hoy resaltado, cuántas citas y cuántos cupos libres tiene
  cada día, días cerrados (rojo), días que no se trabaja según el horario (rayado),
  ausencias de una persona (ámbar). En celular quedan solo los números y colores.
- **Panel del día** (al tocar un día): sus cupos agrupados por persona. Desde ahí se
  agrega un cupo suelto, se cierra/reabre el día, y al tocar un cupo se le pone
  descuento, se le fija un servicio, se quita, se **agenda a mano** a alguien que
  llamó o llegó sin reservar (cuenta como venta), o se **cancela la cita**.
- **Cerrar día:** todo el negocio o solo una persona, un día o varios seguidos
  (vacaciones), con motivo opcional. Quita los cupos libres y deja de publicar; las
  citas ya reservadas NO se cancelan solas (lo avisa y se cancelan una por una).

**Decisiones de diseño**

- **Cupos "flexibles":** un cupo del horario no trae servicio fijo — ofrece los del
  catálogo que hace la persona asignada y el cliente elige al reservar (si solo hay
  uno, reserva directo). Un solo cupo por persona y hora, en vez de uno por servicio
  que se pisarían entre sí. El servicio y precio quedan fijos al reservar y el cupo
  vuelve a ser flexible si se cancela. El descuento del cupo aplica al servicio que
  se elija. La duración de la cita la define el turno ("una cita cada 45 min"), no
  cada servicio.
- **Qué se regenera y qué no** (`CupoSchedule.plan`): solo se crean/quitan cupos
  *libres que salieron del horario*. Una cita reservada o un cupo publicado a mano
  nunca se tocan — solo ocupan su lugar para que no se les encime otro. Un cupo del
  horario quitado a mano no regresa (`schedule.skips`). Cambiar el horario respeta
  las citas existentes.
- **Se publican 4 semanas hacia adelante y quien las publica es el propio negocio**
  al abrir su panel (y al guardar horario/cerrar día). En Supabase solo el dueño
  puede insertar sus cupos (RLS), así que no hay un proceso de servidor: si un
  negocio pasa más de ~3 semanas sin entrar, se le acaban los cupos publicados (ver
  "Pendiente").
- **El cliente ya no ve ni puede reservar cupos que ya empezaron** (antes un cupo de
  las 3 pm seguía "disponible" a las 5). Para que la demo en localStorage no se
  quede vacía por eso, los 48 negocios de ejemplo reponen unos cuantos cupos de
  demostración cuando ya no les queda ninguno por delante (`refreshOnLoad` en
  `js/store.js`) — antes solo tenían cupos el primer día que se abría la demo.
- **Cancelar una cita desde el negocio** ahora marca la venta como cancelada y le
  quita la reserva al cliente también en localStorage (antes solo lo hacía Supabase).

**Datos:** `business.schedule = { rules, closures, skips }`, `staff.services`,
y en cada cupo `scheduleKey` (de qué turno/día/hora salió), `flexible` y
`walkinName` (agendado a mano). En Supabase: columnas `businesses.schedule`,
`staff.services`, `slots.schedule_key`/`flexible`/`walkin_name` (con índice único
por negocio + llave, para no publicar dos veces el mismo cupo), y funciones
`slot_service_price` (servicio y precio de un cupo flexible, mismo redondeo que el
navegador), `book_slot` (ahora recibe el servicio y rechaza cupos que ya
empezaron), `book_slot_manual`, y `cancel_reservation`/`reopen_slot` actualizadas.

**Acción pendiente tuya:** corre `db/migracion-horario-semanal.sql` completo una vez
en el SQL Editor de Supabase (es idempotente y no borra nada). Mientras no se corra,
el sitio sigue funcionando como antes: `supabase-store.js` detecta solo que faltan
las columnas (`scheduleSupported`) y lo nuevo avisa qué paso falta en vez de fallar.

**De paso:** `BUSINESS_SELECT` pedía las reseñas con una lista fija de columnas que
no incluía `photo_url`, así que en el sitio real las fotos de reseñas se guardaban
pero nunca se veían. Ahora pide `reviews(*)`/`staff(*)`.

**Cómo se probó** (todo pasa):
- Lógica del horario: pruebas unitarias en Node (encimes, cierres, cupos quitados,
  cambio de turno con citas existentes, limpieza de lo ya pasado).
- Playwright manejando la interfaz real, 88 verificaciones: catálogo y personal,
  editor de horario, calendario, descuento, agendar a mano, cancelar, quitar cupos,
  cerrar/reabrir (día, persona, rango), panel del cliente eligiendo servicio,
  filtros, y el paso del tiempo.
- El mismo recorrido contra un **Postgres 16 local** con el esquema de hoy + la
  migración, usando el `supabase-js` y el `supabase-store.js` reales, con RLS y las
  funciones corriendo de verdad. Lo único simulado ahí es la capa REST (un
  sustituto propio de PostgREST, porque el entorno no dejó descargar el real) y el
  login.
- SQL directo con el rol y JWT de cada usuario: reglas de `book_slot`/
  `book_slot_manual`, que un negocio no puede tocar lo de otro, y que el precio con
  descuento coincide entre navegador y base en ~7,000 combinaciones.
- El código nuevo sobre el esquema SIN migrar: todo lo anterior sigue funcionando.
- Contra el Supabase real, solo lectura y sin sesión: su API acepta las consultas
  nuevas (`staff(*)`, `reviews(*)`, cupos filtrados por rango de fechas).
- **No se probó** escribir contra el Supabase real (necesita la migración corrida).

## Pendiente / decisiones abiertas

**Del backlog ágil, lo que falta y necesita una acción tuya (cuenta/servicio externo
que no se puede crear desde aquí) — pendiente a propósito para hacerlo juntos:**

- **Correr `db/migracion-horario-semanal.sql` en Supabase** para activar el horario
  semanal en el sitio real — ver "Horario semanal y calendario" arriba. Después
  conviene una pasada en vivo (guardar un horario, reservar un cupo flexible,
  agendar a mano, cerrar un día): es lo único de esa función sin probar contra el
  proyecto real.
- **Horario semanal sin depender de que el negocio entre:** hoy los cupos se
  publican cuando el negocio abre su panel. Para que se renueven solos aunque no
  entre en semanas hace falta un proceso del lado del servidor (ej. `pg_cron` en
  Supabase, que se activa desde su dashboard).
- La **demo de Artifact** (un solo archivo, ver "Enlaces") no incluye el horario
  semanal ni el calendario: es una copia aparte que no se regenera sola.

- **HU-08 — Pago dentro de la app:** hoy el cliente reserva gratis y paga en el
  negocio (política de cancelación de HU-13). Cobrar en línea necesita elegir y
  conectar un procesador de pagos real (Stripe, Conekta, Mercado Pago...), lo cual
  requiere una cuenta tuya con datos fiscales/bancarios.
- **HU-11 completa — notificaciones push reales:** lo construido (ver arriba) es un
  aviso local dentro de la sesión del navegador; un push real que llegue aunque la
  app esté cerrada necesita una cuenta de servicio de push (Firebase Cloud Messaging,
  OneSignal, Web Push...).
- ~~Fotos por subida de archivo real~~ — **ya se puede subir el archivo directo**
  desde el panel, tanto el negocio (foto de perfil) como el cliente (foto en su
  reseña) — ver "Subida real de fotos (Supabase Storage)" arriba.
- ~~Dominio propio~~ — **ya se compró `mycupo.com`** y ya se agregó el `CNAME` del
  lado del repo; falta que apuntes el DNS del registrador — ver "Dominio propio:
  mycupo.com" arriba para los registros exactos y los pasos que faltan de tu lado.
- ~~Supabase está preparado pero no conectado~~ — **ya está conectado**, con
  credenciales reales en `js/supabase-config.js` y dos cuentas demo con historial
  cargado para presentaciones (`demo.negocio@cupo.mx` / `demo.cliente@cupo.mx`,
  contraseña `cupo1234` — ver "Base de datos: Supabase" arriba). Se probó en vivo el
  flujo completo de registro/reserva/cancelación con Playwright contra el proyecto
  real. Lo que falta por confirmar en vivo todavía son las tablas más nuevas
  (`sales`/`staff`/`reviews`/`favorites` y sus políticas RLS) con reservas reales de
  clientes distintos a las cuentas demo.
- `SupabaseStore.seedDemoBusinesses()` copia los cupos de hoy y el catálogo de
  servicios de los 48 negocios de ejemplo, pero no replica su historial de ventas de
  demostración — en Supabase el dashboard de Ventas arranca vacío hasta que entren
  reservas reales.
- Se consideró un campo de "usuario" (@alias) en el registro de cliente, pero no se
  agregó porque no estaba decidido si sería solo otra forma de iniciar sesión o un
  alias público. El correo sigue siendo el identificador único por ahora.
- Estructura de costos y métricas clave del Lean Canvas son hipótesis de arranque, no
  validadas con negocios reales todavía.
- Modelo de cobro al negocio (comisión por reserva / suscripción / freemium) sin decidir.
- **Logo:** se exploraron varias opciones (ver conversación) pero nunca se eligió una —
  sigue el círculo índigo con "C" por default. Puedo diseñarlo, pero elegir cuál es
  decisión tuya.
- **Analítica del sitio:** para saber cuánta gente entra una vez que `mycupo.com` esté
  público, falta elegir/crear cuenta en un servicio (ej. Plausible, Simple Analytics,
  Google Analytics) — cuál usar y la cuenta son tuyos.
