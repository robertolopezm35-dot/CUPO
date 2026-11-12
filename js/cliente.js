(async function () {
  // Cualquiera puede mirar los cupos sin cuenta (como en Booksy/Fresha): la
  // cuenta se pide hasta el momento de reservar, y después de entrar se
  // regresa exactamente al cupo que se había elegido. Si alguien abre un
  // link compartido (?negocio=ID) y ya tiene cuenta, también llega directo.
  const here = location.pathname.split("/").pop() || "cliente.html";
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
  DataStore.watchSessionChange();

  const userBox = document.getElementById("userBox");
  const guestBox = document.getElementById("guestBox");
  if (isGuest) {
    userBox.hidden = true;
    guestBox.hidden = false;
    document.getElementById("guestLogin").href = loginUrl;
    document.getElementById("guestRegister").href = registerUrl;
    document.getElementById("reservationsSection").hidden = true;
  } else {
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
  let reviewBusinessId = null;
  let reviewStars = 0;
  const PAGE_SIZE = 12;
  let visibleCount = PAGE_SIZE;

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
  const HORARIO_RANGES = { morning: [8, 12], afternoon: [12, 17], evening: [17, 21] };
  const SOON_WINDOW_MS = 2 * 3600000;

  function resetPaging() {
    visibleCount = PAGE_SIZE;
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
        resetPaging();
        renderAreaTabs();
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
    return d.toLocaleDateString("es-MX", { weekday: "short" }).replace(/^\w/, (c) => c.toUpperCase());
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
    dashTitleEl.textContent = soonOnly
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
        resetPaging();
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
  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), msg.length > 70 ? 4200 : 2200);
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
      resetPaging();
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
        resetPaging();
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

  favoritesOnlyBtn.addEventListener("click", async () => {
    if (isGuest) {
      showToast("Inicia sesión para guardar y ver tus favoritos.");
      return;
    }
    setFavoritesOnly(!favoritesOnly);
    resetPaging();
    await renderBusinesses();
  });
  soonOnlyBtn.addEventListener("click", async () => {
    setSoonOnly(!soonOnly);
    resetPaging();
    await renderBusinesses();
  });
  discountOnlyBtn.addEventListener("click", async () => {
    setDiscountOnly(!discountOnly);
    resetPaging();
    await renderBusinesses();
  });
  moreBusinessesBtn.addEventListener("click", async () => {
    visibleCount += PAGE_SIZE;
    await renderBusinesses({ silent: true });
  });

  searchInput.addEventListener("input", async () => {
    searchTerm = CupoValidate.fold(searchInput.value.trim());
    resetPaging();
    await renderBusinesses({ silent: true }); // sin atenuado: parpadearía en cada tecla
  });

  filtersToggleBtn.addEventListener("click", () => {
    const willShow = !moreFilters.classList.contains("show");
    moreFilters.classList.toggle("show", willShow);
    filtersToggleBtn.textContent = willShow ? "✕ Cerrar filtros" : "⚙️ Filtros";
  });

  serviceFilterEl.addEventListener("change", async () => {
    serviceFilter = serviceFilterEl.value;
    resetPaging();
    await renderBusinesses();
  });

  horarioFilterEl.addEventListener("change", async () => {
    horarioFilter = horarioFilterEl.value;
    resetPaging();
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
    resetPaging();
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
  }

  async function renderBusinesses({ silent } = {}) {
    const area = DataStore.AREAS.find((a) => a.id === activeArea);
    if (!area || area.comingSoon) return;
    const mySeq = ++renderSeq;

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

      const list = businessListEl;
      const todayStart = DataStore.startOfDay(Date.now());
      let businesses = (await DataStore.getBusinesses({ slotsFrom: todayStart, slotsTo: todayStart + 8 * DAY_MS }))
        .filter((b) => area.categories.includes(b.category));
      if (mySeq !== renderSeq) return; // ya hay una consulta más nueva: esta respuesta quedó vieja
      if (activeCategory !== "Todas") {
        businesses = businesses.filter((b) => b.category === activeCategory);
      }
      if (searchTerm) {
        businesses = businesses.filter((b) => CupoValidate.fold(b.name).includes(searchTerm));
      }
      if (favoritesOnly) {
        const favIds = client.favoriteBusinessIds || [];
        businesses = businesses.filter((b) => favIds.includes(b.id));
      }

      const now = Date.now();
      // "Próximas 2 horas" ignora la pestaña del día: mira de aquí a 2 h.
      const dayStart = soonOnly ? now : DataStore.startOfDay(now + dayOffset * DAY_MS);
      const dayEnd = soonOnly ? now + SOON_WINDOW_MS : dayStart + DAY_MS;
      const dayKey = CupoSchedule.dateKey(dayStart);
      businesses = businesses.map((b) => {
        const schedule = CupoSchedule.normalize(b.schedule);
        const openOn = (s) => !CupoSchedule.isClosed(schedule, CupoSchedule.dateKey(s.time), s.staffId);
        // Nada que ya empezó (no se puede reservar el pasado), ni cupos libres
        // de un día que el negocio cerró o sin ningún servicio que ofrecer.
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
      if (serviceFilter || horarioFilter || soonOnly || discountOnly) {
        businesses = businesses.filter((b) => b.visibleSlots.some((s) => s.status === "available"));
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

      if (businesses.length === 0) {
        lastListHtml = null;
        moreBusinessesBtn.hidden = true;
        const filtered = soonOnly || discountOnly || serviceFilter || horarioFilter || searchTerm || favoritesOnly || activeCategory !== "Todas";
        list.innerHTML = `<div class="empty-state">
          <strong>${soonOnly ? "No hay cupos libres en las próximas 2 horas." : "No encontramos negocios con esos filtros."}</strong>
          <p>${soonOnly ? "Prueba con todo el día o con mañana: se publican cupos nuevos todo el tiempo." : "Prueba con otra categoría, otro día o quita algún filtro."}</p>
          ${filtered ? '<button type="button" class="btn btn-outline btn-sm" id="clearFiltersBtn">Quitar filtros</button>' : ""}
        </div>`;
        const clearBtn = document.getElementById("clearFiltersBtn");
        if (clearBtn) clearBtn.addEventListener("click", async () => { resetAllFilters(); await renderBusinesses(); });
        return;
      }

      const total = businesses.length;
      let shown = businesses.slice(0, visibleCount);
      // La tarjeta del link compartido (?negocio=ID) no debe desaparecer al cambiar de día o
      // reservar: si el orden la deja fuera de la primera página, se fija arriba.
      if (targetBusinessId && !shown.some((b) => b.id === targetBusinessId)) {
        const pinned = businesses.find((b) => b.id === targetBusinessId);
        if (pinned) shown = [pinned, ...shown.slice(0, Math.max(visibleCount - 1, 0))];
      }
      moreBusinessesBtn.hidden = shown.length >= total;
      moreBusinessesBtn.textContent = "Ver más negocios (" + (total - shown.length) + ")";

      const html = shown.map((b) => safeCard(b, () => {
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
              const amount = (s.info.from ? "desde " : "") + "$" + s.info.price;
              const priceHtml = s.info.originalPrice
                ? `<span class="price"><s>$${s.info.originalPrice}</s> ${amount} <span class="discount-badge">-${s.discountPct}%</span></span>`
                : `<span class="price">${amount}${s.status === "booked" ? " · ocupado" : ""}</span>`;
              const slotLabel = `${b.name}: ${s.label}${s.info.service ? ", " + s.info.service : ""}, ${s.duration} minutos, ${amount}`;
              return `<div class="slot ${cls}" data-business="${b.id}" data-slot="${s.id}" ${s.status === "available" ? `role="button" tabindex="0" aria-label="${esc(slotLabel)}"` : ""}>
                <span class="time">${s.label}</span>
                ${s.info.service ? `<span class="price">${esc(s.info.service)}</span>` : ""}
                <span class="price">${s.duration} min</span>
                ${s.staffName ? `<span class="price">con ${esc(s.staffName)}</span>` : ""}
                ${priceHtml}
              </div>`;
            }).join("")
          : '<span style="color:var(--gray);font-size:13.5px">Sin horarios publicados para este día</span>';

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
            <summary>★ ${rating.value.toFixed(1)} (${rating.count} reseña${rating.count === 1 ? "" : "s"})</summary>
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
                <span>★ ${rating.value.toFixed(1)}</span>
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

      // Si nada cambió no se repinta: así el refresco de 20 s no cierra los desplegables ni quita el foco.
      if (html === lastListHtml) return;
      const uiState = captureUiState(list);
      list.innerHTML = html;
      lastListHtml = html;
      restoreUiState(list, uiState);

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
            showToast("Inicia sesión para guardar tus favoritos.");
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
          const url = location.origin + location.pathname + "?negocio=" + btn.dataset.share;
          try {
            await navigator.clipboard.writeText(url);
            showToast("Link copiado.");
          } catch {
            showToast(url);
          }
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
      if (!silent) showToast("No se pudo actualizar. Revisa tu conexión.");
    } finally {
      businessListEl.classList.remove("loading");
      businessListEl.removeAttribute("aria-busy");
    }
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
  reviewModal.addEventListener("click", (e) => { if (e.target === reviewModal) closeReview(); });

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
    closeReview();
    if (!result.ok) {
      showToast(result.error);
    } else {
      showToast("¡Gracias por tu reseña!");
      await renderBusinesses({ silent: true });
    }
  });

  // ── Mis reservas ─────────────────────────────────────────────────────────
  // Lleva al cliente a la tarjeta de un negocio (para "Reagendar" y "Reservar
  // de nuevo"): limpia cualquier filtro que pueda esconderla y la resalta.
  async function focusBusiness(name, businessId, day) {
    resetAllFilters();
    dayOffset = Number.isInteger(day) && day >= 0 && day <= 6 ? day : 0;
    renderDayTabs();
    searchInput.value = name;
    searchTerm = CupoValidate.fold(name);
    await renderBusinesses();
    const card = document.querySelector(`.biz-card[data-business-id="${CSS.escape(businessId)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
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
  confirmModal.addEventListener("click", (e) => { if (e.target === confirmModal) closeConfirm(); });

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
  document.getElementById("closeFolioBtn").addEventListener("click", closeFolio);
  folioModal.addEventListener("click", (e) => { if (e.target === folioModal) closeFolio(); });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeConfirm(); closeFolio(); closeReview(); }
  });

  // Un link compartido (?negocio=ID) lleva a esa tarjeta; con ?slot=ID (el
  // camino de un visitante que eligió un cupo y acaba de entrar) además abre
  // directo la confirmación de ese cupo.
  const params = new URLSearchParams(location.search);
  const targetBusinessId = params.get("negocio");
  const targetSlotId = params.get("slot");
  if (targetBusinessId) visibleCount = 9999; // que la tarjeta señalada no quede detrás de "Ver más"

  renderAreaTabs();
  renderDayTabs();
  renderCategoryChips();
  renderServiceOptions();

  // Si traen un cupo elegido, se abre en el día de ese cupo.
  let bookAfterLoad = null;
  if (targetBusinessId && targetSlotId && !isGuest) {
    try {
      const b = await DataStore.getBusinessById(targetBusinessId);
      const slot = b && b.slots.find((s) => s.id === targetSlotId);
      if (slot && slot.time > Date.now()) {
        const offset = Math.round((DataStore.startOfDay(slot.time) - DataStore.startOfDay(Date.now())) / DAY_MS);
        if (offset >= 0 && offset <= 6) {
          dayOffset = offset;
          renderDayTabs();
        }
        bookAfterLoad = { businessId: targetBusinessId, slotId: targetSlotId };
      } else {
        showToast("Ese cupo ya no está disponible. Mira los otros horarios del negocio.");
      }
    } catch (err) {
      console.error("deep link slot lookup failed:", err);
    }
  }

  await renderBusinesses();
  await renderReservations();

  if (targetBusinessId) {
    const card = document.querySelector(`.biz-card[data-business-id="${CSS.escape(targetBusinessId)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("highlight");
      setTimeout(() => card.classList.remove("highlight"), 2500);
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
        renderDayTabs();
      }
      await renderBusinesses({ silent: true });
      await renderReservations(); // una cita cancelada por el negocio, o que ya pasó, se actualiza sola
    } finally {
      refreshing = false;
    }
  }, 20000);
})();
