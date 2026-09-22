const CupoStore = (() => {
  const KEYS = {
    businesses: "cupo_businesses",
    clients: "cupo_clients",
    session: "cupo_session",
  };

  const CATEGORIES = ["Barbería", "Salón", "Spa", "Estética"];

  function todayAt(hour, minute) {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  }

  function seedSlots(baseHour, count, price) {
    const slots = [];
    for (let i = 0; i < count; i++) {
      const h = baseHour + i;
      slots.push({
        id: "s" + Math.random().toString(36).slice(2, 9),
        time: todayAt(h, 0),
        label: (h > 12 ? h - 12 : h) + ":00 " + (h >= 12 ? "PM" : "AM"),
        duration: 45,
        price: price,
        status: "available",
        clientId: null,
        clientName: null,
      });
    }
    return slots;
  }

  function seedBusinesses() {
    return [
      {
        id: "b1",
        name: "Barbería Central",
        category: "Barbería",
        address: "Av. Reforma 120, CDMX",
        email: "central@cupo.mx",
        password: "1234",
        rating: 4.8,
        slots: seedSlots(15, 4, 180),
      },
      {
        id: "b2",
        name: "Salón Bella",
        category: "Salón",
        address: "Calle Juárez 45, CDMX",
        email: "bella@cupo.mx",
        password: "1234",
        rating: 4.6,
        slots: seedSlots(14, 3, 250),
      },
      {
        id: "b3",
        name: "Spa Relax",
        category: "Spa",
        address: "Insurgentes Sur 900, CDMX",
        email: "relax@cupo.mx",
        password: "1234",
        rating: 4.9,
        slots: seedSlots(16, 3, 450),
      },
      {
        id: "b4",
        name: "Estética Luna",
        category: "Estética",
        address: "Av. Universidad 300, CDMX",
        email: "luna@cupo.mx",
        password: "1234",
        rating: 4.7,
        slots: seedSlots(13, 4, 200),
      },
    ];
  }

  function init() {
    if (!localStorage.getItem(KEYS.businesses)) {
      localStorage.setItem(KEYS.businesses, JSON.stringify(seedBusinesses()));
    }
    if (!localStorage.getItem(KEYS.clients)) {
      localStorage.setItem(KEYS.clients, JSON.stringify([]));
    }
  }

  function getBusinesses() {
    return JSON.parse(localStorage.getItem(KEYS.businesses) || "[]");
  }

  function saveBusinesses(list) {
    localStorage.setItem(KEYS.businesses, JSON.stringify(list));
  }

  function getClients() {
    return JSON.parse(localStorage.getItem(KEYS.clients) || "[]");
  }

  function saveClients(list) {
    localStorage.setItem(KEYS.clients, JSON.stringify(list));
  }

  function getSession() {
    return JSON.parse(localStorage.getItem(KEYS.session) || "null");
  }

  function setSession(session) {
    localStorage.setItem(KEYS.session, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(KEYS.session);
  }

  function findBusinessByEmail(email) {
    return getBusinesses().find((b) => b.email.toLowerCase() === email.toLowerCase());
  }

  function findClientByEmail(email) {
    return getClients().find((c) => c.email.toLowerCase() === email.toLowerCase());
  }

  function registerClient({ name, email, password, phone }) {
    const clients = getClients();
    if (clients.some((c) => c.email.toLowerCase() === email.toLowerCase())) {
      return { ok: false, error: "Ya existe una cuenta con ese correo." };
    }
    const client = {
      id: "c" + Math.random().toString(36).slice(2, 9),
      name,
      email,
      password,
      phone,
      reservations: [],
    };
    clients.push(client);
    saveClients(clients);
    return { ok: true, client };
  }

  function registerBusiness({ name, category, address, email, password }) {
    const businesses = getBusinesses();
    if (businesses.some((b) => b.email.toLowerCase() === email.toLowerCase())) {
      return { ok: false, error: "Ya existe un negocio registrado con ese correo." };
    }
    const business = {
      id: "b" + Math.random().toString(36).slice(2, 9),
      name,
      category,
      address,
      email,
      password,
      rating: 5.0,
      slots: [],
    };
    businesses.push(business);
    saveBusinesses(businesses);
    return { ok: true, business };
  }

  function bookSlot(businessId, slotId, client) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false, error: "Negocio no encontrado." };
    const slot = business.slots.find((s) => s.id === slotId);
    if (!slot || slot.status !== "available") {
      return { ok: false, error: "Ese cupo ya no está disponible." };
    }
    slot.status = "booked";
    slot.clientId = client.id;
    slot.clientName = client.name;
    saveBusinesses(businesses);

    const clients = getClients();
    const c = clients.find((c) => c.id === client.id);
    if (c) {
      c.reservations.push({
        businessId,
        businessName: business.name,
        slotId,
        label: slot.label,
        price: slot.price,
      });
      saveClients(clients);
    }
    return { ok: true };
  }

  function addSlot(businessId, { hour, minute, duration, price }) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false };
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10) || 0;
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const ampm = h >= 12 ? "PM" : "AM";
    const label = displayH + ":" + String(m).padStart(2, "0") + " " + ampm;
    business.slots.push({
      id: "s" + Math.random().toString(36).slice(2, 9),
      time: todayAt(h, m),
      label,
      duration: parseInt(duration, 10) || 45,
      price: parseInt(price, 10) || 0,
      status: "available",
      clientId: null,
      clientName: null,
    });
    business.slots.sort((a, b) => a.time - b.time);
    saveBusinesses(businesses);
    return { ok: true };
  }

  function reopenSlot(businessId, slotId) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false };
    const slot = business.slots.find((s) => s.id === slotId);
    if (!slot) return { ok: false };
    slot.status = "available";
    slot.clientId = null;
    slot.clientName = null;
    saveBusinesses(businesses);
    return { ok: true };
  }

  function removeSlot(businessId, slotId) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false };
    business.slots = business.slots.filter((s) => s.id !== slotId);
    saveBusinesses(businesses);
    return { ok: true };
  }

  return {
    CATEGORIES,
    init,
    getBusinesses,
    saveBusinesses,
    getClients,
    getSession,
    setSession,
    clearSession,
    findBusinessByEmail,
    findClientByEmail,
    registerClient,
    registerBusiness,
    bookSlot,
    addSlot,
    reopenSlot,
    removeSlot,
  };
})();

CupoStore.init();
