(async function () {
  const session = await DataStore.getSession();
  if (!session || session.role !== "cliente") {
    window.location.href = "auth.html?mode=login&role=cliente";
    return;
  }

  const client = await DataStore.getClientById(session.id);
  if (!client) {
    await DataStore.clearSession();
    window.location.href = "auth.html?mode=login&role=cliente";
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

  function renderDayTabs() {
    const labels = ["Hoy", "Mañana"];
    const html = [];
    for (let i = 0; i <= 6; i++) {
      let label = labels[i];
      if (!label) {
        const d = new Date(Date.now() + i * DAY_MS);
        label = d.toLocaleDateString("es-MX", { weekday: "short" }).replace(/^\w/, (c) => c.toUpperCase());
      }
      html.push(`<button class="day-tab ${i === dayOffset ? "active" : ""}" data-day="${i}">${label}</button>`);
    }
    dayTabsEl.innerHTML = html.join("");
    dayTabsEl.querySelectorAll(".day-tab").forEach((btn) => {
      btn.addEventListener("click", async () => {
        dayOffset = parseInt(btn.dataset.day, 10);
        renderDayTabs();
        await renderBusinesses();
      });
    });
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
    await renderBusinesses();
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

  async function renderBusinesses() {
    const area = DataStore.AREAS.find((a) => a.id === activeArea);
    if (!area || area.comingSoon) return;

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
      const slotsHtml = slotsForDay.length
        ? slotsForDay.map((s) => {
            const cls = s.status === "available" ? "available" : "booked";
            const priceHtml = s.originalPrice
              ? `<span class="price"><s>$${s.originalPrice}</s> $${s.price} <span class="discount-badge">-${s.discountPct}%</span></span>`
              : `<span class="price">$${s.price}${s.status === "booked" ? " · ocupado" : ""}</span>`;
            return `<div class="slot ${cls}" data-business="${b.id}" data-slot="${s.id}">
              <span class="time">${s.label}</span>
              ${s.service ? `<span class="price">${s.service}</span>` : ""}
              <span class="price">${s.duration} min</span>
              ${s.staffName ? `<span class="price">con ${s.staffName}</span>` : ""}
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
        ? `<div class="photo-gallery" data-fallback-emoji="${photo.emoji}" data-fallback-css="${photo.css.replace(/"/g, "&quot;")}">${b.photos.slice(0, 5).map((url) => `<img src="${url}" alt="Foto de ${b.name}" onerror="window.__cupoPhotoError(this)">`).join("")}</div>`
        : `<div class="biz-photo" style="background:${photo.css}"><span class="photo-icon">${photo.emoji}</span></div>`;

      const catalogHtml = b.servicesCatalog && b.servicesCatalog.length
        ? `<details class="catalog-details">
            <summary>Servicios y precios (${b.servicesCatalog.length})</summary>
            ${b.servicesCatalog.map((s) => `<div class="catalog-row"><span>${s.name}</span><span>$${s.price}</span></div>`).join("")}
          </details>`
        : "";

      const recentReviews = (b.reviews || []).slice(0, 2);
      const reviewsHtml = `<details class="catalog-details">
          <summary>★ ${rating.value.toFixed(1)} (${rating.count} reseña${rating.count === 1 ? "" : "s"})</summary>
          ${recentReviews.length ? recentReviews.map((r) => `<div class="review-row"><strong>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</strong> ${r.comment ? "— " + r.comment : ""} <span class="review-author">· ${r.clientName}</span></div>`).join("") : '<div class="review-row" style="color:var(--gray)">Sin reseñas todavía.</div>'}
          ${eligibleForReview ? `<button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" data-review-business="${b.id}" data-review-name="${b.name}">Dejar reseña</button>` : ""}
        </details>`;

      return `<div class="biz-card">
        ${photoHtml}
        <div class="biz-head">
          <div>
            <p class="biz-name">${b.name}</p>
            <div class="biz-meta">
              <span>${b.address}</span>
              <span>★ ${rating.value.toFixed(1)}</span>
              ${distanceHtml}
            </div>
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
            <span class="badge">${b.category}</span>
            <button type="button" class="fav-toggle ${isFavorite ? "active" : ""}" data-fav="${b.id}" title="Favorito">${isFavorite ? "♥" : "♡"}</button>
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
            } else {
              folioText.innerHTML = `<strong>Folio: ${result.folio}</strong><br>${business.name} · ${slot.label}${slot.service ? " · " + slot.service : ""}.<br>Muestra este folio al llegar. Pagas en el negocio.`;
              folioModal.classList.add("show");
              await renderBusinesses();
              await renderReservations();
            }
          },
          true
        );
      });
    });

    list.querySelectorAll(".fav-toggle").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const businessId = btn.dataset.fav;
        const result = await DataStore.toggleFavorite(client.id, businessId);
        if (result.ok) {
          const idx = client.favoriteBusinessIds.indexOf(businessId);
          if (result.favorited && idx === -1) client.favoriteBusinessIds.push(businessId);
          if (!result.favorited && idx !== -1) client.favoriteBusinessIds.splice(idx, 1);
          showToast(result.favorited ? "Agregado a favoritos." : "Quitado de favoritos.");
          await renderBusinesses();
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
  }

  function updateStarPicker() {
    starPicker.querySelectorAll("button").forEach((b) => {
      b.classList.toggle("active", parseInt(b.dataset.star, 10) <= reviewStars);
    });
  }

  starPicker.querySelectorAll("button").forEach((b) => {
    b.addEventListener("click", () => {
      reviewStars = parseInt(b.dataset.star, 10);
      updateStarPicker();
    });
  });

  document.getElementById("cancelReviewBtn").addEventListener("click", () => {
    reviewModal.classList.remove("show");
  });

  document.getElementById("submitReviewBtn").addEventListener("click", async () => {
    if (!reviewStars) {
      showToast("Selecciona una calificación.");
      return;
    }
    const result = await DataStore.addReview(reviewBusinessId, client.id, { rating: reviewStars, comment: reviewComment.value });
    reviewModal.classList.remove("show");
    if (!result.ok) {
      showToast(result.error);
    } else {
      showToast("¡Gracias por tu reseña!");
      await renderBusinesses();
    }
  });

  async function renderReservations() {
    const el = document.getElementById("reservationsList");
    const fresh = await DataStore.getClientById(session.id);
    const reservations = fresh ? fresh.reservations : [];
    if (!reservations.length) {
      el.innerHTML = '<div class="empty-state">Todavía no tienes reservas.</div>';
      return;
    }
    el.innerHTML = '<div class="biz-card">' + reservations.map((r) =>
      `<div class="reservation-row">
        <div class="res-info">
          <span>${r.businessName} · ${r.service ? r.service + " · " : ""}${r.label}${r.staffName ? " · con " + r.staffName : ""}</span>
          ${r.folio ? `<span class="review-author">Folio: ${r.folio}</span>` : ""}
        </div>
        <div class="res-price">
          <strong>$${r.price}</strong>
          <button type="button" class="btn-link-danger" data-business="${r.businessId || ""}" data-slot="${r.slotId}" data-reservation="${r.reservationId || ""}" data-name="${r.businessName}" data-label="${r.label}">Cancelar</button>
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
            await renderBusinesses();
            await renderReservations();
          },
          false
        );
      });
    });
  }

  document.getElementById("cancelBookBtn").addEventListener("click", () => {
    pendingAction = null;
    confirmModal.classList.remove("show");
  });

  document.getElementById("confirmBookBtn").addEventListener("click", async () => {
    if (!pendingAction) return;
    const action = pendingAction;
    pendingAction = null;
    confirmModal.classList.remove("show");
    await action();
  });

  document.getElementById("folioOkBtn").addEventListener("click", () => {
    folioModal.classList.remove("show");
  });

  renderAreaTabs();
  renderDayTabs();
  renderCategoryChips();
  renderServiceOptions();
  await renderBusinesses();
  await renderReservations();
})();
