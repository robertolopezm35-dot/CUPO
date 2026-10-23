(async function () {
  // Si alguien abre un link compartido (?negocio=ID) sin sesión, que no se
  // pierda camino al login — vuelve exactamente a donde iba después de
  // entrar, igual que cualquier app con deep links.
  const loginUrl = "auth.html?mode=login&role=cliente&next=" + encodeURIComponent(location.pathname + location.search);

  const session = await DataStore.getSession();
  if (!session || session.role !== "cliente") {
    window.location.href = loginUrl;
    return;
  }

  const client = await DataStore.getClientById(session.id);
  if (!client) {
    await DataStore.clearSession();
    window.location.href = loginUrl;
    return;
  }

  document.getElementById("userName").textContent = client.name;
  document.getElementById("userAvatar").textContent = client.name.charAt(0).toUpperCase();

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await DataStore.clearSession();
    window.location.href = "index.html";
  });

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
  let reviewBusinessId = null;
  let reviewStars = 0;

  const dashTitleEl = document.getElementById("dashTitle");
  const areaTabsEl = document.getElementById("areaTabs");
  const dayTabsEl = document.getElementById("dayTabs");
  const filtersEl = document.getElementById("categoryFilters");
  const comingSoonPanel = document.getElementById("comingSoonPanel");
  const businessListEl = document.getElementById("businessList");
  const searchInput = document.getElementById("searchInput");
  const sortNearbyBtn = document.getElementById("sortNearbyBtn");
  const favoritesOnlyBtn = document.getElementById("favoritesOnlyBtn");
  const favoritesBanner = document.getElementById("favoritesBanner");
  const serviceFilterEl = document.getElementById("serviceFilter");
  const horarioFilterEl = document.getElementById("horarioFilter");
  const confirmModal = document.getElementById("confirmModal");
  const confirmTitle = document.getElementById("confirmTitle");
  const confirmText = document.getElementById("confirmText");
  const confirmPolicy = document.getElementById("confirmPolicy");
  const folioModal = document.getElementById("folioModal");
  const folioText = document.getElementById("folioText");
  const reviewModal = document.getElementById("reviewModal");
  const reviewBusinessName = document.getElementById("reviewBusinessName");
  const starPicker = document.getElementById("starPicker");
  const reviewComment = document.getElementById("reviewComment");

  const DAY_MS = 86400000;
  const HORARIO_RANGES = { morning: [8, 12], afternoon: [12, 17], evening: [17, 21] };

  function renderAreaTabs() {
    areaTabsEl.innerHTML = DataStore.AREAS.map((area) => `
      <button class="area-tab ${area.id === activeArea ? "active" : ""} ${area.comingSoon ? "coming-soon" : ""}" data-area="${area.id}">
        <span>${area.icon} ${area.name}</span>
        ${area.comingSoon ? '<span class="soon-badge">Pronto</span>' : ""}
      </button>
    `).join("");

    areaTabsEl.querySelectorAll(".area-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        activeArea = btn.dataset.area;
        activeCategory = "Todas";
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

  function renderDayTabs() {
    const html = [];
    for (let i = 0; i <= 6; i++) {
      html.push(`<button class="day-tab ${i === dayOffset ? "active" : ""}" data-day="${i}">${dayLabel(i)}</button>`);
    }
    dayTabsEl.innerHTML = html.join("");
    dayTabsEl.querySelectorAll(".day-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        dayOffset = parseInt(btn.dataset.day, 10);
        renderDayTabs();
        await renderBusinesses();
      });
    });
    dashTitleEl.textContent = dayOffset === 0
      ? "Cupos disponibles hoy"
      : `Cupos disponibles — ${dayLabel(dayOffset)}`;
  }

  function renderCategoryChips() {
    const area = DataStore.AREAS.find((a) => a.id === activeArea);
    if (!area || area.comingSoon) {
      filtersEl.hidden = true;
      businessListEl.hidden = true;
      comingSoonPanel.hidden = false;
      return;
    }
    filtersEl.hidden = false;
    businessListEl.hidden = false;
    comingSoonPanel.hidden = true;

    filtersEl.innerHTML = `<button class="chip ${activeCategory === "Todas" ? "active" : ""}" data-category="Todas">Todas</button>` +
      area.categories.map((cat) =>
        `<button class="chip ${activeCategory === cat ? "active" : ""}" data-category="${cat}">${cat}</button>`
      ).join("");

    filtersEl.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", async () => {
        activeCategory = btn.dataset.category;
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

  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
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

  function openConfirm(title, text, action, showPolicy) {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
    confirmPolicy.hidden = !showPolicy;
    pendingAction = action;
    confirmModal.classList.add("show");
  }

  sortNearbyBtn.addEventListener("click", () => {
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
        showToast("Mostrando los negocios más cercanos primero.");
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

  favoritesOnlyBtn.addEventListener("click", async () => {
    favoritesOnly = !favoritesOnly;
    favoritesOnlyBtn.textContent = favoritesOnly ? "♥ Solo favoritos" : "♡ Solo favoritos";
    favoritesOnlyBtn.classList.toggle("active", favoritesOnly);
    await renderBusinesses();
  });

  searchInput.addEventListener("input", async () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    await renderBusinesses({ silent: true }); // sin atenuado: parpadearía en cada tecla
  });

  serviceFilterEl.addEventListener("change", async () => {
    serviceFilter = serviceFilterEl.value;
    await renderBusinesses();
  });

  horarioFilterEl.addEventListener("change", async () => {
    horarioFilter = horarioFilterEl.value;
    await renderBusinesses();
  });

  async function renderFavoritesBanner() {
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

  // `silent`: sin el atenuado de carga (para no parpadear en cada tecla del
  // buscador, en el refresco de fondo, o justo después de una acción que ya
  // mostró su propio toast). Un fallo de red SIEMPRE avisa con toast y NUNCA
  // borra lo que ya se había mostrado — mejor datos viejos que una pantalla
  // en blanco sin explicación.
  async function renderBusinesses({ silent } = {}) {
    const area = DataStore.AREAS.find((a) => a.id === activeArea);
    if (!area || area.comingSoon) return;

    if (!silent) businessListEl.classList.add("loading");
    try {
      await renderFavoritesBanner();

      const list = businessListEl;
      let businesses = (await DataStore.getBusinesses()).filter((b) => area.categories.includes(b.category));
      if (activeCategory !== "Todas") {
        businesses = businesses.filter((b) => b.category === activeCategory);
      }
      if (searchTerm) {
        businesses = businesses.filter((b) => b.name.toLowerCase().includes(searchTerm));
      }
      if (favoritesOnly) {
        const favIds = client.favoriteBusinessIds || [];
        businesses = businesses.filter((b) => favIds.includes(b.id));
      }

    const dayStart = DataStore.startOfDay(Date.now() + dayOffset * DAY_MS);
    const dayEnd = dayStart + DAY_MS;
    businesses = businesses.map((b) => {
      let slots = b.slots.filter((s) => s.time >= dayStart && s.time < dayEnd);
      if (serviceFilter) slots = slots.filter((s) => s.service === serviceFilter);
      slots = slots.filter((s) => s.status !== "available" || slotMatchesHorario(s));
      return { ...b, visibleSlots: slots };
    });
    if (serviceFilter || horarioFilter) {
      businesses = businesses.filter((b) => b.visibleSlots.some((s) => s.status === "available"));
    }

    if (userLocation) {
      businesses = businesses.map((b) => ({
        ...b,
        distanceKm: DataStore.distanceKm(userLocation.lat, userLocation.lng, b.lat, b.lng),
      }));
      businesses.sort((a, b) => a.distanceKm - b.distanceKm);
    }

    if (businesses.length === 0) {
      list.innerHTML = '<div class="empty-state">No encontramos negocios con esos filtros.</div>';
      return;
    }

    list.innerHTML = businesses.map((b) => {
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
            const priceHtml = s.originalPrice
              ? `<span class="price"><s>$${s.originalPrice}</s> $${s.price} <span class="discount-badge">-${s.discountPct}%</span></span>`
              : `<span class="price">$${s.price}${s.status === "booked" ? " · ocupado" : ""}</span>`;
            return `<div class="slot ${cls}" data-business="${b.id}" data-slot="${s.id}">
              <span class="time">${s.label}</span>
              ${s.service ? `<span class="price">${esc(s.service)}</span>` : ""}
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
      const isFavorite = (client.favoriteBusinessIds || []).includes(b.id);
      const eligibleForReview = (b.sales || []).some((v) => v.clientId === client.id);

      const photoHtml = b.photos && b.photos.length
        ? `<div class="photo-gallery" data-fallback-emoji="${photo.emoji}" data-fallback-css="${photo.css.replace(/"/g, "&quot;")}">${b.photos.slice(0, 5).map((url) => `<img src="${esc(url)}" alt="Foto de ${esc(b.name)}" onerror="window.__cupoPhotoError(this)">`).join("")}</div>`
        : `<div class="biz-photo" style="background:${photo.css}"><span class="photo-icon">${photo.emoji}</span></div>`;

      const catalogHtml = b.servicesCatalog && b.servicesCatalog.length
        ? `<details class="catalog-details">
            <summary>Servicios y precios (${b.servicesCatalog.length})</summary>
            ${b.servicesCatalog.map((s) => `<div class="catalog-row"><span>${esc(s.name)}</span><span>$${s.price}</span></div>`).join("")}
          </details>`
        : "";

      const recentReviews = (b.reviews || []).slice(0, 2);
      const reviewsHtml = `<details class="catalog-details">
          <summary>★ ${rating.value.toFixed(1)} (${rating.count} reseña${rating.count === 1 ? "" : "s"})</summary>
          ${recentReviews.length ? recentReviews.map((r) => `<div class="review-row"><strong>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</strong> ${r.comment ? "— " + esc(r.comment) : ""} <span class="review-author">· ${esc(r.clientName)}</span></div>`).join("") : '<div class="review-row" style="color:var(--gray)">Sin reseñas todavía.</div>'}
          ${eligibleForReview ? `<button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" data-review-business="${b.id}" data-review-name="${esc(b.name)}">Dejar reseña</button>` : ""}
        </details>`;

      return `<div class="biz-card" data-business-id="${b.id}">
        ${photoHtml}
        <div class="biz-head">
          <div>
            <p class="biz-name">${esc(b.name)}</p>
            <div class="biz-meta">
              <span>${esc(b.address)}</span>
              <span>★ ${rating.value.toFixed(1)}</span>
              ${distanceHtml}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="badge">${esc(b.category)}</span>
            ${urgencyHtml}
            <div style="display:flex;gap:6px">
              <button type="button" class="fav-toggle" data-share="${b.id}" title="Compartir" aria-label="Copiar link de este negocio">🔗</button>
              <button type="button" class="fav-toggle ${isFavorite ? "active" : ""}" data-fav="${b.id}" title="Favorito" aria-label="${isFavorite ? "Quitar de favoritos" : "Agregar a favoritos"}" aria-pressed="${isFavorite}">${isFavorite ? "♥" : "♡"}</button>
            </div>
          </div>
        </div>
        ${catalogHtml}
        <div class="slot-list">${slotsHtml}</div>
        ${reviewsHtml}
      </div>`;
    }).join("");

    list.querySelectorAll(".slot.available").forEach((el) => {
      el.addEventListener("click", async () => {
        const businessId = el.dataset.business;
        const slotId = el.dataset.slot;
        const business = await DataStore.getBusinessById(businessId);
        const slot = business.slots.find((s) => s.id === slotId);
        openConfirm(
          "Confirmar reserva",
          `${business.name} · ${slot.service ? slot.service + " · " : ""}${slot.label} (${slot.duration} min) · $${slot.price}${slot.staffName ? " · con " + slot.staffName : ""}. ¿Confirmas tu reserva?`,
          async () => {
            const result = await DataStore.bookSlot(businessId, slotId, client);
            if (!result.ok) {
              showToast(result.error);
              // Alguien más pudo haberse quedado con el cupo justo antes —
              // refresca para que deje de verse "disponible" y el cliente
              // no vuelva a intentar reservar algo que ya no existe.
              await renderBusinesses({ silent: true });
            } else {
              folioText.innerHTML = `<strong>Folio: ${esc(result.folio)}</strong><br>${esc(business.name)} · ${slot.label}${slot.service ? " · " + esc(slot.service) : ""}.<br>Muestra este folio al llegar. Pagas en el negocio.`;
              folioModal.classList.add("show");
              await renderBusinesses({ silent: true });
              await renderReservations();
            }
          },
          true
        );
      });
    });

    list.querySelectorAll(".fav-toggle[data-fav]").forEach((btn) => {
      btn.addEventListener("click", async () => {
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
    // que "compartir este lugar" en OpenTable/Booksy. Si se abre sin sesión,
    // el login lo manda de vuelta exactamente aquí (ver arriba, next=).
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
        btn.addEventListener("click", () => {
          reviewBusinessId = btn.dataset.reviewBusiness;
          reviewBusinessName.textContent = btn.dataset.reviewName;
          reviewStars = 0;
          reviewComment.value = "";
          updateStarPicker();
          reviewModal.classList.add("show");
        });
      });
    } catch (err) {
      console.error("renderBusinesses failed:", err);
      // Silencioso (buscador, refresco de fondo, justo después de una acción
      // que ya tuvo su propio toast) no molesta con un toast por cada fallo
      // — si el problema sigue, la próxima acción explícita sí avisa.
      if (!silent) showToast("No se pudo actualizar. Revisa tu conexión.");
    } finally {
      if (!silent) businessListEl.classList.remove("loading");
    }
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
    const result = await DataStore.addReview(reviewBusinessId, client.id, { rating: reviewStars, comment: reviewComment.value });
    submitReviewBtn.disabled = false;
    closeReview();
    if (!result.ok) {
      showToast(result.error);
    } else {
      showToast("¡Gracias por tu reseña!");
      await renderBusinesses({ silent: true });
    }
  });

  async function renderReservations() {
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
      el.innerHTML = '<div class="empty-state">Todavía no tienes reservas.</div>';
      return;
    }
    el.innerHTML = '<div class="biz-card">' + reservations.map((r) =>
      `<div class="reservation-row">
        <div class="res-info">
          <span>${esc(r.businessName)} · ${r.service ? esc(r.service) + " · " : ""}${r.label}${r.staffName ? " · con " + esc(r.staffName) : ""}</span>
          ${r.folio ? `<span class="review-author">Folio: ${esc(r.folio)}</span>` : ""}
        </div>
        <div class="res-price">
          <strong>$${r.price}</strong>
          <button type="button" class="btn-link-danger" data-business="${r.businessId || ""}" data-slot="${r.slotId}" data-reservation="${r.reservationId || ""}" data-name="${esc(r.businessName)}" data-label="${esc(r.label)}">Cancelar</button>
        </div>
      </div>`
    ).join("") + '</div>';

    el.querySelectorAll(".btn-link-danger").forEach((btn) => {
      btn.addEventListener("click", () => {
        const businessId = btn.dataset.business;
        const slotId = btn.dataset.slot;
        const reservationId = btn.dataset.reservation;
        openConfirm(
          "Cancelar reserva",
          `¿Seguro que quieres cancelar tu reserva en ${btn.dataset.name} (${btn.dataset.label})? El cupo se liberará para otros clientes.`,
          async () => {
            await DataStore.cancelReservation(client.id, businessId, slotId, reservationId);
            showToast("Reserva cancelada.");
            await renderBusinesses({ silent: true });
            await renderReservations();
          },
          false
        );
      });
    });
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

  renderAreaTabs();
  renderDayTabs();
  renderCategoryChips();
  renderServiceOptions();
  await renderBusinesses();
  await renderReservations();

  // Link compartido (?negocio=ID, ver botón 🔗 en cada tarjeta): llévalo
  // directo a esa tarjeta en vez de dejarlo buscar entre las 48+ de la lista.
  const targetBusinessId = new URLSearchParams(location.search).get("negocio");
  if (targetBusinessId) {
    const card = document.querySelector(`.biz-card[data-business-id="${CSS.escape(targetBusinessId)}"]`);
    if (card) {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
      card.classList.add("highlight");
      setTimeout(() => card.classList.remove("highlight"), 2500);
    }
  }

  // Auto-refresh silencioso: en una plataforma de "último momento" un cupo
  // puede desaparecer o aparecer en cualquier momento, y nadie debería tener
  // que recargar la página a mano para enterarse (así lo hacen Uber/DoorDash
  // con su inventario en vivo). Se salta el ciclo si hay un modal abierto o
  // si el cliente está escribiendo en el buscador, para no interrumpirlo.
  setInterval(async () => {
    if (document.hidden) return;
    if ([confirmModal, folioModal, reviewModal].some((m) => m.classList.contains("show"))) return;
    if (document.activeElement === searchInput) return;
    await renderBusinesses({ silent: true });
  }, 20000);
})();
