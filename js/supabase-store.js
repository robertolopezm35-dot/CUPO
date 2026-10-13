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

  const client = isConfigured && window.supabase
    ? window.supabase.createClient(cfg.url, cfg.anonKey)
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
      label: labelFor(date),
      duration: row.duration_minutes,
      price: Number(row.price),
      service: row.service || null,
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
      slotId: row.slot_id,
      status: row.status,
    };
  }

  function mapBusiness(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      rating: Number(row.rating),
      slots: (row.slots || []).map(mapSlot).sort((a, b) => a.time - b.time),
    };
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
    const { data, error } = await client
      .from("businesses")
      .select("*, slots(*, reservations(id, client_id, clients(first_name, last_name)))");
    if (error) throw error;
    return (data || []).map(mapBusiness);
  }

  async function getBusinessById(id) {
    const { data, error } = await client
      .from("businesses")
      .select("*, slots(*, reservations(id, client_id, clients(first_name, last_name)))")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return mapBusiness(data);
  }

  async function getClientById(id) {
    const { data, error } = await client
      .from("clients")
      .select("*, reservations(id, slot_id, slots(starts_at, price, businesses(name)))")
      .eq("id", id)
      .single();
    if (error || !data) return null;
    return {
      id: data.id,
      firstName: data.first_name,
      lastName: data.last_name,
      name: data.first_name + " " + data.last_name,
      reservations: (data.reservations || []).map((r) => ({
        reservationId: r.id,
        businessId: null,
        businessName: r.slots.businesses.name,
        slotId: r.slot_id,
        label: labelFor(new Date(r.slots.starts_at)),
        price: Number(r.slots.price),
      })),
    };
  }

  async function bookSlot(businessId, slotId) {
    const { error } = await client.rpc("book_slot", { p_slot_id: slotId });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  }

  async function addSlot(businessId, { hour, minute, duration, price, service }) {
    const startsAt = new Date();
    startsAt.setHours(parseInt(hour, 10), parseInt(minute, 10) || 0, 0, 0);
    const { error } = await client.from("slots").insert({
      business_id: businessId,
      starts_at: startsAt.toISOString(),
      duration_minutes: parseInt(duration, 10) || 45,
      price: parseInt(price, 10) || 0,
      service: service || null,
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

  async function updateBusiness(businessId, { name, category, address }) {
    const { error } = await client.from("businesses").update({ name, category, address }).eq("id", businessId);
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
        await client.from("businesses").update({ lat: b.lat, lng: b.lng, rating: b.rating }).eq("id", result.business.id);
        for (const s of b.slots) {
          await addSlot(result.business.id, {
            hour: new Date(s.time).getHours(),
            minute: new Date(s.time).getMinutes(),
            duration: s.duration,
            price: s.price,
            service: s.service,
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
    seedDemoBusinesses,
  };
})();
