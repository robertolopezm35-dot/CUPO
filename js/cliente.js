(function () {
  const session = CupoStore.getSession();
  if (!session || session.role !== "cliente") {
    window.location.href = "auth.html?mode=login&role=cliente";
    return;
  }

  const client = CupoStore.getClients().find((c) => c.id === session.id);
  if (!client) {
    CupoStore.clearSession();
    window.location.href = "auth.html?mode=login&role=cliente";
    return;
  }

  document.getElementById("userName").textContent = client.name;
  document.getElementById("userAvatar").textContent = client.name.charAt(0).toUpperCase();

  document.getElementById("logoutBtn").addEventListener("click", () => {
    CupoStore.clearSession();
    window.location.href = "index.html";
  });

  let activeArea = CupoStore.AREAS.find((a) => !a.comingSoon).id;
  let activeCategory = "Todas";
  let searchTerm = "";
  let userLocation = null;
  let pendingAction = null;

  const areaTabsEl = document.getElementById("areaTabs");
  const filtersEl = document.getElementById("categoryFilters");
  const comingSoonPanel = document.getElementById("comingSoonPanel");
  const businessListEl = document.getElementById("businessList");
  const searchInput = document.getElementById("searchInput");
  const sortNearbyBtn = document.getElementById("sortNearbyBtn");
  const confirmModal = document.getElementById("confirmModal");
  const confirmTitle = document.getElementById("confirmTitle");
  const confirmText = document.getElementById("confirmText");

  function renderAreaTabs() {
    areaTabsEl.innerHTML = CupoStore.AREAS.map((area) => `
      <button class="area-tab ${area.id === activeArea ? "active" : ""} ${area.comingSoon ? "coming-soon" : ""}" data-area="${area.id}">
        <span>${area.icon} ${area.name}</span>
        ${area.comingSoon ? '<span class="soon-badge">Pronto</span>' : ""}
      </button>
    `).join("");

    areaTabsEl.querySelectorAll(".area-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        activeArea = btn.dataset.area;
        activeCategory = "Todas";
        renderAreaTabs();
        renderCategoryChips();
        renderBusinesses();
      });
    });
  }

  function renderCategoryChips() {
    const area = CupoStore.AREAS.find((a) => a.id === activeArea);
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
      btn.addEventListener("click", () => {
        activeCategory = btn.dataset.category;
        renderCategoryChips();
        renderBusinesses();
      });
    });
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
    const v = CupoStore.CATEGORY_VISUALS[b.category] || { emoji: "✨", hue: 243 };
    const h = hashStr(b.id);
    const hue = v.hue + (h % 14) - 7;
    const l1 = 60 - (h % 8);
    const l2 = 42 - (h % 6);
    return {
      emoji: v.emoji,
      css: `linear-gradient(135deg, hsl(${hue} 70% ${l1}%), hsl(${hue + 22} 65% ${l2}%))`,
    };
  }

  function openConfirm(title, text, action) {
    confirmTitle.textContent = title;
    confirmText.textContent = text;
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
      (pos) => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        sortNearbyBtn.disabled = false;
        sortNearbyBtn.textContent = "📍 Ordenado por cercanía";
        showToast("Mostrando los negocios más cercanos primero.");
        renderBusinesses();
      },
      () => {
        sortNearbyBtn.disabled = false;
        sortNearbyBtn.textContent = "📍 Ordenar por cercanía";
        showToast("No pudimos obtener tu ubicación. Revisa los permisos del navegador.");
      },
      { timeout: 8000 }
    );
  });

  searchInput.addEventListener("input", () => {
    searchTerm = searchInput.value.trim().toLowerCase();
    renderBusinesses();
  });

  function renderBusinesses() {
    const area = CupoStore.AREAS.find((a) => a.id === activeArea);
    if (!area || area.comingSoon) return;

    const list = businessListEl;
    let businesses = CupoStore.getBusinesses().filter((b) => area.categories.includes(b.category));
    if (activeCategory !== "Todas") {
      businesses = businesses.filter((b) => b.category === activeCategory);
    }
    if (searchTerm) {
      businesses = businesses.filter((b) => b.name.toLowerCase().includes(searchTerm));
    }

    if (userLocation) {
      businesses = businesses.map((b) => ({
        ...b,
        distanceKm: CupoStore.distanceKm(userLocation.lat, userLocation.lng, b.lat, b.lng),
      }));
      businesses.sort((a, b) => a.distanceKm - b.distanceKm);
    }

    if (businesses.length === 0) {
      list.innerHTML = '<div class="empty-state">No encontramos negocios con esos filtros.</div>';
      return;
    }

    list.innerHTML = businesses.map((b) => {
      const slotsHtml = b.slots.length
        ? b.slots.map((s) => {
            const cls = s.status === "available" ? "available" : "booked";
            return `<div class="slot ${cls}" data-business="${b.id}" data-slot="${s.id}">
              <span class="time">${s.label}</span>
              <span class="price">$${s.price}${s.status === "booked" ? " · ocupado" : ""}</span>
            </div>`;
          }).join("")
        : '<span style="color:var(--gray);font-size:13.5px">Sin horarios publicados</span>';

      const photo = businessPhoto(b);
      const distanceHtml = typeof b.distanceKm === "number"
        ? `<span class="distance-pill">${b.distanceKm < 1 ? Math.round(b.distanceKm * 1000) + " m" : b.distanceKm.toFixed(1) + " km"}</span>`
        : "";

      return `<div class="biz-card">
        <div class="biz-photo" style="background:${photo.css}"><span class="photo-icon">${photo.emoji}</span></div>
        <div class="biz-head">
          <div>
            <p class="biz-name">${b.name}</p>
            <div class="biz-meta">
              <span>${b.address}</span>
              <span>★ ${b.rating}</span>
              ${distanceHtml}
            </div>
          </div>
          <span class="badge">${b.category}</span>
        </div>
        <div class="slot-list">${slotsHtml}</div>
      </div>`;
    }).join("");

    list.querySelectorAll(".slot.available").forEach((el) => {
      el.addEventListener("click", () => {
        const businessId = el.dataset.business;
        const slotId = el.dataset.slot;
        const business = CupoStore.getBusinesses().find((b) => b.id === businessId);
        const slot = business.slots.find((s) => s.id === slotId);
        openConfirm(
          "Confirmar reserva",
          `${business.name} · ${slot.label} · $${slot.price}. ¿Confirmas tu reserva?`,
          () => {
            const result = CupoStore.bookSlot(businessId, slotId, client);
            if (!result.ok) {
              showToast(result.error);
            } else {
              showToast("¡Cupo reservado con éxito!");
              renderBusinesses();
              renderReservations();
            }
          }
        );
      });
    });
  }

  function renderReservations() {
    const el = document.getElementById("reservationsList");
    const fresh = CupoStore.getClients().find((c) => c.id === session.id);
    const reservations = fresh ? fresh.reservations : [];
    if (!reservations.length) {
      el.innerHTML = '<div class="empty-state">Todavía no tienes reservas.</div>';
      return;
    }
    el.innerHTML = '<div class="biz-card">' + reservations.map((r) =>
      `<div class="reservation-row">
        <div class="res-info">
          <span>${r.businessName} · ${r.label}</span>
        </div>
        <div class="res-price">
          <strong>$${r.price}</strong>
          <button type="button" class="btn-link-danger" data-business="${r.businessId}" data-slot="${r.slotId}" data-name="${r.businessName}" data-label="${r.label}">Cancelar</button>
        </div>
      </div>`
    ).join("") + '</div>';

    el.querySelectorAll(".btn-link-danger").forEach((btn) => {
      btn.addEventListener("click", () => {
        const businessId = btn.dataset.business;
        const slotId = btn.dataset.slot;
        openConfirm(
          "Cancelar reserva",
          `¿Seguro que quieres cancelar tu reserva en ${btn.dataset.name} (${btn.dataset.label})? El cupo se liberará para otros clientes.`,
          () => {
            CupoStore.cancelReservation(client.id, businessId, slotId);
            showToast("Reserva cancelada.");
            renderBusinesses();
            renderReservations();
          }
        );
      });
    });
  }

  document.getElementById("cancelBookBtn").addEventListener("click", () => {
    pendingAction = null;
    confirmModal.classList.remove("show");
  });

  document.getElementById("confirmBookBtn").addEventListener("click", () => {
    if (!pendingAction) return;
    const action = pendingAction;
    pendingAction = null;
    confirmModal.classList.remove("show");
    action();
  });

  renderAreaTabs();
  renderCategoryChips();
  renderBusinesses();
  renderReservations();
})();
