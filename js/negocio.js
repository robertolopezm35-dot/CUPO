(async function () {
  const session = await DataStore.getSession();
  if (!session || session.role !== "negocio") {
    window.location.href = "auth.html?mode=login&role=negocio";
    return;
  }

  async function getBusiness() {
    return DataStore.getBusinessById(session.id);
  }

  let business = await getBusiness();
  if (!business) {
    await DataStore.clearSession();
    window.location.href = "auth.html?mode=login&role=negocio";
    return;
  }

  document.getElementById("userName").textContent = business.name;
  document.getElementById("userAvatar").textContent = business.name.charAt(0).toUpperCase();
  document.getElementById("bizTitle").textContent = business.name;

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await DataStore.clearSession();
    window.location.href = "index.html";
  });

  const editModal = document.getElementById("editModal");
  const editCategorySelect = document.getElementById("editCategory");
  DataStore.CATEGORIES.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    editCategorySelect.appendChild(opt);
  });

  function escapeAttr(s) {
    return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function addServiceRow(name, price) {
    const container = document.getElementById("editServicesRows");
    const row = document.createElement("div");
    row.className = "edit-row";
    row.innerHTML =
      '<input type="text" class="svc-name" placeholder="Servicio" value="' + escapeAttr(name || "") + '">' +
      '<input type="number" class="svc-price" placeholder="Precio" min="0" step="10" value="' + (price || "") + '">' +
      '<button type="button" class="btn-link-danger remove-row">✕</button>';
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  function addStaffRow(name, id) {
    const container = document.getElementById("editStaffRows");
    const row = document.createElement("div");
    row.className = "edit-row";
    row.dataset.staffId = id || ("ST-" + Math.random().toString(36).slice(2, 8));
    row.innerHTML =
      '<input type="text" class="staff-name" placeholder="Nombre" value="' + escapeAttr(name || "") + '">' +
      '<button type="button" class="btn-link-danger remove-row">✕</button>';
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  document.getElementById("addServiceRowBtn").addEventListener("click", () => addServiceRow("", ""));
  document.getElementById("addStaffRowBtn").addEventListener("click", () => addStaffRow("", ""));

  document.getElementById("editProfileBtn").addEventListener("click", () => {
    document.getElementById("editName").value = business.name;
    document.getElementById("editCategory").value = business.category;
    document.getElementById("editAddress").value = business.address;
    document.getElementById("editPhotos").value = (business.photos || []).join("\n");

    document.getElementById("editServicesRows").innerHTML = "";
    (business.servicesCatalog || []).forEach((s) => addServiceRow(s.name, s.price));

    document.getElementById("editStaffRows").innerHTML = "";
    (business.staff || []).forEach((s) => addStaffRow(s.name, s.id));

    editModal.classList.add("show");
  });

  document.getElementById("cancelEditBtn").addEventListener("click", () => {
    editModal.classList.remove("show");
  });

  document.getElementById("saveEditBtn").addEventListener("click", async () => {
    const name = document.getElementById("editName").value.trim();
    const category = document.getElementById("editCategory").value;
    const address = document.getElementById("editAddress").value.trim();
    if (!name || !address) return;

    const photos = document.getElementById("editPhotos").value
      .split("\n").map((s) => s.trim()).filter(Boolean);

    const servicesCatalog = Array.from(document.querySelectorAll("#editServicesRows .edit-row")).map((row) => ({
      name: row.querySelector(".svc-name").value.trim(),
      price: parseInt(row.querySelector(".svc-price").value, 10) || 0,
    })).filter((s) => s.name);

    const staff = Array.from(document.querySelectorAll("#editStaffRows .edit-row")).map((row) => ({
      id: row.dataset.staffId,
      name: row.querySelector(".staff-name").value.trim(),
    })).filter((s) => s.name);

    await DataStore.updateBusiness(business.id, { name, category, address, servicesCatalog, photos, staff });
    editModal.classList.remove("show");
    showToast("Perfil actualizado.");
    await render();
    document.getElementById("userName").textContent = business.name;
    document.getElementById("userAvatar").textContent = business.name.charAt(0).toUpperCase();
    document.getElementById("bizTitle").textContent = business.name;
  });

  const hourSelect = document.getElementById("newHour");
  for (let h = 8; h <= 21; h++) {
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const ampm = h >= 12 ? "PM" : "AM";
    const opt = document.createElement("option");
    opt.value = h;
    opt.textContent = displayH + ":00 " + ampm;
    hourSelect.appendChild(opt);
  }

  const serviceSelect = document.getElementById("newService");
  (DataStore.SERVICES_BY_CATEGORY[business.category] || []).forEach((svc) => {
    const opt = document.createElement("option");
    opt.value = svc;
    opt.textContent = svc;
    serviceSelect.appendChild(opt);
  });

  const dayOffsetSelect = document.getElementById("newDayOffset");
  for (let i = 0; i <= 6; i++) {
    const opt = document.createElement("option");
    opt.value = i;
    if (i === 0) opt.textContent = "Hoy";
    else if (i === 1) opt.textContent = "Mañana";
    else {
      const wd = new Date(Date.now() + i * 86400000).toLocaleDateString("es-MX", { weekday: "short" });
      opt.textContent = wd.charAt(0).toUpperCase() + wd.slice(1);
    }
    dayOffsetSelect.appendChild(opt);
  }

  function renderStaffOptions() {
    const staffSelect = document.getElementById("newStaff");
    staffSelect.innerHTML = '<option value="">Sin preferencia</option>';
    (business.staff || []).forEach((st) => {
      const opt = document.createElement("option");
      opt.value = st.id;
      opt.textContent = st.name;
      staffSelect.appendChild(opt);
    });
  }

  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
  }

  async function render() {
    business = await getBusiness();
    renderStaffOptions();
    const slots = business.slots.slice().sort((a, b) => a.time - b.time);

    const available = slots.filter((s) => s.status === "available");
    const booked = slots.filter((s) => s.status === "booked");

    document.getElementById("statAvailable").textContent = available.length;
    document.getElementById("statBooked").textContent = booked.length;
    document.getElementById("statIncome").textContent =
      "$" + available.reduce((sum, s) => sum + s.price, 0);

    const slotList = document.getElementById("slotList");
    if (!slots.length) {
      slotList.innerHTML = '<span style="color:var(--gray);font-size:13.5px">Aún no has publicado horarios. Agrega uno abajo.</span>';
    } else {
      const todayStart = DataStore.startOfDay(Date.now());
      slotList.innerHTML = slots.map((s) => {
        const cls = s.status === "available" ? "available" : "mine";
        const sub = s.status === "available" ? "Disponible" : (s.clientName || "Reservado");
        const sameDay = DataStore.startOfDay(s.time) === todayStart;
        const dateStr = sameDay ? "" : new Date(s.time).toLocaleDateString("es-MX", { weekday: "short", day: "numeric" }) + " ";
        const priceHtml = s.discountPct > 0
          ? `<span class="price"><s>$${s.originalPrice}</s> $${s.price} <span class="discount-badge">-${s.discountPct}%</span></span>`
          : `<span class="price">$${s.price}</span>`;
        return `<div class="slot ${cls}" data-slot="${s.id}" title="Clic para ${s.status === 'available' ? 'quitar' : 'reabrir (cancelación)'}">
          <span class="time">${dateStr}${s.label}</span>
          ${s.service ? `<span class="price">${s.service}</span>` : ""}
          ${priceHtml}
          ${s.staffName ? `<span class="price">${s.staffName}</span>` : ""}
          <span class="price">${sub}</span>
        </div>`;
      }).join("");
    }

    slotList.querySelectorAll(".slot").forEach((el) => {
      el.addEventListener("click", async () => {
        const slotId = el.dataset.slot;
        const slot = business.slots.find((s) => s.id === slotId);
        if (slot.status === "available") {
          await DataStore.removeSlot(business.id, slotId);
          showToast("Cupo eliminado.");
        } else {
          await DataStore.reopenSlot(business.id, slotId);
          showToast("Cupo reabierto por cancelación.");
        }
        await render();
      });
    });

    const bookingsList = document.getElementById("bookingsList");
    if (!booked.length) {
      bookingsList.innerHTML = '<div class="empty-state">Ningún cliente ha reservado todavía.</div>';
    } else {
      bookingsList.innerHTML = '<div class="biz-card">' + booked.map((s) =>
        `<div class="reservation-row">
          <span>${s.clientName} · ${s.service ? s.service + " · " : ""}${s.label}${s.staffName ? " · " + s.staffName : ""}</span>
          <strong>$${s.price}</strong>
        </div>`
      ).join("") + '</div>';
    }
  }

  document.getElementById("addSlotBtn").addEventListener("click", async () => {
    const hour = hourSelect.value;
    const duration = document.getElementById("newDuration").value;
    const price = document.getElementById("newPrice").value;
    const service = serviceSelect.value;
    const dayOffset = dayOffsetSelect.value;
    const discountPct = document.getElementById("newDiscount").value;
    const staffId = document.getElementById("newStaff").value;
    await DataStore.addSlot(business.id, { hour, minute: 0, duration, price, service, dayOffset, discountPct, staffId });
    showToast("Cupo publicado.");
    await render();
  });

  await render();
})();
