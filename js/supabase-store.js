// Reemplazo de store.js respaldado por Supabase (Postgres real) en vez de
// localStorage. Implementa las mismas funciones que CupoStore, pero async
// (todas regresan una Promise), porque hablan con una base de datos real
// por red en vez de leer el navegador.
//
// No se activa solo: js/data-adapter.js decide si se usa esto o
// CupoStore según si js/supabase-config.js tiene URL/anonKey llenos.
//
// Requiere el script de Supabase cargado antes que este archivo:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>

const SupabaseStore = (() => {
  const cfg = window.SUPABASE_CONFIG || {};
  const isConfigured = !!(cfg.url && cfg.anonKey);

  // El cliente real se crea hasta el primer uso, no apenas se carga este
  // script: si el <script> del CDN de supabase-js tarda en responder (una
  // red lenta, un CDN congestionado), este archivo puede terminar de
  // ejecutarse antes de que exista window.supabase, y el cliente se
  // quedaría atorado en null para siempre en esa página. El Proxy difiere
  // esa creación hasta que de verdad se llama algo (ej. client.auth,
  // client.from(...)), momento en el que la página ya lleva rato cargada
  // y window.supabase ya existe — sin tener que tocar cada llamada.
  let realClient = null;
  function resolveClient() {
    if (!realClient && isConfigured && window.supabase) {
      // detectSessionInUrl solo en reset-password.html (el link del correo trae ahí la sesión
      // de recuperación). En las demás páginas se apaga: si no, un link con tokens en el hash
      // (cliente.html#access_token=…) le metería a alguien la sesión de otra persona.
      const wantsUrlSession = /reset-password\.html$/.test(window.location.pathname);
      realClient = window.supabase.createClient(cfg.url, cfg.anonKey, { auth: { detectSessionInUrl: wantsUrlSession } });
    }
    return realClient;
  }
  const client = isConfigured
    ? new Proxy({}, {
        get(_target, prop) {
          const c = resolveClient();
          if (!c) return undefined;
          const value = c[prop];
          return typeof value === "function" ? value.bind(c) : value;
        },
      })
    : null;

  function labelFor(date) {
    const h = date.getHours();
    const m = date.getMinutes();
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const ampm = h >= 12 ? "PM" : "AM";
    return displayH + ":" + String(m).padStart(2, "0") + " " + ampm;
  }

  function mapSlot(row) {
    const date = new Date(row.starts_at);
    const reservation = Array.isArray(row.reservations) ? row.reservations[0] : row.reservations;
    const client = reservation && reservation.clients;
    const walkin = (reservation && reservation.walkin_name) || row.walkin_name || null;
    return {
      id: row.id,
      time: date.getTime(),
      createdAt: row.created_at ? new Date(row.created_at).getTime() : 0,
      label: labelFor(date),
      duration: row.duration_minutes,
      price: Number(row.price),
      originalPrice: row.original_price != null ? Number(row.original_price) : null,
      discountPct: row.discount_pct || 0,
      service: row.service || null,
      staffId: row.staff_id || null,
      staffName: row.staff ? row.staff.name : null,
      status: row.status,
      reservationId: reservation ? reservation.id : null,
      folio: reservation ? reservation.folio || null : null,
      clientId: reservation ? reservation.client_id : null,
      // Agendado a mano por el negocio: el nombre vive en la reserva (solo la
      // ve el negocio dueño). row.walkin_name cubre una base que aún tiene la
      // columna vieja en slots (antes de correr la migración actualizada).
      clientName: client ? client.first_name + " " + client.last_name : walkin || null,
      walkinName: walkin || null,
      scheduleKey: row.schedule_key || null,
      flexible: !!row.flexible,
    };
  }

  function mapSale(row) {
    return {
      id: row.id,
      // date = cuándo se reservó; startsAt = la hora de la cita (el dashboard
      // de Ventas agrupa por esta). En una base sin migrar no existe: Ventas
      // la recupera de la hora del cupo (ver ventas.js, whenOf).
      date: new Date(row.created_at).getTime(),
      startsAt: row.starts_at ? new Date(row.starts_at).getTime() : null,
      duration: row.duration_minutes || null,
      attendance: row.attendance || "pendiente",
      clientPhone: row.client_phone || null,
      clientCountry: row.client_country || null,
      service: row.service,
      price: Number(row.price),
      originalPrice: row.original_price != null ? Number(row.original_price) : null,
      discountPct: row.discount_pct || 0,
      staffName: row.staff_name || null,
      clientName: row.client_name,
      clientId: row.client_id || null,
      businessId: row.business_id,
      slotId: row.slot_id,
      folio: row.folio || null,
      status: row.status,
    };
  }

  function mapReview(row) {
    return {
      id: row.id,
      clientId: row.client_id,
      clientName: row.client_name || "Cliente",
      rating: row.rating,
      comment: row.comment || "",
      photoUrl: row.photo_url || null,
      date: new Date(row.created_at).getTime(),
    };
  }

  // El horario semanal necesita columnas que una base conectada antes de
  // esta función todavía no tiene (db/migracion-horario-semanal.sql). Se
  // detecta sola al leer cualquier negocio: mientras falten, todo lo demás
  // sigue funcionando igual y lo nuevo avisa qué paso falta en vez de fallar
  // con un error críptico de Postgres.
  let scheduleSupported = false;
  let scheduleKnown = false;
  // Lo mismo para db/migracion-ventas-agenda.sql (teléfono y política de cancelación).
  let agendaSupported = false;
  const MIGRATION_MSG = "Falta un paso en Supabase para activar esta función: corre db/migracion-horario-semanal.sql en el SQL Editor.";
  const AGENDA_MSG = "Falta un paso en Supabase para activar esta función: corre db/migracion-ventas-agenda.sql en el SQL Editor.";
  // Solo cuando el error es de verdad "falta algo de la migración" se manda a
  // correrla: un 42703 sobre OTRA columna (ej. sales.original_price) es otro
  // problema y mandar a correr el mismo archivo despistaría.
  // Traduce los errores "crudos" de red/sesión a algo que una persona entienda.
  function plainMessage(text) {
    if (/Failed to fetch|NetworkError|Load failed|fetch failed|network request failed/i.test(text)) {
      return "No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.";
    }
    if (/JWT expired|invalid JWT|JWT/i.test(text)) return "Tu sesión caducó. Vuelve a iniciar sesión para continuar.";
    if (/Unexpected (end|token)|JSON/i.test(text)) return "La respuesta del servidor llegó incompleta. Intenta de nuevo.";
    if (/^\s*<(!doctype|html)/i.test(text)) return "El servidor respondió algo inesperado. Intenta de nuevo en un momento.";
    return text;
  }

  // Errores de Supabase Auth (registro, login, recuperar contraseña) en español.
  function authError(error, duplicateMessage) {
    const text = String((error && error.message) || "");
    if (/already registered|already been registered/i.test(text)) return duplicateMessage || "Ya existe una cuenta con ese correo.";
    const pw = /at least (\d+) characters/i.exec(text);
    if (pw) return "La contraseña debe tener al menos " + pw[1] + " caracteres.";
    if (/should be different from the old/i.test(text)) return "La contraseña nueva debe ser distinta de la anterior.";
    if (/Invalid login credentials/i.test(text)) return "Correo o contraseña incorrectos.";
    if (/rate limit|too many|seconds/i.test(text) && (error.status === 429 || /rate limit|too many/i.test(text))) return "Demasiados intentos. Espera unos minutos e intenta de nuevo.";
    if (/valid email|invalid email|email address .* is invalid/i.test(text)) return "Escribe un correo válido.";
    if (/Database error saving new user/i.test(text)) return "No pudimos crear tu cuenta. Revisa que tus datos no estén vacíos ni sean demasiado largos.";
    return plainMessage(text);
  }

  // ¿El error de .single() significa "no existe" (0 filas) y no "falló"?
  function isNotFound(error) {
    return !!error && (error.code === "PGRST116" || /0 rows|no rows/i.test(String(error.details || "") + String(error.message || "")));
  }

  function friendly(error) {
    const text = String(error.message || "");
    if (["PGRST202", "42883"].includes(error.code) && /set_attendance|p_phone/.test(text)) return AGENDA_MSG;
    if (["42703", "PGRST204"].includes(error.code) && /attendance|client_phone|client_country|cancel_hours|phone/.test(text)) return AGENDA_MSG;
    const missing = error.code === "PGRST202"
      || (["42703", "PGRST204"].includes(error.code) && /schedule|flexible|walkin|services/.test(text));
    return missing ? MIGRATION_MSG : plainMessage(text);
  }

  async function ensureScheduleSupport() {
    if (scheduleKnown) return scheduleSupported;
    const { data } = await client.from("businesses").select("*").limit(1);
    if (data && data.length) {
      scheduleSupported = data[0].schedule !== undefined;
      agendaSupported = data[0].cancel_hours !== undefined;
      scheduleKnown = true;
    }
    return scheduleSupported;
  }

  function mapBusiness(row, mySales) {
    scheduleSupported = row.schedule !== undefined;
    agendaSupported = row.cancel_hours !== undefined;
    scheduleKnown = true;
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      rating: Number(row.rating),
      photos: CupoValidate.safePhotos(row.photos),
      phone: row.phone || null,
      cancelHours: row.cancel_hours != null ? row.cancel_hours : 1,
      servicesCatalog: CupoValidate.safeCatalog(row.services_catalog),
      staff: (row.staff || [])
        .slice()
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || a.name.localeCompare(b.name))
        .map((s) => ({ id: s.id, name: s.name, services: Array.isArray(s.services) ? s.services : [] })),
      schedule: CupoSchedule.normalize(row.schedule),
      scheduleSupported,
      reviews: (row.reviews || []).map(mapReview).sort((a, b) => b.date - a.date),
      // Nunca las ventas de otros clientes — solo las propias del que
      // consulta (o ninguna, si quien consulta es el propio negocio o no
      // hay sesión). Ver has_reservation_at/get_my_sales en schema.sql.
      sales: (mySales || []).filter((s) => s.businessId === row.id),
      slots: (row.slots || []).map(mapSlot).sort((a, b) => a.time - b.time),
    };
  }

  // Con * (y no una lista de columnas) a propósito: así una columna que se
  // agrega después (reviews.photo_url, staff.services, slots.schedule_key...)
  // llega sola en cuanto existe, y pedirla antes de que exista no truena la
  // consulta completa.
  const BUSINESS_SELECT = `
    *,
    staff(*),
    reviews(*),
    slots(*, staff(name), reservations(*, clients(first_name, last_name)))
  `;

  async function getMySales() {
    const { data, error } = await client.rpc("get_my_sales");
    if (error) return [];
    return (data || []).map(mapSale);
  }

  async function getSession() {
    if (!client) return null;
    const { data: { session } } = await client.auth.getSession();
    if (!session) return null;
    const { data: profile, error } = await client
      .from("profiles")
      .select("role")
      .eq("id", session.user.id)
      .single();
    if (error) {
      if (isNotFound(error)) return null;
      throw error; // un fallo de red NO significa "no hay sesión"
    }
    if (!profile) return null;
    return { role: profile.role, id: session.user.id };
  }

  function setSession() {
    // No-op: Supabase Auth ya guarda la sesión por su cuenta al hacer
    // signUp/signInWithPassword. Existe solo para que auth.js pueda
    // llamar DataStore.setSession(...) igual con los dos backends.
  }

  async function clearSession() {
    if (!client) return;
    await client.auth.signOut();
  }

  async function login(role, email, password) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: authError(error) };
    const { data: profile } = await client.from("profiles").select("role").eq("id", data.user.id).single();
    if (!profile || profile.role !== role) {
      await client.auth.signOut();
      return { ok: false, error: "Esa cuenta no es de " + role + "." };
    }
    return { ok: true, id: data.user.id };
  }

  // Manda el correo de "recuperar contraseña" de Supabase (vía el SMTP que
  // ya está configurado — ver CLAUDE.md). redirectTo apunta a
  // reset-password.html junto a esta página, para que funcione sin importar
  // en qué subcarpeta esté publicado el sitio (GitHub Pages, etc.).
  async function requestPasswordReset(email) {
    const redirectTo = new URL("reset-password.html", window.location.href).toString();
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) return { ok: false, error: authError(error) };
    return { ok: true };
  }

  // Se usa desde reset-password.html, con la sesión temporal de recuperación
  // que Supabase arma solo al abrir el link del correo (ver supabase-js
  // detectSessionInUrl).
  async function updatePassword(newPassword) {
    const { error } = await client.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: authError(error) };
    return { ok: true };
  }

  async function registerClient({ firstName, lastName, email, password, countryCode, phone }) {
    if (!/^\d{10}$/.test(phone)) {
      return { ok: false, error: "El teléfono debe tener 10 dígitos." };
    }
    const names = CupoValidate.personName(firstName, lastName);
    if (!names.ok) return names;
    firstName = names.first;
    lastName = names.last;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          role: "cliente",
          first_name: firstName,
          last_name: lastName,
          country_code: countryCode,
          phone,
        },
      },
    });
    if (error) return { ok: false, error: authError(error, "Ya existe una cuenta con ese correo.") };
    if (!data.session) {
      return { ok: false, error: "Cuenta creada. Revisa tu correo para confirmar antes de entrar (o apaga \"Confirm email\" en Supabase para pruebas)." };
    }
    return { ok: true, client: { id: data.user.id, name: firstName + " " + lastName } };
  }

  async function registerBusiness({ name, category, address, email, password }) {
    const text = CupoValidate.businessText(name, address);
    if (!text.ok) return text;
    name = text.name;
    address = text.address;
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { role: "negocio", name, category, address },
      },
    });
    if (error) return { ok: false, error: authError(error, "Ya existe un negocio registrado con ese correo.") };
    if (!data.session) {
      return { ok: false, error: "Cuenta creada. Revisa tu correo para confirmar antes de entrar (o apaga \"Confirm email\" en Supabase para pruebas)." };
    }
    return { ok: true, business: { id: data.user.id, name } };
  }

  // slotsFrom/slotsTo (timestamps, opcionales): trae solo los cupos de ese
  // rango. El panel del cliente nada más enseña los próximos 7 días, y con
  // horarios semanales cada negocio puede tener cientos de cupos publicados.
  async function getBusinesses({ slotsFrom, slotsTo } = {}) {
    let query = client.from("businesses").select(BUSINESS_SELECT);
    if (slotsFrom) query = query.gte("slots.starts_at", new Date(slotsFrom).toISOString());
    if (slotsTo) query = query.lt("slots.starts_at", new Date(slotsTo).toISOString());
    const [{ data, error }, mySales] = await Promise.all([
      query,
      getMySales(),
    ]);
    if (error) throw error;
    return (data || []).map((row) => mapBusiness(row, mySales));
  }

  // Regresa null SOLO si el negocio no existe; si la consulta falla (red, 500, sesión…) lanza
  // el error: así quien llama no confunde "no pude leerlo" con "no existe" (y no cierra la
  // sesión por un parpadeo de red). slotsFrom/slotsTo acotan los cupos que se descargan.
  async function getBusinessById(id, { slotsFrom, slotsTo } = {}) {
    let query = client.from("businesses").select(BUSINESS_SELECT).eq("id", id);
    if (slotsFrom) query = query.gte("slots.starts_at", new Date(slotsFrom).toISOString());
    if (slotsTo) query = query.lt("slots.starts_at", new Date(slotsTo).toISOString());
    const [{ data, error }, mySales] = await Promise.all([query.single(), getMySales()]);
    if (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
    if (!data) return null;
    return mapBusiness(data, mySales);
  }

  async function getClientById(id) {
    const { data, error } = await client
      .from("clients")
      .select(`
        *,
        favorites(business_id),
        reservations(id, slot_id, folio, slots(starts_at, price, duration_minutes, service, staff_id, staff(name), businesses(id, name, address)))
      `)
      .eq("id", id)
      .single();
    if (error) {
      if (isNotFound(error)) return null;
      throw error; // falló la consulta: no es lo mismo que "esta cuenta no existe"
    }
    if (!data) return null;
    return {
      id: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      name: data.first_name + " " + data.last_name,
      favoriteBusinessIds: (data.favorites || []).map((f) => f.business_id),
      lastFavoritesCheck: data.last_favorites_check ? new Date(data.last_favorites_check).getTime() : 0,
      reservations: (data.reservations || []).map((r) => ({
        reservationId: r.id,
        businessId: r.slots.businesses.id,
        businessName: r.slots.businesses.name,
        slotId: r.slot_id,
        label: labelFor(new Date(r.slots.starts_at)),
        time: new Date(r.slots.starts_at).getTime(),
        address: r.slots.businesses.address || "",
        price: Number(r.slots.price),
        service: r.slots.service || null,
        staffName: r.slots.staff ? r.slots.staff.name : null,
        duration: r.slots.duration_minutes,
        folio: r.folio || null,
      })),
    };
  }

  // Llama una función de la base con un parámetro opcional que quizá todavía no exista
  // (db/migracion-endurecimiento.sql): si la base responde que no lo conoce, reintenta sin él.
  async function rpcOptional(name, args, optionalKey) {
    let result = await client.rpc(name, args);
    const missing = result.error && ["PGRST202", "42883"].includes(result.error.code)
      && String(result.error.message || "").includes(optionalKey);
    if (missing && optionalKey in args) {
      const rest = { ...args };
      delete rest[optionalKey];
      result = await client.rpc(name, rest);
    }
    return result;
  }

  // expectedPrice: el precio que el cliente vio en pantalla. Si el negocio lo cambió mientras
  // decidía, la base rechaza la reserva y se le pide confirmar de nuevo.
  async function bookSlot(businessId, slotId, _client, { service, expectedPrice } = {}) {
    const args = { p_slot_id: slotId };
    // Solo los cupos flexibles mandan servicio: así una base que aún no
    // corre la migración (book_slot de un solo parámetro) sigue reservando.
    if (service) args.p_service = service;
    if (Number.isFinite(Number(expectedPrice)) && expectedPrice !== null && expectedPrice !== undefined) args.p_expected_price = Number(expectedPrice);
    const { data, error } = await rpcOptional("book_slot", args, "p_expected_price");
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true, folio: data ? data.folio : null };
  }

  async function bookSlotManual(businessId, slotId, { clientName, service, phone } = {}) {
    const args = {
      p_slot_id: slotId,
      p_client_name: clientName || "",
      p_service: service || null,
    };
    // Solo si lo mandan: una base sin migrar no conoce p_phone.
    const ph = CupoValidate.phone(phone);
    if (!ph.ok) return ph;
    if (ph.phone) args.p_phone = ph.phone;
    const { data, error } = await client.rpc("book_slot_manual", args);
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true, folio: data || null };
  }

  const PAST_MSG = "Esa hora ya pasó. Elige una hora que todavía no empiece.";
  const CONFLICT_MSG = "Ya hay un cupo o una cita en ese horario para esa persona. Elige otra hora.";

  // ¿Se encima el horario con otro cupo del mismo negocio y persona ese día?
  async function slotConflictOnDay(businessId, startMs, durationMin, staffId, ignoreId) {
    const dayStart = new Date(startMs);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const { data } = await client
      .from("slots")
      .select("id, starts_at, duration_minutes, staff_id")
      .eq("business_id", businessId)
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString());
    const rows = (data || []).map((r) => ({ id: r.id, time: new Date(r.starts_at).getTime(), duration: r.duration_minutes, staffId: r.staff_id }));
    return CupoValidate.slotConflict(rows, startMs, durationMin, staffId, ignoreId);
  }

  async function addSlot(businessId, { hour, minute, duration, price, service, dayOffset, discountPct, staffId, flexible }) {
    await ensureScheduleSupport();
    const input = CupoValidate.slotInput({ duration, price, discountPct, flexible });
    if (!input.ok) return input;
    const offset = parseInt(dayOffset, 10) || 0;
    const startsAt = new Date(Date.now() + offset * 86400000);
    startsAt.setHours(parseInt(hour, 10), parseInt(minute, 10) || 0, 0, 0);
    if (!(startsAt.getTime() > Date.now())) return { ok: false, error: PAST_MSG };
    if (await slotConflictOnDay(businessId, startsAt.getTime(), input.duration, staffId || null, null)) return { ok: false, error: CONFLICT_MSG };
    const basePrice = input.price;
    const pct = input.pct;
    const finalPrice = pct > 0 ? CupoSchedule.applyDiscount(basePrice, pct) : basePrice;
    const row = {
      business_id: businessId,
      starts_at: startsAt.toISOString(),
      duration_minutes: input.duration,
      price: finalPrice,
      original_price: pct > 0 ? basePrice : null,
      discount_pct: pct,
      service: service || null,
      staff_id: staffId || null,
    };
    if (scheduleSupported) Object.assign(row, flexibleFields(flexible, finalPrice));
    const { error } = await client.from("slots").insert(row);
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  // Un cupo flexible no guarda servicio ni precio original: el precio que
  // queda en la fila es solo el "desde" ya con el descuento del cupo (lo
  // calcula quien llama, que ya tiene el catálogo cargado); el real se fija
  // en book_slot al reservar.
  function flexibleFields(flexible, fromPrice) {
    return flexible
      ? { flexible: true, service: null, original_price: null, price: fromPrice }
      : { flexible: false };
  }

  async function updateSlot(businessId, slotId, { hour, minute, duration, price, service, dayOffset, discountPct, staffId, flexible }) {
    await ensureScheduleSupport();
    const input = CupoValidate.slotInput({ duration, price, discountPct, flexible });
    if (!input.ok) return input;
    const offset = parseInt(dayOffset, 10) || 0;
    const startsAt = new Date(Date.now() + offset * 86400000);
    startsAt.setHours(parseInt(hour, 10), parseInt(minute, 10) || 0, 0, 0);
    if (!(startsAt.getTime() > Date.now())) return { ok: false, error: PAST_MSG };
    if (await slotConflictOnDay(businessId, startsAt.getTime(), input.duration, staffId || null, slotId)) return { ok: false, error: CONFLICT_MSG };
    const basePrice = input.price;
    const pct = input.pct;
    const finalPrice = pct > 0 ? CupoSchedule.applyDiscount(basePrice, pct) : basePrice;
    const patch = {
      starts_at: startsAt.toISOString(),
      duration_minutes: input.duration,
      price: finalPrice,
      original_price: pct > 0 ? basePrice : null,
      discount_pct: pct,
      service: service || null,
      staff_id: staffId || null,
    };
    if (scheduleSupported) Object.assign(patch, flexibleFields(flexible, finalPrice));
    const { data, error } = await client
      .from("slots")
      .update(patch)
      .eq("id", slotId)
      .eq("status", "available")
      .select();
    if (error) return { ok: false, error: friendly(error) };
    if (!data || !data.length) return { ok: false, error: "No puedes editar un cupo ya reservado. Reábrelo primero." };
    return { ok: true };
  }

  // El servidor corta cada consulta en 1,000 filas: se pide por páginas hasta traerlo todo
  // (un negocio con más de 1,000 ventas veía totales y CSV incompletos sin enterarse).
  // since: solo ventas reservadas desde esa fecha (el panel de agenda no necesita todo el historial).
  async function getSales(businessId, { since } = {}) {
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; from < 100 * PAGE; from += PAGE) {
      let query = client.from("sales").select("*").eq("business_id", businessId);
      if (since) query = query.gte("created_at", new Date(since).toISOString());
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      rows.push(...(data || []));
      if (!data || data.length < PAGE) break;
    }
    return rows.map(mapSale);
  }

  async function setAttendance(businessId, saleId, attendance) {
    const { error } = await client.rpc("set_attendance", { p_sale_id: saleId, p_attendance: attendance });
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  // expectedFolio: el folio de la cita que el negocio veía al cancelar; si ya es otra (la
  // cancelaron y alguien más reservó ese cupo), la base lo rechaza en vez de cancelar la equivocada.
  async function reopenSlot(businessId, slotId, { expectedFolio } = {}) {
    const args = { p_slot_id: slotId };
    if (expectedFolio) args.p_expected_folio = expectedFolio;
    const { error } = await rpcOptional("reopen_slot", args, "p_expected_folio");
    if (error) return { ok: false, error: friendly(error) };
    if (await ensureScheduleSupport()) {
      // Si ese día ya está cerrado, el cupo liberado no debe quedar
      // reservable: se quita (igual que freeSlot en store.js).
      const [{ data: slot }, schedule] = await Promise.all([
        client.from("slots").select("*").eq("id", slotId).maybeSingle(),
        readSchedule(businessId),
      ]);
      if (slot && schedule && CupoSchedule.isClosed(schedule, CupoSchedule.dateKey(new Date(slot.starts_at).getTime()), slot.staff_id)) {
        await client.from("slots").delete().eq("id", slotId).eq("status", "available");
      }
    }
    return { ok: true };
  }

  async function removeSlot(businessId, slotId) {
    const { data: slot } = await client.from("slots").select("*").eq("id", slotId).maybeSingle();
    if (!slot) return { ok: false, error: "Ese cupo ya no existe. Actualiza la pantalla." };
    if (slot.status !== "available") {
      return { ok: false, error: "Ese cupo ya se reservó, así que no se puede quitar. Actualiza la pantalla (si quieres, cancela la cita)." };
    }
    const { data: deleted, error } = await client.from("slots").delete().eq("id", slotId).eq("status", "available").select();
    if (error) return { ok: false, error: friendly(error) };
    if (!deleted || !deleted.length) {
      return { ok: false, error: "Ese cupo se reservó justo ahora, no se quitó. Actualiza la pantalla." };
    }
    if (slot.schedule_key) {
      // Quitado a mano: se anota para que el horario no lo vuelva a publicar. (Solo después
      // de confirmar que de verdad se borró.)
      const result = await mutateSchedule(businessId, (schedule) => { schedule.skips.push(slot.schedule_key); });
      if (!result.ok) return result;
    }
    return { ok: true };
  }

  async function readSchedule(businessId) {
    const { data, error } = await client.from("businesses").select("*").eq("id", businessId).single();
    if (error || !data || data.schedule === undefined) return null;
    return CupoSchedule.normalize(data.schedule);
  }

  async function mutateSchedule(businessId, change) {
    const schedule = await readSchedule(businessId);
    if (!schedule) return { ok: false, error: MIGRATION_MSG };
    change(schedule);
    const { error } = await client
      .from("businesses")
      .update({ schedule: CupoSchedule.prune(schedule, Date.now()) })
      .eq("id", businessId);
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  async function saveSchedule(businessId, { rules, staffServices } = {}) {
    if (!(await ensureScheduleSupport())) return { ok: false, error: MIGRATION_MSG };
    const cleaned = CupoSchedule.normalize({ rules }).rules;
    if (cleaned.length !== (rules || []).length) {
      return { ok: false, error: "Revisa los turnos: hay alguno incompleto." };
    }
    const saved = await mutateSchedule(businessId, (schedule) => { schedule.rules = cleaned; });
    if (!saved.ok) return saved;
    for (const [staffId, services] of Object.entries(staffServices || {})) {
      if (!Array.isArray(services)) continue;
      const { error } = await client.from("staff").update({ services }).eq("id", staffId).eq("business_id", businessId);
      if (error) return { ok: false, error: friendly(error) };
    }
    return syncSchedule(businessId);
  }

  // Publica los cupos que falten del horario semanal (próximas 4 semanas) y
  // quita los que sobren. Solo lo puede hacer el propio negocio (RLS), así
  // que corre cada vez que abre su panel — ver CLAUDE.md "Horario semanal".
  async function syncSchedule(businessId) {
    if (!(await ensureScheduleSupport())) return { ok: true, created: 0, removed: 0 };
    const business = await getBusinessById(businessId);
    if (!business) return { ok: false, error: "Negocio no encontrado." };
    const { toCreate, toRemove } = CupoSchedule.plan(business, Date.now());

    for (let i = 0; i < toRemove.length; i += 80) {
      const { error } = await client.from("slots").delete().in("id", toRemove.slice(i, i + 80)).eq("status", "available");
      if (error) return { ok: false, error: friendly(error) };
    }

    const rows = toCreate.map((c) => ({
      business_id: businessId,
      starts_at: new Date(c.time).toISOString(),
      duration_minutes: c.duration,
      price: CupoSchedule.fromPrice(CupoSchedule.slotOptions(business, { flexible: true, status: "available", staffId: c.staffId })),
      staff_id: c.staffId,
      schedule_key: c.scheduleKey,
      flexible: true,
      // Fecha vieja a propósito: publicar de golpe los cupos de un mes no
      // es "un cupo nuevo" para el aviso de favoritos (HU-11). Si alguien
      // cancela después, reopen_slot sí le pone la fecha del momento.
      created_at: "2000-01-01T00:00:00Z",
    }));
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await client
        .from("slots")
        .upsert(rows.slice(i, i + 200), { onConflict: "business_id,schedule_key", ignoreDuplicates: true });
      if (error) return { ok: false, error: friendly(error) };
    }
    return { ok: true, created: toCreate.length, removed: toRemove.length };
  }

  async function closeDay(businessId, { date, dateTo, staffId, reason } = {}) {
    if (!(await ensureScheduleSupport())) return { ok: false, error: MIGRATION_MSG };
    if (!date || date < CupoSchedule.dateKey(Date.now())) return { ok: false, error: "No puedes cerrar un día que ya pasó." };
    const who = staffId || null;
    const dates = CupoSchedule.dateRange(date, dateTo);
    const saved = await mutateSchedule(businessId, (schedule) => {
      schedule.closures = schedule.closures.filter((c) => !(dates.includes(c.date) && (who === null || c.staffId === who)));
      dates.forEach((d) => schedule.closures.push({ date: d, staffId: who, reason: (reason || "").trim() }));
    });
    if (!saved.ok) return saved;

    const rangeStart = new Date(CupoSchedule.parseDateKey(dates[0]));
    const rangeEnd = new Date(CupoSchedule.parseDateKey(dates[dates.length - 1]));
    rangeEnd.setDate(rangeEnd.getDate() + 1);
    let query = client
      .from("slots")
      .delete()
      .eq("business_id", businessId)
      .eq("status", "available")
      .gte("starts_at", rangeStart.toISOString())
      .lt("starts_at", rangeEnd.toISOString());
    if (who) query = query.eq("staff_id", who);
    const { data, error } = await query.select("id");
    if (error) return { ok: false, error: friendly(error) };
    const synced = await syncSchedule(businessId);
    if (!synced.ok) return synced;
    return { ok: true, removed: (data || []).length, days: dates.length };
  }

  async function reopenDay(businessId, { date, staffId } = {}) {
    if (!(await ensureScheduleSupport())) return { ok: false, error: MIGRATION_MSG };
    const who = staffId || null;
    const saved = await mutateSchedule(businessId, (schedule) => {
      schedule.closures = schedule.closures.filter((c) => !(c.date === date && c.staffId === who));
    });
    if (!saved.ok) return saved;
    const synced = await syncSchedule(businessId);
    if (!synced.ok) return synced;
    return { ok: true, created: synced.created };
  }

  async function cancelReservation(clientId, businessId, slotId, reservationId) {
    const { error } = await client.rpc("cancel_reservation", { p_reservation_id: reservationId });
    if (error) return { ok: false, error: friendly(error) };
    return { ok: true };
  }

  async function updateBusiness(businessId, { name, category, address, servicesCatalog, photos, staff, phone, cancelHours, renames }) {
    const text = CupoValidate.businessText(name, address);
    if (!text.ok) return text;
    const patch = { name: text.name, category, address: text.address };
    if (servicesCatalog !== undefined) {
      const cat = CupoValidate.catalog(servicesCatalog);
      if (!cat.ok) return cat;
      patch.services_catalog = cat.catalog;
    }
    if (photos !== undefined) {
      const list = (photos || []).map((u) => String(u).trim()).filter(Boolean);
      if (list.length > CupoValidate.LIMITS.photosMax) return { ok: false, error: "Puedes tener hasta " + CupoValidate.LIMITS.photosMax + " fotos." };
      if (list.some((u) => !/^https?:\/\/\S+$/i.test(u) || u.length > 500)) {
        return { ok: false, error: "Cada foto debe ser una dirección web que empiece con http:// o https://." };
      }
      patch.photos = list;
    }
    const ph = phone !== undefined ? CupoValidate.phone(phone) : null;
    if (ph && !ph.ok) return ph;
    if (phone !== undefined || cancelHours !== undefined) {
      await ensureScheduleSupport();
      if (agendaSupported) {
        if (phone !== undefined) patch.phone = ph.phone || null;
        if (cancelHours !== undefined) patch.cancel_hours = Math.max(0, Math.min(72, parseInt(cancelHours, 10) || 0));
      } else if (ph && ph.phone) {
        return { ok: false, error: AGENDA_MSG };
      }
    }
    const { error } = await client.from("businesses").update(patch).eq("id", businessId);
    if (error) return { ok: false, error: friendly(error) };

    if (staff !== undefined) {
      // Reemplaza la lista completa: borra los que ya no están, actualiza
      // los que siguen y da de alta los nuevos (llegan con un id local
      // temporal tipo "ST-xxxxx" que no existe en la tabla, así que se
      // insertan sin id y Postgres genera el real). Cada operación se
      // revisa por separado — si una falla a medias, el negocio debe
      // enterarse en vez de ver "Perfil actualizado" con datos a medias.
      const { data: existing, error: selectError } = await client.from("staff").select("id").eq("business_id", businessId);
      if (selectError) return { ok: false, error: selectError.message };
      const existingIds = (existing || []).map((s) => s.id);
      const keepIds = staff.map((s) => s.id).filter((id) => existingIds.includes(id));
      const toDelete = existingIds.filter((id) => !keepIds.includes(id));
      if (toDelete.length) {
        const { error: delError } = await client.from("staff").delete().in("id", toDelete);
        if (delError) return { ok: false, error: delError.message };
      }
      for (const s of staff) {
        if (existingIds.includes(s.id)) {
          const { error: updError } = await client.from("staff").update({ name: s.name }).eq("id", s.id);
          if (updError) return { ok: false, error: updError.message };
        } else {
          const { error: insError } = await client.from("staff").insert({ business_id: businessId, name: s.name });
          if (insError) return { ok: false, error: insError.message };
        }
      }
    }

    // Renombrar un servicio: lo que hace cada persona (staff.services) y los cupos libres con
    // ese servicio fijo toman el nombre nuevo; antes quedaban cupos "Sin servicios". (El nombre
    // de una persona se actualiza solo: los cupos lo leen de la tabla staff.)
    const svcMap = (renames && renames.services) || {};
    if (Object.keys(svcMap).length) {
      const { data: staffRows } = await client.from("staff").select("id, services").eq("business_id", businessId);
      for (const st of staffRows || []) {
        const current = Array.isArray(st.services) ? st.services : [];
        const mapped = current.map((n) => (Object.prototype.hasOwnProperty.call(svcMap, n) ? svcMap[n] : n));
        if (JSON.stringify(mapped) !== JSON.stringify(current)) {
          const { error: svcError } = await client.from("staff").update({ services: mapped }).eq("id", st.id).eq("business_id", businessId);
          if (svcError) return { ok: false, error: friendly(svcError) };
        }
      }
      for (const [before, after] of Object.entries(svcMap)) {
        const { error: slotError } = await client.from("slots").update({ service: after })
          .eq("business_id", businessId).eq("service", before).eq("status", "available");
        if (slotError) return { ok: false, error: friendly(slotError) };
      }
    }
    return { ok: true };
  }

  async function hasReservationAt(clientId, businessId) {
    const { data, error } = await client.rpc("has_reservation_at", { p_business_id: businessId });
    if (error) return false;
    return !!data;
  }

  async function addReview(businessId, clientId, { rating, comment, photoUrl }) {
    const { error } = await client.rpc("add_review", {
      p_business_id: businessId,
      p_rating: parseInt(rating, 10) || 0,
      p_comment: comment || "",
      p_photo_url: photoUrl || null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  const PHOTO_EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  const MAX_STORAGE_PHOTO_BYTES = 5 * 1024 * 1024;

  async function uploadPhoto(ownerId, file, kind) {
    if (!file) return { ok: false, error: "No se seleccionó ningún archivo." };
    if (!file.type || !file.type.startsWith("image/")) {
      return { ok: false, error: "Solo se aceptan imágenes." };
    }
    if (file.size > MAX_STORAGE_PHOTO_BYTES) {
      return { ok: false, error: "La imagen pesa más de 5 MB." };
    }
    const ext = PHOTO_EXT_BY_MIME[file.type] || "jpg";
    const path = `${kind}/${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2, 9)}.${ext}`;
    const { error: uploadError } = await client.storage.from("photos").upload(path, file);
    if (uploadError) return { ok: false, error: uploadError.message };
    const { data } = client.storage.from("photos").getPublicUrl(path);
    return { ok: true, url: data.publicUrl };
  }

  function getAverageRating(business) {
    return CupoStore.getAverageRating(business);
  }

  async function toggleFavorite(clientId, businessId) {
    const { data, error } = await client.rpc("toggle_favorite", { p_business_id: businessId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, favorited: !!data };
  }

  async function getNewFavoriteSlots(clientId) {
    const { data, error } = await client.rpc("get_new_favorite_slots");
    if (error) return [];
    return (data || []).map((row) => ({
      businessId: row.business_id,
      businessName: row.business_name,
      slotId: row.slot_id,
      label: labelFor(new Date(row.starts_at)),
      service: row.service,
    }));
  }

  async function touchFavoritesCheck(clientId) {
    const { error } = await client.rpc("touch_favorites_check");
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  // Diagnóstico: ¿a la base le falta algo que este código necesita? Se corre a
  // mano desde la consola del sitio ya conectado:
  //   await SupabaseStore.checkSchema()
  // y responde { ok, missing: [...] } con cada columna o función que no
  // existe, para saber qué SQL falta correr (db/migracion-horario-semanal.sql).
  // Solo lee: las funciones se llaman con ids falsos y fallan sin escribir nada.
  async function checkSchema() {
    if (!client) throw new Error("Configura js/supabase-config.js primero.");
    const columns = {
      sales: ["original_price", "discount_pct", "staff_name", "client_id", "folio", "starts_at", "duration_minutes", "attendance", "client_phone", "client_country"],
      slots: ["original_price", "discount_pct", "staff_id", "schedule_key", "flexible"],
      reservations: ["folio", "walkin_name"],
      reviews: ["photo_url"],
      staff: ["services"],
      businesses: ["photos", "services_catalog", "schedule", "phone", "cancel_hours"],
      clients: ["last_favorites_check"],
    };
    const nobody = "00000000-0000-0000-0000-000000000000";
    const functions = {
      book_slot: { p_slot_id: nobody, p_service: null, p_expected_price: null },
      book_slot_manual: { p_slot_id: nobody, p_client_name: "x", p_service: null, p_phone: null },
      set_attendance: { p_sale_id: nobody, p_attendance: "pendiente" },
      slot_service_price: { p_slot_id: nobody, p_service: null },
      cancel_reservation: { p_reservation_id: nobody },
      reopen_slot: { p_slot_id: nobody, p_expected_folio: null },
      add_review: { p_business_id: nobody, p_rating: 5, p_comment: "", p_photo_url: null },
      has_reservation_at: { p_business_id: nobody },
      get_my_sales: {},
      get_new_favorite_slots: {},
    };
    const missing = [];
    for (const [table, cols] of Object.entries(columns)) {
      for (const col of cols) {
        const { error } = await client.from(table).select(col).limit(0);
        if (error) missing.push(table + "." + col);
      }
    }
    for (const [name, args] of Object.entries(functions)) {
      const { error } = await client.rpc(name, args);
      if (error && error.code === "PGRST202") missing.push("función " + name);
    }
    // Aparte: nombres de quien agenda el negocio que siguen en la tabla pública
    const legacy = await client.from("slots").select("walkin_name").limit(0);
    const legacyColumn = !legacy.error;
    return {
      ok: missing.length === 0 && !legacyColumn,
      missing,
      legacyPublicWalkinColumn: legacyColumn,
      hint: missing.length || legacyColumn
        ? "Corre completos, en este orden, los que te falten: db/migracion-horario-semanal.sql, db/migracion-ventas-agenda.sql y db/migracion-endurecimiento.sql en el SQL Editor de Supabase. OJO: si una base ya corrió una más nueva, la más vieja avisa que ya fue superada y no hace nada."
        : "La base está al día.",
    };
  }

  // Crea, con signUp() real, los negocios de ejemplo de Monterrey que
  // el prototipo usa en localStorage. Solo hace falta correrlo una vez,
  // a mano, desde la consola del navegador (no se llama solo):
  //   await SupabaseStore.seedDemoBusinesses()
  // Nota: copia los cupos de hoy tal cual (incluido su servicio), pero NO
  // replica el historial de ventas de demostración de los últimos 30 días
  // que sí trae localStorage — el dashboard de Ventas arranca vacío hasta
  // que entren reservas reales.
  async function seedDemoBusinesses() {
    if (!client) throw new Error("Configura js/supabase-config.js primero.");
    const seed = CupoStore.getBusinesses(); // localStorage ya trae los negocios de ejemplo
    let created = 0;
    for (const b of seed) {
      const result = await registerBusiness({
        name: b.name,
        category: b.category,
        address: b.address,
        email: b.email,
        password: b.password,
      });
      if (result.ok) {
        created++;
        await client.from("businesses").update({
          lat: b.lat,
          lng: b.lng,
          rating: b.rating,
          services_catalog: b.servicesCatalog || [],
        }).eq("id", result.business.id);
        for (const s of b.slots) {
          await addSlot(result.business.id, {
            hour: new Date(s.time).getHours(),
            minute: new Date(s.time).getMinutes(),
            duration: s.duration,
            price: s.price,
            service: s.service,
            dayOffset: 0,
            discountPct: s.discountPct || 0,
            staffId: null,
          });
        }
        await client.auth.signOut();
      }
    }
    return created;
  }

  return {
    AREAS: CupoStore.AREAS,
    CATEGORIES: CupoStore.CATEGORIES,
    CATEGORY_VISUALS: CupoStore.CATEGORY_VISUALS,
    SERVICES_BY_CATEGORY: CupoStore.SERVICES_BY_CATEGORY,
    COUNTRY_CODES: CupoStore.COUNTRY_CODES,
    MTY_CENTER: CupoStore.MTY_CENTER,
    distanceKm: CupoStore.distanceKm,
    startOfDay: CupoStore.startOfDay,
    isConfigured,
    init: () => {},
    getSession,
    setSession,
    clearSession,
    login,
    requestPasswordReset,
    updatePassword,
    registerClient,
    registerBusiness,
    getBusinesses,
    getBusinessById,
    getClientById,
    bookSlot,
    bookSlotManual,
    addSlot,
    updateSlot,
    reopenSlot,
    removeSlot,
    saveSchedule,
    syncSchedule,
    closeDay,
    reopenDay,
    cancelReservation,
    updateBusiness,
    getSales,
    setAttendance,
    hasReservationAt,
    addReview,
    getAverageRating,
    uploadPhoto,
    toggleFavorite,
    getNewFavoriteSlots,
    touchFavoritesCheck,
    seedDemoBusinesses,
    checkSchema,
  };
})();
