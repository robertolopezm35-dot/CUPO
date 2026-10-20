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
      realClient = window.supabase.createClient(cfg.url, cfg.anonKey);
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
      clientId: reservation ? reservation.client_id : null,
      clientName: client ? client.first_name + " " + client.last_name : null,
    };
  }

  function mapSale(row) {
    return {
      id: row.id,
      date: new Date(row.created_at).getTime(),
      service: row.service,
      price: Number(row.price),
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
      date: new Date(row.created_at).getTime(),
    };
  }

  function mapBusiness(row, mySales) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      rating: Number(row.rating),
      photos: row.photos || [],
      servicesCatalog: row.services_catalog || [],
      staff: (row.staff || []).map((s) => ({ id: s.id, name: s.name })),
      reviews: (row.reviews || []).map(mapReview),
      // Nunca las ventas de otros clientes — solo las propias del que
      // consulta (o ninguna, si quien consulta es el propio negocio o no
      // hay sesión). Ver has_reservation_at/get_my_sales en schema.sql.
      sales: (mySales || []).filter((s) => s.businessId === row.id),
      slots: (row.slots || []).map(mapSlot).sort((a, b) => a.time - b.time),
    };
  }

  const BUSINESS_SELECT = `
    *,
    staff(id, name),
    reviews(id, client_id, client_name, rating, comment, created_at),
    slots(*, staff(name), reservations(id, client_id, clients(first_name, last_name)))
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
    if (error || !profile) return null;
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
    if (error) return { ok: false, error: "Correo o contraseña incorrectos." };
    const { data: profile } = await client.from("profiles").select("role").eq("id", data.user.id).single();
    if (!profile || profile.role !== role) {
      await client.auth.signOut();
      return { ok: false, error: "Esa cuenta no es de " + role + "." };
    }
    return { ok: true, id: data.user.id };
  }

  async function registerClient({ firstName, lastName, email, password, countryCode, phone }) {
    if (!/^\d{10}$/.test(phone)) {
      return { ok: false, error: "El teléfono debe tener 10 dígitos." };
    }
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
    if (error) return { ok: false, error: error.message === "User already registered" ? "Ya existe una cuenta con ese correo." : error.message };
    if (!data.session) {
      return { ok: false, error: "Cuenta creada. Revisa tu correo para confirmar antes de entrar (o apaga \"Confirm email\" en Supabase para pruebas)." };
    }
    return { ok: true, client: { id: data.user.id, name: firstName + " " + lastName } };
  }

  async function registerBusiness({ name, category, address, email, password }) {
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { role: "negocio", name, category, address },
      },
    });
    if (error) return { ok: false, error: error.message === "User already registered" ? "Ya existe un negocio registrado con ese correo." : error.message };
    if (!data.session) {
      return { ok: false, error: "Cuenta creada. Revisa tu correo para confirmar antes de entrar (o apaga \"Confirm email\" en Supabase para pruebas)." };
    }
    return { ok: true, business: { id: data.user.id, name } };
  }

  async function getBusinesses() {
    const [{ data, error }, mySales] = await Promise.all([
      client.from("businesses").select(BUSINESS_SELECT),
      getMySales(),
    ]);
    if (error) throw error;
    return (data || []).map((row) => mapBusiness(row, mySales));
  }

  async function getBusinessById(id) {
    const [{ data, error }, mySales] = await Promise.all([
      client.from("businesses").select(BUSINESS_SELECT).eq("id", id).single(),
      getMySales(),
    ]);
    if (error || !data) return null;
    return mapBusiness(data, mySales);
  }

  async function getClientById(id) {
    const { data, error } = await client
      .from("clients")
      .select(`
        *,
        favorites(business_id),
        reservations(id, slot_id, folio, slots(starts_at, price, duration_minutes, service, staff_id, staff(name), businesses(id, name)))
      `)
      .eq("id", id)
      .single();
    if (error || !data) return null;
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
        price: Number(r.slots.price),
        service: r.slots.service || null,
        staffName: r.slots.staff ? r.slots.staff.name : null,
        duration: r.slots.duration_minutes,
        folio: r.folio || null,
      })),
    };
  }

  async function bookSlot(businessId, slotId) {
    const { data, error } = await client.rpc("book_slot", { p_slot_id: slotId });
    if (error) return { ok: false, error: error.message };
    return { ok: true, folio: data ? data.folio : null };
  }

  async function addSlot(businessId, { hour, minute, duration, price, service, dayOffset, discountPct, staffId }) {
    const offset = parseInt(dayOffset, 10) || 0;
    const startsAt = new Date(Date.now() + offset * 86400000);
    startsAt.setHours(parseInt(hour, 10), parseInt(minute, 10) || 0, 0, 0);
    const basePrice = parseInt(price, 10) || 0;
    const pct = Math.max(0, Math.min(90, parseInt(discountPct, 10) || 0));
    const finalPrice = pct > 0 ? Math.round((basePrice * (1 - pct / 100)) / 5) * 5 : basePrice;
    const { error } = await client.from("slots").insert({
      business_id: businessId,
      starts_at: startsAt.toISOString(),
      duration_minutes: parseInt(duration, 10) || 45,
      price: finalPrice,
      original_price: pct > 0 ? basePrice : null,
      discount_pct: pct,
      service: service || null,
      staff_id: staffId || null,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function getSales(businessId) {
    const { data, error } = await client
      .from("sales")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(mapSale);
  }

  async function reopenSlot(businessId, slotId) {
    const { error } = await client.rpc("reopen_slot", { p_slot_id: slotId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function removeSlot(businessId, slotId) {
    const { error } = await client.from("slots").delete().eq("id", slotId).eq("status", "available");
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function cancelReservation(clientId, businessId, slotId, reservationId) {
    const { error } = await client.rpc("cancel_reservation", { p_reservation_id: reservationId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function updateBusiness(businessId, { name, category, address, servicesCatalog, photos, staff }) {
    const patch = { name, category, address };
    if (servicesCatalog !== undefined) patch.services_catalog = servicesCatalog;
    if (photos !== undefined) patch.photos = photos;
    const { error } = await client.from("businesses").update(patch).eq("id", businessId);
    if (error) return { ok: false, error: error.message };

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
    return { ok: true };
  }

  async function hasReservationAt(clientId, businessId) {
    const { data, error } = await client.rpc("has_reservation_at", { p_business_id: businessId });
    if (error) return false;
    return !!data;
  }

  async function addReview(businessId, clientId, { rating, comment }) {
    const { error } = await client.rpc("add_review", {
      p_business_id: businessId,
      p_rating: parseInt(rating, 10) || 0,
      p_comment: comment || "",
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
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

  // Crea, con signUp() real, los 30 negocios de ejemplo de Monterrey que
  // el prototipo usa en localStorage. Solo hace falta correrlo una vez,
  // a mano, desde la consola del navegador (no se llama solo):
  //   await SupabaseStore.seedDemoBusinesses()
  // Nota: copia los cupos de hoy tal cual (incluido su servicio), pero NO
  // replica el historial de ventas de demostración de los últimos 30 días
  // que sí trae localStorage — el dashboard de Ventas arranca vacío hasta
  // que entren reservas reales.
  async function seedDemoBusinesses() {
    if (!client) throw new Error("Configura js/supabase-config.js primero.");
    const seed = CupoStore.getBusinesses(); // localStorage ya trae los 30 de ejemplo
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
    registerClient,
    registerBusiness,
    getBusinesses,
    getBusinessById,
    getClientById,
    bookSlot,
    addSlot,
    reopenSlot,
    removeSlot,
    cancelReservation,
    updateBusiness,
    getSales,
    hasReservationAt,
    addReview,
    getAverageRating,
    toggleFavorite,
    getNewFavoriteSlots,
    touchFavoritesCheck,
    seedDemoBusinesses,
  };
})();
