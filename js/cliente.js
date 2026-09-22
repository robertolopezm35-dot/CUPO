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
  let pendingBooking = null;

  const areaTabsEl = document.getElementById("areaTabs");
  const filtersEl = document.getElementById("categoryFilters");
  const comingSoonPanel = document.getElementById("comingSoonPanel");
  const businessListEl = document.getElementById("businessList");

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

  function renderBusinesses() {
    const area = CupoStore.AREAS.find((a) => a.id === activeArea);
    if (!area || area.comingSoon) return;

    const list = businessListEl;
    let businesses = CupoStore.getBusinesses().filter((b) => area.categories.includes(b.category));
    if (activeCategory !== "Todas") {
      businesses = businesses.filter((b) => b.category === activeCategory);
    }

    if (businesses.length === 0) {
      list.innerHTML = '<div class="empty-state">No hay negocios en esta categoría todavía.</div>';
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

      return `<div class="biz-card">
        <div class="biz-head">
          <div>
            <p class="biz-name">${b.name}</p>
            <div class="biz-meta">
              <span>${b.address}</span>
              <span>★ ${b.rating}</span>
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
        pendingBooking = { businessId, slotId };
        document.getElementById("confirmText").textContent =
          `${business.name} · ${slot.label} · $${slot.price}. ¿Confirmas tu reserva?`;
        document.getElementById("confirmModal").classList.add("show");
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
        <span>${r.businessName} · ${r.label}</span>
        <strong>$${r.price}</strong>
      </div>`
    ).join("") + '</div>';
  }

  document.getElementById("cancelBookBtn").addEventListener("click", () => {
    pendingBooking = null;
    document.getElementById("confirmModal").classList.remove("show");
  });

  document.getElementById("confirmBookBtn").addEventListener("click", () => {
    if (!pendingBooking) return;
    const result = CupoStore.bookSlot(pendingBooking.businessId, pendingBooking.slotId, client);
    document.getElementById("confirmModal").classList.remove("show");
    if (!result.ok) {
      showToast(result.error);
    } else {
      showToast("¡Cupo reservado con éxito!");
      renderBusinesses();
      renderReservations();
    }
    pendingBooking = null;
  });

  renderAreaTabs();
  renderCategoryChips();
  renderBusinesses();
  renderReservations();
})();
