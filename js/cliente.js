(async function () {
  // Cualquiera puede mirar los cupos sin cuenta (como en Booksy/Fresha): la
  // cuenta se pide hasta el momento de reservar, y después de entrar se
  // regresa exactamente al cupo que se había elegido. Si alguien abre un
  // link compartido (?negocio=ID) y ya tiene cuenta, también llega directo.
  const here = "cliente.html"; // el destino de "regresar" siempre es esta página (Pages también la sirve sin extensión)
  const hereWithQuery = here + location.search;
  const loginUrl = "auth.html?mode=login&role=cliente&next=" + encodeURIComponent(hereWithQuery);
  const registerUrl = "auth.html?mode=register&role=cliente&next=" + encodeURIComponent(hereWithQuery);

  let session = null;
  let client = null;
  try {
    session = await DataStore.getSession();
    if (session && session.role === "cliente") {
      client = await DataStore.getClientById(session.id);
      if (!client) await DataStore.clearSession(); // la cuenta ya no existe de verdad
    }
  } catch (err) {
    // Un fallo de red NO es "no hay cuenta": se avisa y se deja reintentar, sin cerrar la sesión.
    console.error("No se pudo cargar la cuenta:", err);
    CupoUI.fatal("No pudimos cargar tu cuenta.");
    return;
  }
  const isGuest = !client;
  // Un negocio con sesión abierta que mira los cupos: no es "visitante" (no se le ofrece "Crear cuenta").
  const roleMismatch = !!(session && session.role === "negocio");
  DataStore.watchSessionChange();

  const userBox = document.getElementById("userBox");
  const guestBox = document.getElementById("guestBox");
  const guestLoginEl = document.getElementById("guestLogin");
  const guestRegisterEl = document.getElementById("guestRegister");
  // El logo lleva a "tu casa": la agenda si eres negocio, tus cupos si eres cliente, el inicio si eres visitante.
  const logoEl = document.querySelector(".dash-header .logo");
  if (logoEl) logoEl.href = roleMismatch ? "negocio.html" : isGuest ? "index.html" : "cliente.html";
  const inviteLink = document.getElementById("inviteBusinessLink");
  if (inviteLink) inviteLink.href = CupoShare.whatsappShareUrl(CupoShare.inviteBusinessMessage());
  if (isGuest) {
    userBox.hidden = true;
    guestBox.hidden = false;
    guestLoginEl.href = loginUrl;
    guestRegisterEl.href = registerUrl;
    document.getElementById("reservationsSection").hidden = true;
    if (roleMismatch) {
      guestBox.innerHTML = '<a class="btn btn-primary btn-sm" href="negocio.html">Ir a mi agenda</a><button type="button" class="btn btn-ghost btn-sm" id="roleLogoutBtn">Salir</button>';
      document.getElementById("roleLogoutBtn").addEventListener("click", async () => {
        await DataStore.clearSession();
        window.location.href = "index.html";
      });
    }
  } else {
    document.getElementById("navReservas").hidden = false;
    document.getElementById("userName").textContent = client.name;
    document.getElementById("userAvatar").textContent = CupoValidate.initial(client.name);
    document.getElementById("logoutBtn").addEventListener("click", async () => {
      await DataStore.clearSession();
      window.location.href = "index.html";
    });
  }

  // Un visitante que toca un cupo pasa por crear cuenta/iniciar sesión y
  // vuelve a ese mismo cupo (ver ?slot= más abajo).
  function bookingAuthUrl(businessId, slotId) {
    const next = "cliente.html?negocio=" + encodeURIComponent(businessId) + "&slot=" + encodeURIComponent(slotId);
    return "auth.html?mode=register&role=cliente&reason=reservar&next=" + encodeURIComponent(next);
  }

  window.__cupoPhotoError = function (img) {
    img.style.display = "none";
    const gallery = img.parentElement;
    if (!gallery) return;
    const allHidden = Array.from(gallery.querySelectorAll("img")).every((im) => im.style.display === "none");
    if (allHidden) {
      gallery.outerHTML = `<div class="biz-photo" style="background:${gallery.dataset.fallbackCss}"><span class="photo-icon">${gallery.dataset.fallbackEmoji}</span></div>`;
    }
  };

  let activeArea = DataStore.AREAS.find((a) => !a.comingSoon).id;
  let activeCategory = "Todas";
  let searchTerm = "";
  let userLocation = null;
  let pendingAction = null;
  let dayOffset = 0;
  let serviceFilter = "";
  let horarioFilter = "";
  let favoritesOnly = false;
  let soonOnly = false;
  let discountOnly = false;
  let lastNextDayHint = null; // { offset, label }: el día más cercano con cupos cuando el elegido no tiene
  // Un link compartido (?negocio=ID) abre una vista de ESE negocio solo (con "Ver más negocios"), no el
  // directorio completo; cualquier filtro que toque la persona la deja. ?slot=ID además abre la confirmación.
  const params = new URLSearchParams(location.search);
  let targetBusinessId = params.get("negocio") || null;
  const targetSlotId = params.get("slot");
  let singleMode = !!targetBusinessId;
  let pageNotice = ""; // aviso persistente arriba de la lista (p. ej. "No encontramos ese negocio")
  let reviewBusinessId = null;
  let reviewStars = 0;
  const PAGE_SIZE = 12;
  let visibleCount = PAGE_SIZE;
  const MAX_DAY = 27; // un cupo compartido puede ser de hasta 4 semanas adelante (el negocio publica ~4 semanas)

  const dashTitleEl = document.getElementById("dashTitle");
  const areaTabsEl = document.getElementById("areaTabs");
  const dayTabsEl = document.getElementById("dayTabs");
  const filtersEl = document.getElementById("categoryFilters");
  const comingSoonPanel = document.getElementById("comingSoonPanel");
  const businessListEl = document.getElementById("businessList");
  const moreBusinessesBtn = document.getElementById("moreBusinessesBtn");
  const searchInput = document.getElementById("searchInput");
  const filtersToggleBtn = document.getElementById("filtersToggleBtn");
  const moreFilters = document.getElementById("moreFilters");
  const sortNearbyBtn = document.getElementById("sortNearbyBtn");
  const favoritesOnlyBtn = document.getElementById("favoritesOnlyBtn");
  const soonOnlyBtn = document.getElementById("soonOnlyBtn");
  const discountOnlyBtn = document.getElementById("discountOnlyBtn");
  const favoritesBanner = document.getElementById("favoritesBanner");
  const serviceFilterEl = document.getElementById("serviceFilter");
  const horarioFilterEl = document.getElementById("horarioFilter");
  const confirmModal = document.getElementById("confirmModal");
  const confirmTitle = document.getElementById("confirmTitle");
  const confirmText = document.getElementById("confirmText");
  const confirmPolicy = document.getElementById("confirmPolicy");
  const confirmServiceField = document.getElementById("confirmServiceField");
  const confirmService = document.getElementById("confirmService");
  const folioModal = document.getElementById("folioModal");
  const folioText = document.getElementById("folioText");
  const reviewModal = document.getElementById("reviewModal");
  const reviewBusinessName = document.getElementById("reviewBusinessName");
  const starPicker = document.getElementById("starPicker");
  const reviewComment = document.getElementById("reviewComment");
  const reviewPhotoInput = document.getElementById("reviewPhoto");

  const DAY_MS = 86400000;
  const HORARIO_RANGES = { morning: [0, 12], afternoon: [12, 17], evening: [17, 24] };
  const SOON_WINDOW_MS = 2 * 3600000;

  function resetPaging() {
    visibleCount = PAGE_SIZE;
  }
  // Cualquier filtro/búsqueda/categoría saca de la vista de un solo negocio y quita avisos viejos.
  function filterChanged() {
    singleMode = false;
    targetBusinessId = null;
    pageNotice = "";
    resetPaging();
  }

  function renderAreaTabs() {
    areaTabsEl.innerHTML = DataStore.AREAS.map((area) => `
      <button type="button" class="area-tab ${area.id === activeArea ? "active" : ""} ${area.comingSoon ? "coming-soon" : ""}" data-area="${area.id}" aria-pressed="${area.id === activeArea}">
        <span>${area.icon} ${area.name}</span>
        ${area.comingSoon ? '<span class="soon-badge">Pronto</span>' : ""}
      </button>
    `).join("");

    areaTabsEl.querySelectorAll(".area-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        activeArea = btn.dataset.area;
        activeCategory = "Todas";
        filterChanged();
        renderAreaTabs();
        renderDayTabs();
        renderCategoryChips();
        renderServiceOptions();
        await renderBusinesses();
      });
    });
  }

  function dayLabel(i) {
    if (i === 0) return "Hoy";
    if (i === 1) return "Mañana";
    const d = new Date(Date.now() + i * DAY_MS);
    const wd = d.toLocaleDateString("es-MX", { weekday: "short" }).replace(/\.$/, "").replace(/^\w/, (c) => c.toUpperCase());
    return i > 6 ? wd + " " + d.getDate() : wd;
  }
  // "hoy" / "mañana" / "martes 17" — para frases y botones ("Ver martes 17"), sin abreviaturas ambiguas ("Mar").
  function dayLong(i) {
    if (i === 0) return "hoy";
    if (i === 1) return "mañana";
    const d = new Date(Date.now() + i * DAY_MS);
    return d.toLocaleDateString("es-MX", { weekday: "long" }) + " " + d.getDate();
  }
  function dayPhrase(i) { return i <= 1 ? dayLong(i) : "el " + dayLong(i); }
  function noCuposText(i) {
    return i === 0 ? "Hoy ya no hay cupos libres" : i === 1 ? "Mañana no hay cupos libres" : "El " + dayLong(i) + " no hay cupos libres";
  }

  // "Hoy" / "Mañana" / "jue 12 nov" para una hora concreta.
  function dayWord(ts) {
    const diff = Math.round((DataStore.startOfDay(ts) - DataStore.startOfDay(Date.now())) / DAY_MS);
    if (diff === 0) return "Hoy";
    if (diff === 1) return "Mañana";
    return new Date(ts).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, "").replace(/^\w/, (c) => c.toUpperCase());
  }

  function renderDayTabs() {
    const html = [];
    for (let i = 0; i <= 6; i++) {
      html.push(`<button type="button" class="day-tab ${i === dayOffset && !soonOnly ? "active" : ""}" data-day="${i}" aria-pressed="${i === dayOffset && !soonOnly}">${dayLabel(i)}</button>`);
    }
    if (dayOffset > 6 && !soonOnly) {
      html.push(`<button type="button" class="day-tab active" data-day="${dayOffset}" aria-pressed="true">${dayLabel(dayOffset)}</button>`);
    }
    dayTabsEl.innerHTML = html.join("");
    dayTabsEl.classList.toggle("muted", soonOnly);
    dayTabsEl.querySelectorAll(".day-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        dayOffset = parseInt(btn.dataset.day, 10);
        if (soonOnly) setSoonOnly(false);
        resetPaging();
        renderDayTabs();
        await renderBusinesses();
      });
    });
    const curArea = DataStore.AREAS.find((a) => a.id === activeArea);
    document.body.classList.toggle("area-soon", !!(curArea && curArea.comingSoon));
    dashTitleEl.textContent = curArea && curArea.comingSoon
      ? "Área de " + curArea.name
      : soonOnly
      ? "Cupos en las próximas 2 horas"
      : dayOffset === 0
        ? "Cupos disponibles hoy"
        : `Cupos disponibles — ${dayLabel(dayOffset)}`;
  }

  function renderCategoryChips() {
    const area = DataStore.AREAS.find((a) => a.id === activeArea);
    if (!area || area.comingSoon) {
      filtersEl.hidden = true;
      businessListEl.hidden = true;
      moreBusinessesBtn.hidden = true;
      comingSoonPanel.hidden = false;
      return;
    }
    filtersEl.hidden = false;
    businessListEl.hidden = false;
    comingSoonPanel.hidden = true;

    filtersEl.innerHTML = `<button type="button" class="chip ${activeCategory === "Todas" ? "active" : ""}" data-category="Todas" aria-pressed="${activeCategory === "Todas"}">Todas</button>` +
      area.categories.map((cat) =>
        `<button type="button" class="chip ${activeCategory === cat ? "active" : ""}" data-category="${esc(cat)}" aria-pressed="${activeCategory === cat}">${esc(cat)}</button>`
      ).join("");

    filtersEl.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", async () => {
        activeCategory = btn.dataset.category;
        filterChanged();
        renderCategoryChips();
        renderServiceOptions();
        await renderBusinesses();
      });
    });
  }

  function renderServiceOptions() {
    let services;
    if (activeCategory !== "Todas") {
      services = DataStore.SERVICES_BY_CATEGORY[activeCategory] || [];
    } else {
      const area = DataStore.AREAS.find((a) => a.id === activeArea);
      const set = new Set();
      (area ? area.categories : []).forEach((cat) => (DataStore.SERVICES_BY_CATEGORY[cat] || []).forEach((s) => set.add(s)));
      services = Array.from(set);
    }
    const current = serviceFilterEl.value;
    serviceFilterEl.innerHTML = '<option value="">Todos los servicios</option>' +
      services.map((s) => `<option value="${s}">${s}</option>`).join("");
    if (services.includes(current)) serviceFilterEl.value = current;
    else serviceFilter = "";
  }

  let toastTimer = null;
  function showToast(msg, ms) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), ms || (msg.length > 70 ? 4200 : 2200));
  }
  // Anuncio para lectores de pantalla (región en vivo) cuando cambia lo que se muestra.
  let lastAnnounce = "";
  function announce(msg) {
    const el = document.getElementById("listStatus");
    if (!el || msg === lastAnnounce) return;
    lastAnnounce = msg;
    el.textContent = msg;
  }

  // Escapa cualquier texto controlado por negocios/clientes (nombre, dirección,
  // catálogo, personal, reseñas, URLs de foto) antes de insertarlo en innerHTML
  // o en un atributo — sin esto, un nombre o reseña con HTML se ejecuta como
  // script en la pantalla de cualquiera que vea esa tarjeta (XSS almacenado).
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function hashStr(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(h);
  }

  function businessPhoto(b) {
    const v = DataStore.CATEGORY_VISUALS[b.category] || { emoji: "✨", hue: 243 };
    const h = hashStr(b.id);
    const hue = v.hue + (h % 14) - 7;
    const l1 = 60 - (h % 8);
    const l2 = 42 - (h % 6);
    return {
      emoji: v.emoji,
      css: `linear-gradient(135deg, hsl(${hue} 70% ${l1}%), hsl(${hue + 22} 65% ${l2}%))`,
    };
  }

  function avgRating(b) {
    const reviews = b.reviews || [];
    if (!reviews.length) return { value: b.rating, count: 0 };
    const value = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
    return { value, count: reviews.length };
  }

  function cancelPolicyText(hours) {
    const h = parseInt(hours, 10);
    const when = !Number.isFinite(h) || h === 1 ? "hasta 1 hora antes de tu cita"
      : h <= 0 ? "hasta el momento de tu cita"
      : "hasta " + h + " horas antes de tu cita";
    return "Puedes cancelar sin costo " + when + ". Pagas directamente en el negocio.";
  }

  // serviceOptions: solo para cupos flexibles con más de un servicio — el
  // cliente elige cuál quiere antes de confirmar (cada uno con su precio).
  function openConfirm(title, text, action, showPolicy, serviceOptions, policyText) {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
    confirmPolicy.hidden = !showPolicy;
    confirmPolicy.textContent = policyText || cancelPolicyText(1);
    confirmServiceField.hidden = !serviceOptions;
    confirmService.innerHTML = (serviceOptions || []).map((o) =>
      `<option value="${esc(o.name)}">${esc(o.name)} — $${o.price}${o.originalPrice ? " (antes $" + o.originalPrice + ")" : ""}</option>`
    ).join("");
    pendingAction = action;
    confirmModal.classList.add("show");
  }

  sortNearbyBtn.addEventListener("click", () => {
    if (userLocation) {
      // Segundo clic: se quita el orden por cercanía (antes volvía a pedir la ubicación).
      userLocation = null;
      sortNearbyBtn.textContent = "📍 Ordenar por cercanía";
      sortNearbyBtn.setAttribute("aria-pressed", "false");
      filterChanged();
      renderBusinesses();
      return;
    }
    if (!navigator.geolocation) {
      showToast("Tu navegador no soporta ubicación.");
      return;
    }
    sortNearbyBtn.disabled = true;
    sortNearbyBtn.textContent = "Ubicando...";
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        sortNearbyBtn.disabled = false;
        sortNearbyBtn.textContent = "📍 Ordenado por cercanía";
        sortNearbyBtn.setAttribute("aria-pressed", "true");
        showToast("Mostrando los negocios más cercanos primero.");
        filterChanged();
        await renderBusinesses();
      },
      () => {
        sortNearbyBtn.disabled = false;
        sortNearbyBtn.textContent = "📍 Ordenar por cercanía";
        showToast("No pudimos obtener tu ubicación. Revisa los permisos del navegador.");
      },
      { timeout: 8000 }
    );
  });

  function setFavoritesOnly(on) {
    favoritesOnly = on;
    favoritesOnlyBtn.textContent = on ? "♥ Solo favoritos" : "♡ Solo favoritos";
    favoritesOnlyBtn.classList.toggle("active", on);
    favoritesOnlyBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
  function setSoonOnly(on) {
    soonOnly = on;
    soonOnlyBtn.classList.toggle("active", on);
    soonOnlyBtn.setAttribute("aria-pressed", on ? "true" : "false");
    renderDayTabs();
  }
  function setDiscountOnly(on) {
    discountOnly = on;
    discountOnlyBtn.classList.toggle("active", on);
    discountOnlyBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  // Quien tiene la sesión de un negocio abierta no es "visitante": se le dice la verdad en vez de "Inicia sesión".
  function favoritesBlockedMessage() {
    return roleMismatch
      ? "Los favoritos son de las cuentas de cliente. Tienes la sesión de un negocio abierta."
      : "Inicia sesión para guardar y ver tus favoritos.";
  }
  favoritesOnlyBtn.addEventListener("click", async () => {
    if (isGuest) {
      showToast(favoritesBlockedMessage());
      return;
    }
    setFavoritesOnly(!favoritesOnly);
    filterChanged();
    await renderBusinesses();
  });
  soonOnlyBtn.addEventListener("click", async () => {
    setSoonOnly(!soonOnly);
    filterChanged();
    await renderBusinesses();
  });
  discountOnlyBtn.addEventListener("click", async () => {
    setDiscountOnly(!discountOnly);
    resetPaging(); // solo afina los cupos: en la vista de un negocio se queda en ese negocio
    await renderBusinesses();
  });
  moreBusinessesBtn.addEventListener("click", async () => {
    const before = businessListEl.querySelectorAll(".biz-card").length;
    visibleCount += PAGE_SIZE;
    await renderBusinesses({ silent: true });
    // El botón desaparece al mostrar todo: el foco pasa a la primera tarjeta nueva (no se pierde en <body>).
    const cards = businessListEl.querySelectorAll(".biz-card");
    if (cards[before]) { cards[before].setAttribute("tabindex", "-1"); cards[before].focus({ preventScroll: false }); }
  });

  searchInput.addEventListener("input", async () => {
    searchTerm = CupoValidate.fold(searchInput.value.trim());
    filterChanged();
    await renderBusinesses({ silent: true }); // sin atenuado: parpadearía en cada tecla
  });

  // El botón de filtros del celular dice cuántos hay activos (si no, quedan invisibles al cerrarlo).
  function renderFiltersToggle() {
    const open = moreFilters.classList.contains("show");
    const n = [!!userLocation, favoritesOnly, soonOnly, discountOnly, !!serviceFilter, !!horarioFilter].filter(Boolean).length;
    filtersToggleBtn.setAttribute("aria-expanded", open ? "true" : "false");
    filtersToggleBtn.innerHTML = (open ? "✕ Cerrar filtros" : "⚙️ Filtros") + (n && !open ? ' <span class="filters-count" aria-hidden="true">' + n + "</span>" : "");
    filtersToggleBtn.setAttribute("aria-label", (open ? "Cerrar filtros" : "Filtros") + (n ? ", " + n + " activo" + (n === 1 ? "" : "s") : ""));
  }
  filtersToggleBtn.setAttribute("aria-controls", "moreFilters");
  filtersToggleBtn.addEventListener("click", () => {
    const willShow = !moreFilters.classList.contains("show");
    moreFilters.classList.toggle("show", willShow);
    renderFiltersToggle();
  });

  serviceFilterEl.addEventListener("change", async () => {
    serviceFilter = serviceFilterEl.value;
    resetPaging(); // solo afina los cupos: en la vista de un negocio se queda en ese negocio
    await renderBusinesses();
  });

  horarioFilterEl.addEventListener("change", async () => {
    horarioFilter = horarioFilterEl.value;
    resetPaging(); // solo afina los cupos: en la vista de un negocio se queda en ese negocio
    await renderBusinesses();
  });

  async function renderFavoritesBanner() {
    if (isGuest) {
      favoritesBanner.hidden = true;
      return;
    }
    const fresh = await DataStore.getNewFavoriteSlots(client.id);
    if (!fresh.length) {
      favoritesBanner.hidden = true;
      return;
    }
    favoritesBanner.hidden = false;
    favoritesBanner.innerHTML = `🔔 ${fresh.length} cupo${fresh.length === 1 ? "" : "s"} nuevo${fresh.length === 1 ? "" : "s"} en tus favoritos
      <button type="button" class="btn-link-danger" id="dismissFavoritesBanner" style="color:var(--indigo)">Marcar como visto</button>`;
    document.getElementById("dismissFavoritesBanner").addEventListener("click", async () => {
      await DataStore.touchFavoritesCheck(client.id);
      await renderFavoritesBanner();
    });
  }

  function slotMatchesHorario(slot) {
    if (!horarioFilter) return true;
    const range = HORARIO_RANGES[horarioFilter];
    const h = new Date(slot.time).getHours();
    return h >= range[0] && h < range[1];
  }

  // Cuánto falta para un cupo, dicho como una persona: "en 25 min" cuando es
  // inminente; si no, "Hoy 4:30 PM" / "Mañana 10:00 AM".
  function whenWord(slot, now) {
    const mins = Math.round((slot.time - now) / 60000);
    if (mins <= 0) return "ahora";
    if (mins < 90) return "en " + mins + " min";
    return dayWord(slot.time) + " " + slot.label;
  }

  function resetAllFilters() {
    searchInput.value = "";
    searchTerm = "";
    serviceFilter = "";
    serviceFilterEl.value = "";
    horarioFilter = "";
    horarioFilterEl.value = "";
    activeCategory = "Todas";
    setFavoritesOnly(false);
    setDiscountOnly(false);
    setSoonOnly(false);
    filterChanged();
    renderCategoryChips();
    renderServiceOptions();
  }

  // `silent`: sin el atenuado de carga (para no parpadear en cada tecla del
  // buscador, en el refresco de fondo, o justo después de una acción que ya
  // mostró su propio toast). Un fallo de red SIEMPRE avisa con toast y NUNCA
  // borra lo que ya se había mostrado — mejor datos viejos que una pantalla
  // en blanco sin explicación.
  let renderSeq = 0;      // cada llamada tiene un número: una respuesta vieja y lenta no pisa una más nueva
  let lastListHtml = null; // si el HTML no cambió, no se toca el DOM (se conservan desplegables y foco)

  // Recuerda qué desplegables estaban abiertos y qué tenía el foco, para restaurarlos al repintar.
  function captureUiState(list) {
    const open = [];
    list.querySelectorAll(".biz-card").forEach((card) => {
      card.querySelectorAll("details").forEach((d, i) => { if (d.open) open.push(card.dataset.businessId + "|" + i); });
    });
    const a = document.activeElement;
    let focus = null;
    if (a && list.contains(a)) {
      if (a.dataset && a.dataset.slot) focus = '.slot[data-slot="' + a.dataset.slot + '"]';
      else if (a.dataset && a.dataset.fav) focus = '[data-fav="' + a.dataset.fav + '"]';
      else if (a.dataset && a.dataset.share) focus = '[data-share="' + a.dataset.share + '"]';
      else if (a.tagName === "SUMMARY") {
        const card = a.closest(".biz-card");
        const idx = card ? Array.from(card.querySelectorAll("details")).indexOf(a.parentElement) : -1;
        if (card && idx >= 0) focus = '.biz-card[data-business-id="' + card.dataset.businessId + '"]|summary|' + idx;
      }
    }
    return { open, focus };
  }
  function restoreUiState(list, state) {
    state.open.forEach((key) => {
      const [id, i] = key.split("|");
      const card = list.querySelector('.biz-card[data-business-id="' + CSS.escape(id) + '"]');
      const d = card && card.querySelectorAll("details")[parseInt(i, 10)];
      if (d) d.open = true;
    });
    if (!state.focus) return;
    let el = null;
    if (state.focus.includes("|summary|")) {
      const [cardSel, , idx] = state.focus.split("|");
      const card = list.querySelector(cardSel);
      const d = card && card.querySelectorAll("details")[parseInt(idx, 10)];
      el = d && d.querySelector("summary");
    } else {
      el = list.querySelector(state.focus);
    }
    if (el) el.focus({ preventScroll: true });
    else { list.setAttribute("tabindex", "-1"); list.focus({ preventScroll: true }); }
  }

  // La URL refleja lo que se está viendo (categoría, día o "próximas 2 horas", búsqueda): se puede
  // compartir o recargar y llegas a la misma vista. Usa replaceState (no llena el historial de "Atrás")
  // y mantiene al día los links de "Entrar/Crear cuenta" para volver exactamente aquí.
  function syncUrl() {
    const p = new URLSearchParams();
    if (singleMode && targetBusinessId) {
      p.set("negocio", targetBusinessId);
      if (isGuest && targetSlotId) p.set("slot", targetSlotId);
      if (dayOffset > 0) p.set("dia", String(dayOffset));
    } else {
      if (activeCategory !== "Todas") p.set("categoria", activeCategory);
      if (soonOnly) p.set("cuando", "pronto");
      else if (dayOffset > 0) p.set("dia", String(dayOffset));
      const q = searchInput.value.trim();
      if (q) p.set("q", q.slice(0, 80));
      if (discountOnly) p.set("descuento", "1");
      if (serviceFilter) p.set("servicio", serviceFilter);
      if (horarioFilter) p.set("horario", horarioFilter);
    }
    const qs = p.toString();
    const target = location.pathname + (qs ? "?" + qs : "");
    if (target !== location.pathname + location.search) history.replaceState(null, "", target);
    if (isGuest && !roleMismatch) {
      const next = encodeURIComponent(here + (qs ? "?" + qs : ""));
      guestLoginEl.href = "auth.html?mode=login&role=cliente&next=" + next;
      guestRegisterEl.href = "auth.html?mode=register&role=cliente&next=" + next;
    }
  }

  // Botones de los avisos de la lista ("Ver mañana", "Ver todo el día").
  function wireListActions(list) {
    list.querySelectorAll("[data-jump-day]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        dayOffset = Math.min(Math.max(parseInt(btn.dataset.jumpDay, 10) || 0, 0), MAX_DAY);
        if (soonOnly) setSoonOnly(false);
        resetPaging();
        renderDayTabs();
        await renderBusinesses();
      });
    });
    list.querySelectorAll("[data-clear-soon]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        setSoonOnly(false);
        filterChanged();
        await renderBusinesses();
      });
    });
    list.querySelectorAll("[data-exit-single]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        filterChanged();
        await renderBusinesses();
      });
    });
    list.querySelectorAll("[data-clear-favorites]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        setFavoritesOnly(false);
        filterChanged();
        await renderBusinesses();
      });
    });
    list.querySelectorAll("[data-retry]").forEach((btn) => {
      btn.addEventListener("click", async () => { await renderBusinesses(); });
    });
  }

  function updateReservasBadge(count) {
    const badge = document.getElementById("navReservasCount");
    if (!badge) return;
    badge.hidden = !count;
    badge.textContent = String(count);
  }

  async function renderBusinesses({ silent } = {}) {
    const area = DataStore.AREAS.find((a) => a.id === activeArea);
    if (!area || area.comingSoon) return;
    const mySeq = ++renderSeq;
    syncUrl();

    // La primera vez la lista está vacía: se muestran tarjetas "esqueleto" en
    // vez de un hueco en blanco hasta que llegan los negocios.
    if (!businessListEl.children.length) {
      businessListEl.innerHTML = Array.from({ length: 3 }, () => `<div class="skeleton-card" aria-hidden="true">
        <div class="sk-photo sk"></div>
        <div class="sk-body"><div class="sk sk-line w60"></div><div class="sk sk-line w80"></div>
          <div class="sk-chips"><div class="sk sk-chip"></div><div class="sk sk-chip"></div><div class="sk sk-chip"></div></div></div>
      </div>`).join("");
      businessListEl.setAttribute("aria-busy", "true");
    } else if (!silent) {
      businessListEl.classList.add("loading");
    }
    try {
      await renderFavoritesBanner();
      renderFiltersToggle();

      const list = businessListEl;
      const todayStart = DataStore.startOfDay(Date.now());
      const windowDays = Math.max(8, dayOffset + 2); // un cupo compartido de dentro de 2 semanas también debe cargarse
      const rawAll = (await DataStore.getBusinesses({ slotsFrom: todayStart, slotsTo: todayStart + windowDays * DAY_MS }))
        .filter((b) => area.categories.includes(b.category));
      if (mySeq !== renderSeq) return; // ya hay una consulta más nueva: esta respuesta quedó vieja

      const now = Date.now();
      // Lo que se ve de cada negocio en un día (o en "próximas 2 horas"): sin cupos que ya empezaron,
      // ni cupos libres de un día cerrado o sin ningún servicio que ofrecer.
      const mapDay = (items, offset) => {
        // "Próximas 2 horas" ignora la pestaña del día: mira de aquí a 2 h.
        const dayStart = soonOnly ? now : DataStore.startOfDay(now + offset * DAY_MS);
        const dayEnd = soonOnly ? now + SOON_WINDOW_MS : dayStart + DAY_MS;
        return items.map((b) => {
          const schedule = CupoSchedule.normalize(b.schedule);
          const openOn = (s) => !CupoSchedule.isClosed(schedule, CupoSchedule.dateKey(s.time), s.staffId);
          let slots = b.slots
            .filter((s) => s.time >= dayStart && s.time < dayEnd && s.time > now)
            .map((s) => ({ ...s, info: CupoSchedule.describeSlot(b, s) }))
            .filter((s) => s.status !== "available" || (s.info.bookable && openOn(s)));
          if (serviceFilter) slots = slots.filter((s) => s.info.options.some((o) => o.name === serviceFilter));
          slots = slots.filter((s) => s.status !== "available" || slotMatchesHorario(s));
          if (discountOnly) slots = slots.filter((s) => s.status !== "available" || s.discountPct > 0);
          // El primer cupo libre de todo lo publicado (no solo del día elegido):
          // para decirle al cliente "lo más pronto que hay aquí".
          const nextSlot = b.slots
            .filter((s) => s.status === "available" && s.time > now && openOn(s) && CupoSchedule.describeSlot(b, s).bookable)[0] || null;
          return { ...b, visibleSlots: slots, nextSlot };
        });
      };
      const hasFree = (b) => b.visibleSlots.some((s) => s.status === "available");

      // Vista de UN negocio (link compartido): ignora categoría/búsqueda/filtros; un link roto lo avisa.
      let base;
      let single = null;
      if (singleMode && targetBusinessId) {
        single = rawAll.find((b) => b.id === targetBusinessId) || null;
        if (single) {
          base = [single];
        } else {
          singleMode = false;
          targetBusinessId = null;
          pageNotice = '<div class="list-notice warn" role="status"><span>No encontramos ese negocio: el link pudo cambiar o ya no está en CUPO. Te mostramos los demás.</span></div>';
        }
      }
      if (!single) {
        base = rawAll;
        if (activeCategory !== "Todas") base = base.filter((b) => b.category === activeCategory);
        if (searchTerm) base = base.filter((b) => CupoValidate.fold(b.name).includes(searchTerm));
        if (favoritesOnly) {
          const favIds = (client && client.favoriteBusinessIds) || [];
          base = base.filter((b) => favIds.includes(b.id));
        }
      }

      let businesses = mapDay(base, dayOffset);
      if (!single && (serviceFilter || horarioFilter || soonOnly || discountOnly)) {
        businesses = businesses.filter(hasFree);
      }

      if (userLocation) {
        businesses = businesses.map((b) => ({
          ...b,
          distanceKm: DataStore.distanceKm(userLocation.lat, userLocation.lng, b.lat, b.lng),
        }));
        businesses.sort((a, b) => a.distanceKm - b.distanceKm);
      } else {
        // En una app de último momento lo primero es lo que se puede reservar
        // ya: los negocios con un cupo libre más cercano salen arriba.
        const firstFree = (b) => b.visibleSlots.find((s) => s.status === "available");
        businesses.sort((a, b) => {
          const fa = firstFree(a);
          const fb = firstFree(b);
          if (fa && fb) return fa.time - fb.time || a.name.localeCompare(b.name);
          if (fa) return -1;
          if (fb) return 1;
          return a.name.localeCompare(b.name);
        });
      }

      // ¿Hay algo que reservar ese día? Si no, se dice cuándo es lo más pronto y se ofrece ir ahí.
      let hintHtml = "";
      lastNextDayHint = null;
      if (businesses.length && !businesses.some(hasFree)) {
        if (soonOnly) {
          hintHtml = '<div class="next-hint"><span>⚡ No hay cupos libres en las próximas 2 horas.</span><button type="button" class="btn btn-primary btn-sm" data-clear-soon>Ver todo el día</button></div>';
        } else {
          const first = businesses.map((b) => b.nextSlot).filter(Boolean).sort((a, b) => a.time - b.time)[0];
          if (first) {
            const offset = Math.round((DataStore.startOfDay(first.time) - DataStore.startOfDay(now)) / DAY_MS);
            if (offset >= 0 && offset <= MAX_DAY && offset !== dayOffset) {
              const owner = businesses.find((b) => b.nextSlot === first);
              lastNextDayHint = { offset, label: dayLong(offset) };
              hintHtml = `<div class="next-hint"><span>${esc(noCuposText(dayOffset))}. Lo más pronto: <strong>${esc(dayWord(first.time))} ${esc(first.label)}</strong>${owner && !single ? " en " + esc(owner.name) : ""}.</span><button type="button" class="btn btn-primary btn-sm" data-jump-day="${offset}">Ver ${esc(dayLong(offset))}</button></div>`;
            } else if (offset === dayOffset) {
              // Hay cupos ese día pero los filtros de servicio/horario/descuento los esconden (vista de un negocio).
              hintHtml = '<div class="next-hint"><span>Ningún cupo de este día coincide con los filtros elegidos.</span></div>';
            }
          }
          if (!hintHtml) {
            // Nadie tiene cupos publicados en lo que se carga: se dice claro (antes: tarjetas vacías sin explicación).
            hintHtml = `<div class="next-hint"><span>${single ? "Este negocio no tiene cupos publicados por ahora." : "Por ahora ningún negocio tiene cupos libres publicados."} Vuelve en un rato: se publican cupos nuevos todo el tiempo.</span></div>`;
          }
        }
      }

      const noticeHtml = pageNotice + (single
        ? `<div class="list-notice"><span>Estás viendo los cupos de <strong>${esc(single.name)}</strong>.</span><button type="button" class="btn btn-outline btn-sm" data-exit-single>Ver más negocios</button></div>`
        : "");

      if (businesses.length === 0) {
        lastListHtml = null;
        moreBusinessesBtn.hidden = true;
        const availFilters = !!(serviceFilter || horarioFilter || discountOnly);
        const filtered = !!(soonOnly || availFilters || searchTerm || favoritesOnly || activeCategory !== "Todas");
        const clearBtn = '<button type="button" class="btn btn-outline btn-sm" id="clearFiltersBtn">Quitar filtros</button>';
        let title, text, actions = "";
        if (!base.length) {
          // Ningún negocio coincide con la categoría/búsqueda/favoritos (antes de mirar cupos).
          if (favoritesOnly && !((client && client.favoriteBusinessIds) || []).length) {
            title = "Todavía no tienes favoritos.";
            text = "Toca el ♡ de un negocio para guardarlo y encontrarlo aquí más rápido.";
            actions = '<button type="button" class="btn btn-primary btn-sm" data-clear-favorites>Ver todos los negocios</button>';
          } else if (searchTerm) {
            title = "No encontramos negocios con “" + searchInput.value.trim().slice(0, 60) + "”.";
            text = "Revisa cómo está escrito o prueba con otra palabra.";
            actions = clearBtn;
          } else if (filtered) {
            title = "No encontramos negocios con esos filtros.";
            text = "Prueba con otra categoría o quita algún filtro.";
            actions = clearBtn;
          } else {
            title = "Todavía no hay negocios en esta categoría.";
            text = "Estamos sumando negocios. Mientras, prueba otra categoría o invita al tuyo con el botón de abajo.";
          }
        } else if (soonOnly) {
          title = "No hay cupos libres en las próximas 2 horas.";
          text = "Prueba con todo el día o con mañana: se publican cupos nuevos todo el tiempo.";
          actions = '<button type="button" class="btn btn-primary btn-sm" data-clear-soon>Ver todo el día</button><button type="button" class="btn btn-outline btn-sm" data-jump-day="1">Ver mañana</button>';
        } else {
          // Hay negocios pero ninguno tiene cupos con los filtros de servicio/horario/descuento ese día:
          // se busca (en memoria) el primer día que sí tenga, para no mandar a "mañana" a ciegas.
          let nextDay = -1;
          for (let o = dayOffset + 1; o < windowDays && o <= MAX_DAY; o++) {
            if (mapDay(base, o).some(hasFree)) { nextDay = o; break; }
          }
          title = "Ningún negocio tiene cupos con esos filtros para " + dayPhrase(dayOffset) + ".";
          text = nextDay >= 0 ? "Lo más pronto con esos filtros es " + dayPhrase(nextDay) + "." : "Prueba quitando algún filtro.";
          actions = (nextDay >= 0 ? `<button type="button" class="btn btn-primary btn-sm" data-jump-day="${nextDay}">Ver ${esc(dayLong(nextDay))}</button>` : "") + clearBtn;
        }
        list.innerHTML = `${noticeHtml}<div class="empty-state">
          <strong>${esc(title)}</strong>
          <p>${esc(text)}</p>
          <div class="empty-actions">${actions}</div>
        </div>`;
        announce(title);
        wireListActions(list);
        const clearEl = document.getElementById("clearFiltersBtn");
        if (clearEl) clearEl.addEventListener("click", async () => { resetAllFilters(); await renderBusinesses(); });
        return;
      }

      const total = businesses.length;
      const shown = businesses.slice(0, visibleCount);
      moreBusinessesBtn.hidden = shown.length >= total;
      moreBusinessesBtn.textContent = "Ver más negocios (" + (total - shown.length) + ")";

      const html = noticeHtml + hintHtml + shown.map((b) => safeCard(b, () => {
        const slotsForDay = b.visibleSlots;
        // Igual que "Solo quedan 2 habitaciones" en Booking.com — refuerza que
        // estos son cupos de último momento que se pueden acabar, no un
        // catálogo fijo. Solo se muestra cuando de verdad quedan pocos.
        const availableCount = slotsForDay.filter((s) => s.status === "available").length;
        const urgencyHtml = availableCount > 0 && availableCount <= 2
          ? `<span class="urgency-badge">¡Solo queda${availableCount === 1 ? "" : "n"} ${availableCount}!</span>`
          : "";
        const slotsHtml = slotsForDay.length
          ? slotsForDay.map((s) => {
              const cls = s.status === "available" ? "available" : "booked";
              const amount = (s.info.from ? "desde " : "") + "$" + (Number(s.info.price) || 0);
              const priceHtml = s.info.originalPrice
                ? `<span class="price"><s>$${Number(s.info.originalPrice) || 0}</s> ${amount} <span class="discount-badge">-${Number(s.discountPct) || 0}%</span></span>`
                : `<span class="price">${amount}${s.status === "booked" ? " · ocupado" : ""}</span>`;
              const slotLabel = `${b.name}: ${s.label}${s.info.service ? ", " + s.info.service : ""}, ${Number(s.duration) || 0} minutos, ${amount}`;
              return `<div class="slot ${cls}" data-business="${b.id}" data-slot="${s.id}" ${s.status === "available" ? `role="button" tabindex="0" aria-label="${esc(slotLabel)}"` : ""}>
                <span class="time">${esc(s.label)}</span>
                ${s.info.service ? `<span class="price">${esc(s.info.service)}</span>` : ""}
                <span class="price">${Number(s.duration) || 0} min</span>
                ${s.staffName ? `<span class="price">con ${esc(s.staffName)}</span>` : ""}
                ${priceHtml}
              </div>`;
            }).join("")
          : emptySlotsHtml(b);

        const photo = businessPhoto(b);
        const distanceHtml = typeof b.distanceKm === "number"
          ? `<span class="distance-pill">${b.distanceKm < 1 ? Math.round(b.distanceKm * 1000) + " m" : b.distanceKm.toFixed(1) + " km"}</span>`
          : "";
        const rating = avgRating(b);
        const isFavorite = !isGuest && (client.favoriteBusinessIds || []).includes(b.id);
        // Solo reseña quien ya fue atendido: venta completada, cita pasada y sin "No llegó".
        const eligibleForReview = !isGuest && (b.sales || []).some((v) =>
          v.clientId === client.id && v.status === "completada" && (v.attendance || "pendiente") !== "no_asistio" && (v.startsAt || v.date) <= now);
        const nextHtml = b.nextSlot
          ? `<span class="next-pill ${b.nextSlot.time - now < 90 * 60000 ? "soon" : ""}">⚡ Próximo cupo: ${esc(whenWord(b.nextSlot, now))}</span>`
          : "";

        const photoHtml = b.photos && b.photos.length
          ? `<div class="photo-gallery" data-fallback-emoji="${photo.emoji}" data-fallback-css="${photo.css.replace(/"/g, "&quot;")}">${b.photos.slice(0, 5).map((url) => `<img src="${esc(url)}" alt="Foto de ${esc(b.name)}" loading="lazy" onerror="window.__cupoPhotoError(this)">`).join("")}</div>`
          : `<div class="biz-photo" style="background:${photo.css}"><span class="photo-icon">${photo.emoji}</span></div>`;

        const catalogHtml = b.servicesCatalog && b.servicesCatalog.length
          ? `<details class="catalog-details">
              <summary>Servicios y precios (${b.servicesCatalog.length})</summary>
              ${b.servicesCatalog.map((s) => `<div class="catalog-row"><span>${esc(s.name)}</span><span>$${Number(s.price) || 0}</span></div>`).join("")}
            </details>`
          : "";

        const recentReviews = (b.reviews || []).slice().sort((x, y) => (y.date || 0) - (x.date || 0)).slice(0, 2);
        const reviewsHtml = `<details class="catalog-details">
            <summary>${rating.count ? `★ ${rating.value.toFixed(1)} (${rating.count} reseña${rating.count === 1 ? "" : "s"})` : "Reseñas (0)"}</summary>
            ${recentReviews.length ? recentReviews.map((r) => `<div class="review-row"><strong>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</strong> ${r.comment ? "— " + esc(r.comment) : ""} <span class="review-author">· ${esc(r.clientName)}</span>${r.photoUrl ? `<img class="review-photo" src="${esc(r.photoUrl)}" alt="Foto de la reseña de ${esc(r.clientName)}">` : ""}</div>`).join("") : '<div class="review-row" style="color:var(--gray)">Sin reseñas todavía.</div>'}
            ${eligibleForReview ? `<button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" data-review-business="${b.id}" data-review-name="${esc(b.name)}">Dejar reseña</button>` : ""}
          </details>`;

        return `<div class="biz-card" data-business-id="${b.id}">
          ${photoHtml}
          <div class="biz-head">
            <div>
              <h2 class="biz-name">${esc(b.name)}</h2>
              <div class="biz-meta">
                <span>${esc(b.address)}</span>
                ${rating.count ? `<span>★ ${rating.value.toFixed(1)}</span>` : '<span class="new-pill">Nuevo</span>'}
                ${distanceHtml}
              </div>
              ${nextHtml}
            </div>
            <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
              <span class="badge">${esc(b.category)}</span>
              ${urgencyHtml}
              <div style="display:flex;gap:6px">
                <button type="button" class="fav-toggle" data-share="${b.id}" title="Compartir" aria-label="Copiar link de ${esc(b.name)}">🔗</button>
                <button type="button" class="fav-toggle ${isFavorite ? "active" : ""}" data-fav="${b.id}" title="Favorito" aria-label="Favorito: ${esc(b.name)}" aria-pressed="${isFavorite}">${isFavorite ? "♥" : "♡"}</button>
              </div>
            </div>
          </div>
          ${catalogHtml}
          <div class="slot-list">${slotsHtml}</div>
          ${reviewsHtml}
        </div>`;
      })).join("");

      const freeCount = businesses.reduce((n, b) => n + b.visibleSlots.filter((s) => s.status === "available").length, 0);
      announce(single
        ? "Cupos de " + single.name + ": " + freeCount + " libre" + (freeCount === 1 ? "" : "s") + "."
        : total + " negocio" + (total === 1 ? "" : "s") + ", " + freeCount + " cupo" + (freeCount === 1 ? "" : "s") + " libre" + (freeCount === 1 ? "" : "s") + (soonOnly ? " en las próximas 2 horas." : " para " + dayLong(dayOffset) + "."));
      // Si nada cambió no se repinta: así el refresco de 20 s no cierra los desplegables ni quita el foco.
      if (html === lastListHtml) return;
      const uiState = captureUiState(list);
      list.innerHTML = html;
      lastListHtml = html;
      restoreUiState(list, uiState);
      wireListActions(list);

      list.querySelectorAll(".slot.available").forEach((el) => {
        const go = () => startBooking(el.dataset.business, el.dataset.slot);
        el.addEventListener("click", go);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            go();
          }
        });
      });

      list.querySelectorAll(".fav-toggle[data-fav]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (isGuest) {
            showToast(favoritesBlockedMessage());
            return;
          }
          const businessId = btn.dataset.fav;
          const result = await DataStore.toggleFavorite(client.id, businessId);
          if (result.ok) {
            const idx = client.favoriteBusinessIds.indexOf(businessId);
            if (result.favorited && idx === -1) client.favoriteBusinessIds.push(businessId);
            if (!result.favorited && idx !== -1) client.favoriteBusinessIds.splice(idx, 1);
            showToast(result.favorited ? "Agregado a favoritos." : "Quitado de favoritos.");
            await renderBusinesses({ silent: true });
          }
        });
      });

      // Compartir: copia un link directo a este negocio (?negocio=ID) — igual
      // que "compartir este lugar" en OpenTable/Booksy.
      list.querySelectorAll("[data-share]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          const url = CupoShare.bookingLink(btn.dataset.share);
          const copied = await CupoShare.copyText(url);
          // Sin portapapeles (navegador viejo o sin permiso) el link queda visible más tiempo para copiarlo a mano.
          if (copied) showToast("Link copiado.");
          else showToast("Copia este link: " + url, 9000);
        });
      });

      list.querySelectorAll("[data-review-business]").forEach((btn) => {
        btn.addEventListener("click", () => openReview(btn.dataset.reviewBusiness, btn.dataset.reviewName));
      });
    } catch (err) {
      console.error("renderBusinesses failed:", err);
      // Silencioso (buscador, refresco de fondo, justo después de una acción
      // que ya tuvo su propio toast) no molesta con un toast por cada fallo
      // — si el problema sigue, la próxima acción explícita sí avisa.
      if (!businessListEl.querySelector(".biz-card, .empty-state, .next-hint, .list-notice, .fatal-inline")) {
        // Antes se quedaba el esqueleto gris para siempre; ahora hay mensaje y salida.
        lastListHtml = null;
        businessListEl.innerHTML = '<div class="fatal-inline" role="alert"><p>No pudimos cargar los cupos. Revisa tu conexión e inténtalo de nuevo.</p><button type="button" class="btn btn-primary" data-retry>Reintentar</button></div>';
        wireListActions(businessListEl);
      }
      if (!silent) showToast("No se pudo actualizar. Revisa tu conexión.");
    } finally {
      businessListEl.classList.remove("loading");
      businessListEl.removeAttribute("aria-busy");
    }
  }

  // Tarjeta sin cupos ese día. Si el negocio ni siquiera tiene cupos publicados, se dice y se ofrece contactarlo
  // (antes: "Sin horarios publicados para este día" sin salida).
  function emptySlotsHtml(b) {
    if (b.nextSlot) return '<span style="color:var(--gray);font-size:13.5px">Sin horarios publicados para este día</span>';
    const phone = b.phone;
    const wa = phone ? CupoContact.whatsappUrl("+52", phone, "Hola, vi tu negocio en CUPO. ¿Tienes algún espacio disponible? ") : null;
    const tel = phone ? CupoContact.telUrl("+52", phone) : null;
    return '<div class="slots-none"><span style="color:var(--gray);font-size:13.5px">Este negocio no tiene cupos publicados por ahora.' + (wa ? " Puedes escribirle:" : "") + "</span>" +
      (wa ? `<span class="slots-none-actions"><a class="btn btn-outline btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a><a class="btn btn-outline btn-sm" href="${esc(tel)}">📞 Llamar</a></span>` : "") + "</div>";
  }

  // Una tarjeta con datos raros (un negocio puede haber guardado cualquier cosa) ya no tumba
  // la lista completa: esa tarjeta se omite y las demás se pintan.
  function safeCard(b, build) {
    try {
      return build();
    } catch (err) {
      console.error("Tarjeta omitida por datos inválidos:", b && b.id, err);
      return "";
    }
  }

  // ── Reservar ─────────────────────────────────────────────────────────────
  async function startBooking(businessId, slotId) {
    if (roleMismatch) {
      showToast("Tienes la sesión de un negocio abierta. Para reservar, cierra sesión y entra como cliente.");
      return;
    }
    if (isGuest) {
      window.location.href = bookingAuthUrl(businessId, slotId);
      return;
    }
    let business;
    try {
      business = await DataStore.getBusinessById(businessId);
    } catch (err) {
      console.error("No se pudo cargar el cupo:", err);
      showToast("No se pudo cargar el cupo. Revisa tu conexión e intenta de nuevo.");
      return;
    }
    const slot = business && business.slots.find((s) => s.id === slotId);
    const options = slot && slot.status === "available" && slot.time > Date.now() ? CupoSchedule.slotOptions(business, slot) : [];
    if (!options.length) {
      showToast("Ese cupo ya no está disponible.");
      await renderBusinesses({ silent: true });
      return;
    }
    // Con varios servicios el cliente elige en el modal; con uno solo
    // (cupo normal, o flexible con un único servicio) va directo.
    const choose = options.length > 1;
    const only = options[0];
    const where = `${business.name} · ${dayWord(slot.time)} ${slot.label} (${slot.duration} min)${slot.staffName ? " · con " + slot.staffName : ""}`;
    openConfirm(
      "Confirmar reserva",
      choose
        ? `${where}. Elige tu servicio y confirma tu reserva.`
        : `${where} · ${only.name ? only.name + " · " : ""}$${only.price}. ¿Confirmas tu reserva?`,
      async () => {
        const chosen = choose ? options.find((o) => o.name === confirmService.value) || only : only;
        // expectedPrice: el precio que el cliente vio; si el negocio lo cambió mientras decidía, se rechaza.
        const result = await DataStore.bookSlot(businessId, slotId, client, slot.flexible ? { service: chosen.name, expectedPrice: chosen.price } : { expectedPrice: chosen.price });
        if (!result.ok) {
          showToast(result.error);
          // Alguien más pudo haberse quedado con el cupo justo antes —
          // refresca para que deje de verse "disponible" y el cliente
          // no vuelva a intentar reservar algo que ya no existe.
          await renderBusinesses({ silent: true });
        } else {
          folioText.innerHTML = `<strong>Folio: ${esc(result.folio)}</strong><br>${esc(business.name)} · ${esc(dayWord(slot.time))} ${slot.label}${chosen.name ? " · " + esc(chosen.name) : ""}.<br>${business.address ? "📍 " + esc(business.address) + "<br>" : ""}Muestra este folio al llegar. Pagas en el negocio. Encuentras tu cita, cómo llegar y el botón para agregarla a tu calendario en “Mis reservas”.`;
          folioModal.classList.add("show");
          await renderBusinesses({ silent: true });
          await renderReservations();
        }
      },
      true,
      choose ? options : null,
      cancelPolicyText(business.cancelHours)
    );
  }

  // ── Reseñas ──────────────────────────────────────────────────────────────
  function openReview(businessId, name) {
    reviewBusinessId = businessId;
    reviewBusinessName.textContent = name;
    reviewStars = 0;
    reviewComment.value = "";
    reviewPhotoInput.value = "";
    updateStarPicker();
    reviewModal.classList.add("show");
  }

  function updateStarPicker() {
    starPicker.querySelectorAll("button").forEach((b) => {
      const active = parseInt(b.dataset.star, 10) <= reviewStars;
      b.classList.toggle("active", active);
      b.setAttribute("aria-pressed", active);
    });
  }

  starPicker.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      reviewStars = parseInt(b.dataset.star, 10);
      updateStarPicker();
    });
  });

  function closeReview() {
    reviewModal.classList.remove("show");
  }
  document.getElementById("cancelReviewBtn").addEventListener("click", closeReview);
  document.getElementById("closeReviewBtn").addEventListener("click", closeReview);
  CupoUI.overlayClose(reviewModal, closeReview);

  const submitReviewBtn = document.getElementById("submitReviewBtn");
  submitReviewBtn.addEventListener("click", async () => {
    if (!reviewStars) {
      showToast("Selecciona una calificación.");
      return;
    }
    submitReviewBtn.disabled = true;
    let photoUrl = null;
    const photoFile = reviewPhotoInput.files[0];
    if (photoFile) {
      const upload = await DataStore.uploadPhoto(client.id, photoFile, "review");
      if (!upload.ok) {
        submitReviewBtn.disabled = false;
        showToast(upload.error);
        return;
      }
      photoUrl = upload.url;
    }
    const result = await DataStore.addReview(reviewBusinessId, client.id, { rating: reviewStars, comment: reviewComment.value, photoUrl });
    submitReviewBtn.disabled = false;
    if (!result.ok) {
      // El modal sigue abierto: antes se cerraba y se perdía el comentario escrito.
      showToast(result.error);
      return;
    }
    closeReview();
    showToast("¡Gracias por tu reseña!");
    await renderBusinesses({ silent: true });
  });

  // ── Mis reservas ─────────────────────────────────────────────────────────
  // Lleva al cliente a la tarjeta de un negocio (para "Reagendar" y "Reservar
  // de nuevo"): limpia cualquier filtro que pueda esconderla y la resalta.
  async function focusBusiness(name, businessId, day) {
    resetAllFilters();
    // Vista de ese negocio solo (con "Ver más negocios"): antes dejaba la búsqueda por nombre
    // escrita en un campo que quedaba fuera de pantalla.
    singleMode = true;
    targetBusinessId = businessId;
    dayOffset = Number.isInteger(day) && day >= 0 && day <= MAX_DAY ? day : 0;
    renderDayTabs();
    await renderBusinesses();
    const card = document.querySelector(`.biz-card[data-business-id="${CSS.escape(businessId)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      card.classList.add("highlight");
      setTimeout(() => card.classList.remove("highlight"), 2500);
    }
  }

  function reservationHtml(r, biz, now, upcoming) {
    const time = r.time || 0;
    const when = time ? `${dayWord(time)} · ${r.label}` : r.label;
    const phone = biz && biz.phone;
    const wa = phone ? CupoContact.whatsappUrl("+52", phone, `Hola, tengo una cita en ${r.businessName} (${when}, folio ${r.folio || "—"}). `) : null;
    const tel = phone ? CupoContact.telUrl("+52", phone) : null;
    // La dirección vigente del negocio manda (si la cambió, "Cómo llegar" no debe apuntar a la vieja).
    const addr = (biz && biz.address) || r.address || "";
    const maps = CupoContact.mapsUrl(r.businessName, addr);
    const cancelHours = biz ? biz.cancelHours : 1;
    const cancelable = upcoming && time && time - (Number.isFinite(cancelHours) ? cancelHours : 1) * 3600000 > now;
    const data = `data-business="${esc(r.businessId || "")}" data-slot="${esc(r.slotId)}" data-reservation="${esc(r.reservationId || "")}" data-name="${esc(r.businessName)}" data-label="${esc(when)}"`;
    const sub = [r.service ? esc(r.service) : null, r.staffName ? "con " + esc(r.staffName) : null, r.duration ? r.duration + " min" : null].filter(Boolean).join(" · ");
    const actions = upcoming
      ? `<a class="btn btn-outline btn-sm" href="${esc(maps)}" target="_blank" rel="noopener">📍 Cómo llegar</a>
         ${wa ? `<a class="btn btn-outline btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
         ${tel ? `<a class="btn btn-outline btn-sm" href="${esc(tel)}">📞 Llamar</a>` : ""}
         ${time ? `<button type="button" class="btn btn-outline btn-sm" data-ics ${data}>📅 Calendario</button>` : ""}
         ${cancelable ? `<button type="button" class="btn btn-outline btn-sm" data-resched ${data}>🔄 Reagendar</button>
         <button type="button" class="btn-link-danger" ${data}>Cancelar</button>` : ""}`
      : `<button type="button" class="btn btn-outline btn-sm" data-again ${data}>🔁 Reservar de nuevo</button>
         <button type="button" class="btn btn-outline btn-sm" data-rate ${data}>⭐ Calificar</button>`;
    const note = upcoming && !cancelable && time
      ? `<p class="res-note">Ya no se puede cancelar desde la app (faltan menos de ${Number.isFinite(cancelHours) ? cancelHours : 1} h).${phone ? " Escríbele o llámale al negocio." : " Contacta al negocio."}</p>`
      : "";
    return `<div class="reservation-row res-card ${upcoming ? "" : "past"}">
      <div class="res-top">
        <div class="res-info">
          <span class="res-when">${esc(when)}${upcoming ? "" : " · pasada"}</span>
          <span class="res-title">${esc(r.businessName)}</span>
          ${sub ? `<span class="res-sub">${sub}</span>` : ""}
          ${addr ? `<span class="res-sub">📍 ${esc(addr)}</span>` : ""}
          ${r.folio ? `<span class="review-author">Folio: ${esc(r.folio)}</span>` : ""}
        </div>
        <div class="res-price"><strong>$${r.price}</strong></div>
      </div>
      <div class="res-actions">${actions}</div>
      ${note}
    </div>`;
  }

  let lastReservationsHtml = null;
  async function renderReservations() {
    if (isGuest) return;
    const el = document.getElementById("reservationsList");
    let fresh;
    try {
      fresh = await DataStore.getClientById(session.id);
    } catch (err) {
      console.error("renderReservations failed:", err);
      return; // deja la lista anterior en pantalla en vez de borrarla
    }
    const reservations = fresh ? fresh.reservations : [];
    if (!reservations.length) {
      updateReservasBadge(0);
      lastReservationsHtml = null;
      el.innerHTML = '<div class="empty-state">Todavía no tienes reservas. Elige un cupo arriba y aparecerá aquí con todo lo que necesitas para llegar.</div>';
      return;
    }

    const now = Date.now();
    // Datos del negocio (teléfono, política de cancelación) de las citas que
    // todavía importan; las pasadas solo necesitan lo que ya traen.
    const bizCache = new Map();
    const needsBiz = reservations.filter((r) => !r.time || r.time + (r.duration || 45) * 60000 > now);
    const ids = Array.from(new Set(needsBiz.map((r) => r.businessId).filter(Boolean)));
    try {
      await Promise.all(ids.map(async (id) => {
        const b = await DataStore.getBusinessById(id);
        if (b) bizCache.set(id, b);
      }));
    } catch (err) {
      console.error("business lookup failed:", err);
    }

    // Reservas viejas guardadas sin hora: se completa con la del cupo.
    const withTime = reservations.map((r) => {
      if (r.time) return r;
      const b = bizCache.get(r.businessId);
      const slot = b && b.slots.find((s) => s.id === r.slotId);
      return slot ? { ...r, time: slot.time } : r;
    });
    const isUpcoming = (r) => !r.time ? false : r.time + (r.duration || 45) * 60000 > now;
    const upcoming = withTime.filter(isUpcoming).sort((a, b) => a.time - b.time);
    const past = withTime.filter((r) => !isUpcoming(r)).sort((a, b) => (b.time || 0) - (a.time || 0));
    updateReservasBadge(upcoming.length);

    const resHtml =
      (upcoming.length
        ? `<h3 class="res-heading">Próximas (${upcoming.length})</h3>` + upcoming.map((r) => reservationHtml(r, bizCache.get(r.businessId), now, true)).join("")
        : '<div class="empty-state">No tienes citas próximas.</div>')
      + (past.length
        ? `<details class="res-history"><summary>Historial (${past.length})</summary>${past.map((r) => reservationHtml(r, bizCache.get(r.businessId), now, false)).join("")}</details>`
        : "");
    // Si nada cambió no se repinta (así el refresco automático no cierra el historial abierto).
    if (resHtml === lastReservationsHtml) return;
    const historyWasOpen = !!(el.querySelector(".res-history") && el.querySelector(".res-history").open);
    el.innerHTML = resHtml;
    lastReservationsHtml = resHtml;
    if (historyWasOpen && el.querySelector(".res-history")) el.querySelector(".res-history").open = true;

    const dataOf = (btn) => ({
      businessId: btn.dataset.business,
      slotId: btn.dataset.slot,
      reservationId: btn.dataset.reservation,
      name: btn.dataset.name,
      label: btn.dataset.label,
    });

    async function cancelFlow(d, { thenReschedule }) {
      const old = withTime.find((x) => x.slotId === d.slotId);
      d.dayOffsetOfOld = old && old.time ? Math.round((DataStore.startOfDay(old.time) - DataStore.startOfDay(Date.now())) / DAY_MS) : 0;
      const text = thenReschedule
        ? `Vamos a cancelar tu cita en ${d.name} (${d.label}) y te mostramos otros horarios del mismo negocio. ¿Continuar?`
        : `¿Seguro que quieres cancelar tu reserva en ${d.name} (${d.label})? El cupo se liberará para otros clientes.`;
      openConfirm(thenReschedule ? "Reagendar cita" : "Cancelar reserva", text, async () => {
        const result = await DataStore.cancelReservation(client.id, d.businessId, d.slotId, d.reservationId);
        if (result && result.ok === false) {
          showToast(result.error || "No se pudo cancelar. Intenta de nuevo.");
          await renderReservations();
          return;
        }
        showToast(thenReschedule ? "Cita cancelada. Elige un nuevo horario." : "Reserva cancelada.");
        await renderReservations();
        if (thenReschedule) await focusBusiness(d.name, d.businessId, d.dayOffsetOfOld);
        else await renderBusinesses({ silent: true });
      }, false);
    }

    el.querySelectorAll(".btn-link-danger").forEach((btn) => btn.addEventListener("click", () => cancelFlow(dataOf(btn), { thenReschedule: false })));
    el.querySelectorAll("[data-resched]").forEach((btn) => btn.addEventListener("click", () => cancelFlow(dataOf(btn), { thenReschedule: true })));
    el.querySelectorAll("[data-again]").forEach((btn) => btn.addEventListener("click", () => focusBusiness(btn.dataset.name, btn.dataset.business)));
    el.querySelectorAll("[data-rate]").forEach((btn) => btn.addEventListener("click", () => openReview(btn.dataset.business, btn.dataset.name)));
    el.querySelectorAll("[data-ics]").forEach((btn) => btn.addEventListener("click", () => {
      const r = withTime.find((x) => x.slotId === btn.dataset.slot);
      if (!r || !r.time) return;
      const biz = bizCache.get(r.businessId);
      CupoContact.downloadIcs("cupo-" + (r.folio || "cita") + ".ics", CupoContact.icsContent({
        uid: r.folio || r.slotId,
        start: r.time,
        durationMin: r.duration,
        title: "Cita en " + r.businessName + (r.service ? " — " + r.service : ""),
        location: [r.businessName, (biz && biz.address) || r.address].filter(Boolean).join(", "),
        description: (r.folio ? "Folio " + r.folio + ". " : "") + "Pagas en el negocio.",
      }));
    }));
  }

  function closeConfirm() {
    pendingAction = null;
    confirmModal.classList.remove("show");
  }
  document.getElementById("cancelBookBtn").addEventListener("click", closeConfirm);
  document.getElementById("closeConfirmBtn").addEventListener("click", closeConfirm);
  CupoUI.overlayClose(confirmModal, closeConfirm);

  const confirmBookBtn = document.getElementById("confirmBookBtn");
  confirmBookBtn.addEventListener("click", async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    pendingAction = null;
    confirmModal.classList.remove("show");
    confirmBookBtn.disabled = true;
    await action();
    confirmBookBtn.disabled = false;
  });

  function closeFolio() {
    folioModal.classList.remove("show");
  }
  document.getElementById("folioOkBtn").addEventListener("click", closeFolio);
  document.getElementById("folioReservasBtn").addEventListener("click", () => {
    closeFolio();
    const section = document.getElementById("reservationsSection");
    section.scrollIntoView({ behavior: "smooth", block: "start" });
    const heading = section.querySelector("h2");
    // Se espera a que el modal termine de cerrar: ui.js regresa el foco a quien lo abrió.
    if (heading) setTimeout(() => { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }, 80);
  });
  // "Mis reservas" en la barra: además de bajar, el foco llega al título (antes se quedaba en el enlace).
  const navReservasEl = document.getElementById("navReservas");
  if (navReservasEl) navReservasEl.addEventListener("click", () => {
    const heading = document.querySelector("#reservationsSection h2");
    if (heading) setTimeout(() => { heading.setAttribute("tabindex", "-1"); heading.focus({ preventScroll: true }); }, 60);
  });
  document.getElementById("closeFolioBtn").addEventListener("click", closeFolio);
  CupoUI.overlayClose(folioModal, closeFolio);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeConfirm(); closeFolio(); closeReview(); }
  });

  // Un link compartido (?negocio=ID) lleva a esa tarjeta; con ?slot=ID (el
  // camino de un visitante que eligió un cupo y acaba de entrar) además abre
  // directo la confirmación de ese cupo.
  // (params / targetBusinessId / targetSlotId / singleMode se declaran arriba, con el resto del estado.)

  // Rutas con filtros por URL: cliente.html?categoria=Barbería&cuando=pronto&dia=1&q=corte&descuento=1
  // (el landing enlaza directo a una vista ya filtrada; y cualquier vista se puede compartir).
  // Los valores se leen sin importar mayúsculas ni acentos ("PRONTO", "Mañana").
  let explicitDay = false;
  if (!singleMode) {
    const wanted = params.get("categoria");
    if (wanted) {
      const match = (DataStore.AREAS.find((a) => a.id === activeArea) || { categories: [] }).categories
        .find((c) => CupoValidate.fold(c) === CupoValidate.fold(wanted));
      if (match) activeCategory = match;
    }
    if (CupoValidate.fold(params.get("cuando") || "") === "pronto") {
      explicitDay = true;
      setSoonOnly(true);
    } else {
      const dia = CupoValidate.fold(params.get("dia") || "");
      if (dia === "manana") { dayOffset = 1; explicitDay = true; }
      else if (/^\d{1,2}$/.test(dia) && parseInt(dia, 10) <= MAX_DAY) { dayOffset = parseInt(dia, 10); explicitDay = true; }
    }
    const q = (params.get("q") || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 80);
    if (q) {
      searchInput.value = q;
      searchTerm = CupoValidate.fold(q);
    }
    if (params.get("descuento") === "1") setDiscountOnly(true);
  } else {
    // En la vista de un negocio solo cuenta el día.
    const dia = CupoValidate.fold(params.get("dia") || "");
    if (dia === "manana") { dayOffset = 1; explicitDay = true; }
    else if (/^\d{1,2}$/.test(dia) && parseInt(dia, 10) <= MAX_DAY) { dayOffset = parseInt(dia, 10); explicitDay = true; }
  }

  renderAreaTabs();
  renderDayTabs();
  renderCategoryChips();
  renderServiceOptions();
  if (!singleMode) {
    // Servicio y horario de la URL: solo si existen en las opciones de esta categoría.
    const svc = params.get("servicio");
    if (svc && Array.from(serviceFilterEl.options).some((o) => o.value === svc)) { serviceFilterEl.value = svc; serviceFilter = svc; }
    const hor = params.get("horario");
    if (hor && HORARIO_RANGES[hor]) { horarioFilterEl.value = hor; horarioFilter = hor; }
  }

  // Si traen un cupo elegido, se abre en el día de ese cupo (hasta 4 semanas adelante).
  let bookAfterLoad = null;
  let highlightSlotId = null;
  if (targetBusinessId && targetSlotId) {
    try {
      const b = await DataStore.getBusinessById(targetBusinessId);
      const slot = b && b.slots.find((s) => s.id === targetSlotId);
      if (slot && slot.time > Date.now()) {
        const offset = Math.round((DataStore.startOfDay(slot.time) - DataStore.startOfDay(Date.now())) / DAY_MS);
        if (offset >= 0 && offset <= MAX_DAY) {
          dayOffset = offset;
          explicitDay = true;
          renderDayTabs();
        }
        if (isGuest || roleMismatch) highlightSlotId = targetSlotId;
        else bookAfterLoad = { businessId: targetBusinessId, slotId: targetSlotId };
      } else if (b) {
        showToast("Ese cupo ya no está disponible. Mira los otros horarios del negocio.");
      } // si el negocio no existe, la propia lista avisa "No encontramos ese negocio"
    } catch (err) {
      // Un link roto o truncado (id inválido) llega aquí: la lista lo avisa, la consola guarda el detalle.
      console.error("deep link slot lookup failed:", err);
    }
  }

  await renderBusinesses();
  await renderReservations();

  // Hoy ya no queda nada: en vez de dejar una pantalla vacía, se muestra el día más cercano con cupos
  // (en un link de un negocio, el día de SU próximo cupo).
  if (!explicitDay && !soonOnly && dayOffset === 0 && lastNextDayHint && lastNextDayHint.offset > 0) {
    const hint = lastNextDayHint;
    dayOffset = hint.offset;
    renderDayTabs();
    showToast("Hoy ya no hay cupos libres: te mostramos " + dayPhrase(hint.offset) + ".");
    await renderBusinesses();
  }

  if (highlightSlotId) {
    const chip = document.querySelector(`.slot[data-slot="${CSS.escape(highlightSlotId)}"]`);
    if (chip && chip.classList.contains("available")) {
      chip.scrollIntoView({ behavior: "smooth", block: "center" });
      chip.classList.add("highlight");
      showToast(roleMismatch ? "Este cupo te esperaba, pero tienes la sesión de un negocio." : "Toca el cupo para reservarlo: te pedimos una cuenta rápida y regresas aquí.");
    } else {
      showToast("Ese cupo ya no está disponible. Mira los otros horarios del negocio.");
    }
  }

  if (targetBusinessId) {
    const card = document.querySelector(`.biz-card[data-business-id="${CSS.escape(targetBusinessId)}"]`);
    if (card) {
      // La vista ya es de este negocio solo: no hay que bajar a buscarlo; se resalta un momento para orientar.
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      card.classList.add("highlight");
      setTimeout(() => card.classList.remove("highlight"), 3500);
    }
  }
  if (bookAfterLoad) {
    // Se limpia la URL para que recargar la página no vuelva a abrir el modal.
    history.replaceState(null, "", location.pathname + "?negocio=" + encodeURIComponent(bookAfterLoad.businessId));
    await startBooking(bookAfterLoad.businessId, bookAfterLoad.slotId);
  }

  // Auto-refresh silencioso: en una plataforma de "último momento" un cupo
  // puede desaparecer o aparecer en cualquier momento, y nadie debería tener
  // que recargar la página a mano para enterarse (así lo hacen Uber/DoorDash
  // con su inventario en vivo). Se salta el ciclo si hay un modal abierto o
  // si el cliente está escribiendo en el buscador, para no interrumpirlo.
  let refreshing = false; // si el servidor tarda, no se acumulan peticiones en paralelo
  let lastDayKey = CupoSchedule.dateKey(Date.now());
  setInterval(async () => {
    if (document.hidden || refreshing) return;
    if ([confirmModal, folioModal, reviewModal].some((m) => m.classList.contains("show"))) return;
    if (document.activeElement === searchInput) return;
    refreshing = true;
    try {
      // Con la página abierta toda la noche, "Hoy"/"Mañana" deben cambiar de día.
      const today = CupoSchedule.dateKey(Date.now());
      if (today !== lastDayKey) {
        lastDayKey = today;
        // Pasó la medianoche: "Mañana" ahora es "Hoy". Se conserva la MISMA fecha que se estaba viendo
        // (antes la pestaña seguía igual y de pronto mostraba otro día sin avisar).
        if (dayOffset > 0 && !soonOnly) {
          dayOffset -= 1;
          showToast("Pasó la medianoche: actualizamos los días.");
        }
        renderDayTabs();
      }
      await renderBusinesses({ silent: true });
      await renderReservations(); // una cita cancelada por el negocio, o que ya pasó, se actualiza sola
    } finally {
      refreshing = false;
    }
  }, 20000);
})();
