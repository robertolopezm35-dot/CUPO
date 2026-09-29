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
- `css/styles.css` — estilos compartidos (paleta índigo del pitch deck)
- `js/store.js` — `CupoStore`: la "base de datos" en localStorage, datos semilla, y
  lógica de registro/reservas/áreas/categorías/países. Sigue siendo el modo por defecto.
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

## Enlaces

- **Repo / rama de trabajo:** `feature/cupo-web-app` en
  https://github.com/robertolopezm35-dot/CUPO
- **Demo interactiva (Artifact, un solo archivo, mismo diseño y lógica):**
  https://claude.ai/artifact/Tye5bmxEpK3d9RZjsMNZd7
- **Lean Canvas del proyecto (Artifact):**
  https://claude.ai/artifact/5FiGjj5526zhACDbA8KKGT

## Pendiente / decisiones abiertas

- Supabase está preparado pero no conectado — falta que alguien cree el proyecto y
  pegue las credenciales (ver "Base de datos: Supabase" arriba). Hasta entonces sigue
  en `localStorage`.
- El flujo de Supabase no se ha probado contra un proyecto real todavía — probarlo
  completo (registro, reserva, cancelación, RLS) en cuanto se conecte.
- Se consideró un campo de "usuario" (@alias) en el registro de cliente, pero no se
  agregó porque no estaba decidido si sería solo otra forma de iniciar sesión o un
  alias público. El correo sigue siendo el identificador único por ahora.
- Estructura de costos y métricas clave del Lean Canvas son hipótesis de arranque, no
  validadas con negocios reales todavía.
- Modelo de cobro al negocio (comisión por reserva / suscripción / freemium) sin decidir.
