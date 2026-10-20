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
- `auth.html` + `js/auth.js` — login/registro con selector de rol **Cliente / Negocio**
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
- `js/data-adapter.js` — define `DataStore`, que apunta a `SupabaseStore` si
  `supabase-config.js` tiene credenciales, o a `CupoStore` si no. `auth.js`,
  `cliente.js` y `negocio.js` solo hablan con `DataStore`, nunca directo con
  `CupoStore`/`SupabaseStore` — por eso cambiar de backend no toca esos tres archivos.
- `db/schema.sql` — el esquema completo de Postgres para Supabase (tablas, RLS,
  triggers, funciones RPC). Se corre una sola vez en el SQL Editor de Supabase.

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
6. Opcional: para tener los mismos 30 negocios de ejemplo de Monterrey en la base real
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
- **Datos semilla:** 30 negocios reales de Monterrey (5 por subcategoría de Estética),
  investigados por web search — nombres y zonas reales, pero horarios/precios/logins
  (`nombre@cupo.mx` / `1234`) son datos de demo, no contacto real de esos negocios.
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
  vacío, los 30 negocios semilla traen ~20-35 ventas de demostración de los últimos 30
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
  el cliente las ve en la tarjeta. No se fabricaron fotos ni catálogos para los 30
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

## Enlaces

- **Repo / rama de trabajo:** `feature/cupo-web-app` en
  https://github.com/robertolopezm35-dot/CUPO
- **Demo interactiva (Artifact, un solo archivo, mismo diseño y lógica):**
  https://claude.ai/artifact/Tye5bmxEpK3d9RZjsMNZd7
- **Lean Canvas del proyecto (Artifact):**
  https://claude.ai/artifact/5FiGjj5526zhACDbA8KKGT

## Pendiente / decisiones abiertas

**Del backlog ágil, lo que falta y necesita una acción tuya (cuenta/servicio externo
que no se puede crear desde aquí) — pendiente a propósito para hacerlo juntos:**

- **HU-08 — Pago dentro de la app:** hoy el cliente reserva gratis y paga en el
  negocio (política de cancelación de HU-13). Cobrar en línea necesita elegir y
  conectar un procesador de pagos real (Stripe, Conekta, Mercado Pago...), lo cual
  requiere una cuenta tuya con datos fiscales/bancarios.
- **HU-11 completa — notificaciones push reales:** lo construido (ver arriba) es un
  aviso local dentro de la sesión del navegador; un push real que llegue aunque la
  app esté cerrada necesita una cuenta de servicio de push (Firebase Cloud Messaging,
  OneSignal, Web Push...).
- **Fotos por subida de archivo real:** hoy el negocio pega una URL externa. Subir el
  archivo directo desde el panel necesita Supabase Storage conectado (depende de que
  actives Supabase — ver abajo).
- Supabase está preparado pero no conectado — falta que alguien cree el proyecto y
  pegue las credenciales (ver "Base de datos: Supabase" arriba). Hasta entonces sigue
  en `localStorage`.
- El flujo de Supabase no se ha probado contra un proyecto real todavía — probarlo
  completo (registro, reserva, cancelación, RLS) en cuanto se conecte. Esto incluye
  las tablas nuevas `sales`/`staff`/`reviews`/`favorites` y sus políticas RLS (ver
  "Backlog ágil" y "Dashboard de Ventas" arriba) — sí se probó a fondo en modo
  localStorage con Playwright, pero no contra Postgres real.
- `SupabaseStore.seedDemoBusinesses()` copia los cupos de hoy y el catálogo de
  servicios de los 30 negocios de ejemplo, pero no replica su historial de ventas de
  demostración — en Supabase el dashboard de Ventas arranca vacío hasta que entren
  reservas reales.
- Se consideró un campo de "usuario" (@alias) en el registro de cliente, pero no se
  agregó porque no estaba decidido si sería solo otra forma de iniciar sesión o un
  alias público. El correo sigue siendo el identificador único por ahora.
- Estructura de costos y métricas clave del Lean Canvas son hipótesis de arranque, no
  validadas con negocios reales todavía.
- Modelo de cobro al negocio (comisión por reserva / suscripción / freemium) sin decidir.
