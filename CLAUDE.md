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

Prototipo estático (HTML/CSS/JS puro, sin backend). Todo el "guardado de datos" vive en
`localStorage` del navegador — no hay base de datos real todavía. Eso es lo siguiente
por construir cuando se decida el stack de backend.

### Archivos

- `index.html` — landing page
- `auth.html` + `js/auth.js` — login/registro con selector de rol **Cliente / Negocio**
- `cliente.html` + `js/cliente.js` — panel del cliente: busca y reserva cupos
- `negocio.html` + `js/negocio.js` — panel del negocio: publica/gestiona su agenda
- `css/styles.css` — estilos compartidos (paleta índigo del pitch deck)
- `js/store.js` — toda la "base de datos" (localStorage), datos semilla, y lógica de
  registro/reservas/áreas/categorías/países. Es el único archivo que habría que
  reemplazar por llamadas a una API real cuando haya backend.

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

## Enlaces

- **Repo / rama de trabajo:** `feature/cupo-web-app` en
  https://github.com/robertolopezm35-dot/CUPO
- **Demo interactiva (Artifact, un solo archivo, mismo diseño y lógica):**
  https://claude.ai/artifact/Tye5bmxEpK3d9RZjsMNZd7
- **Lean Canvas del proyecto (Artifact):**
  https://claude.ai/artifact/5FiGjj5526zhACDbA8KKGT

## Pendiente / decisiones abiertas

- No hay backend ni base de datos real — todo vive en `localStorage`.
- Se consideró un campo de "usuario" (@alias) en el registro de cliente, pero no se
  agregó porque no estaba decidido si sería solo otra forma de iniciar sesión o un
  alias público. El correo sigue siendo el identificador único por ahora.
- Estructura de costos y métricas clave del Lean Canvas son hipótesis de arranque, no
  validadas con negocios reales todavía.
- Modelo de cobro al negocio (comisión por reserva / suscripción / freemium) sin decidir.
