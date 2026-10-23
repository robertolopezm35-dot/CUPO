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

  // Escapa texto controlado por clientes (nombre, estilista asignado) antes
  // de insertarlo en innerHTML o en un atributo — sin esto, el nombre de
  // cualquier cliente que reserve se ejecuta como script en la pantalla del
  // negocio (XSS almacenado). Cualquiera puede registrarse como cliente con
  // el nombre que quiera, así que esto no es opcional.
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function addServiceRow(name, price) {
    const container = document.getElementById("editServicesRows");
    const row = document.createElement("div");
    row.className = "edit-row";
    row.innerHTML =
      '<input type="text" class="svc-name" placeholder="Servicio" value="' + esc(name || "") + '">' +
      '<input type="number" class="svc-price" placeholder="Precio" min="0" step="10" value="' + (price || "") + '">' +
      '<button type="button" class="btn-link-danger remove-row" aria-label="Eliminar servicio">✕</button>';
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  function addStaffRow(name, id) {
    const container = document.getElementById("editStaffRows");
    const row = document.createElement("div");
    row.className = "edit-row";
    row.dataset.staffId = id || ("ST-" + Math.random().toString(36).slice(2, 8));
    row.innerHTML =
      '<input type="text" class="staff-name" placeholder="Nombre" value="' + esc(name || "") + '">' +
      '<button type="button" class="btn-link-danger remove-row" aria-label="Eliminar persona">✕</button>';
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  document.getElementById("addServiceRowBtn").addEventListener("click", () => addServiceRow("", ""));
  document.getElementById("addStaffRowBtn").addEventListener("click", () => addStaffRow("", ""));

  // Para avisar si cierran el modal con cambios sin guardar: una foto del
  // estado del formulario al abrirlo, comparada contra el estado actual.
  let editModalSnapshot = null;
  function captureEditModalState() {
    return JSON.stringify({
      name: document.getElementById("editName").value,
      category: document.getElementById("editCategory").value,
      address: document.getElementById("editAddress").value,
      photos: document.getElementById("editPhotos").value,
      services: Array.from(document.querySelectorAll("#editServicesRows .edit-row")).map((row) => [
        row.querySelector(".svc-name").value,
        row.querySelector(".svc-price").value,
      ]),
      staff: Array.from(document.querySelectorAll("#editStaffRows .edit-row")).map((row) => row.querySelector(".staff-name").value),
    });
  }
  function editModalDirty() {
    return editModalSnapshot !== null && captureEditModalState() !== editModalSnapshot;
  }

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
    editModalSnapshot = captureEditModalState();
  });

  function closeEditModal({ force } = {}) {
    if (!force && editModalDirty() && !window.confirm("Tienes cambios sin guardar. ¿Descartarlos?")) {
      return;
    }
    editModalSnapshot = null;
    editModal.classList.remove("show");
  }
  document.getElementById("cancelEditBtn").addEventListener("click", () => closeEditModal());
  document.getElementById("closeEditBtn").addEventListener("click", () => closeEditModal());
  editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEditModal(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeEditModal(); });

  const saveEditBtn = document.getElementById("saveEditBtn");
  saveEditBtn.addEventListener("click", async () => {
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

    saveEditBtn.disabled = true;
    const result = await DataStore.updateBusiness(business.id, { name, category, address, servicesCatalog, photos, staff });
    saveEditBtn.disabled = false;
    if (result && result.ok === false) {
      showToast(result.error || "No se pudo guardar el perfil. Intenta de nuevo.");
      return;
    }
    closeEditModal({ force: true });
    showToast("Perfil actualizado.");
    await render({ silent: true });
    renderServiceOptions();
    document.getElementById("userName").textContent = business.name;
    document.getElementById("userAvatar").textContent = business.name.charAt(0).toUpperCase();
    document.getElementById("bizTitle").textContent = business.name;
  });

  function populateHourOptions(select) {
    select.innerHTML = "";
    for (let h = 8; h <= 21; h++) {
      const displayH = h % 12 === 0 ? 12 : h % 12;
      const ampm = h >= 12 ? "PM" : "AM";
      const opt = document.createElement("option");
      opt.value = h;
      opt.textContent = displayH + ":00 " + ampm;
      select.appendChild(opt);
    }
  }

  function populateDayOptions(select) {
    select.innerHTML = "";
    for (let i = 0; i <= 6; i++) {
      const opt = document.createElement("option");
      opt.value = i;
      if (i === 0) opt.textContent = "Hoy";
      else if (i === 1) opt.textContent = "Mañana";
      else {
        const wd = new Date(Date.now() + i * 86400000).toLocaleDateString("es-MX", { weekday: "short" });
        opt.textContent = wd.charAt(0).toUpperCase() + wd.slice(1);
      }
      select.appendChild(opt);
    }
  }

  function populateServiceOptions(select) {
    const current = select.value;
    select.innerHTML = "";
    (DataStore.SERVICES_BY_CATEGORY[business.category] || []).forEach((svc) => {
      const opt = document.createElement("option");
      opt.value = svc;
      opt.textContent = svc;
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }

  function populateStaffOptions(select) {
    const current = select.value;
    select.innerHTML = '<option value="">Sin preferencia</option>';
    (business.staff || []).forEach((st) => {
      const opt = document.createElement("option");
      opt.value = st.id;
      opt.textContent = st.name;
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }

  const hourSelect = document.getElementById("newHour");
  const serviceSelect = document.getElementById("newService");
  const dayOffsetSelect = document.getElementById("newDayOffset");
  populateHourOptions(hourSelect);
  populateDayOptions(dayOffsetSelect);
  function renderServiceOptions() { populateServiceOptions(serviceSelect); }
  function renderStaffOptions() { populateStaffOptions(document.getElementById("newStaff")); }
  renderServiceOptions();

  const editSlotHour = document.getElementById("editSlotHour");
  const editSlotDayOffset = document.getElementById("editSlotDayOffset");
  const editSlotService = document.getElementById("editSlotService");
  const editSlotStaff = document.getElementById("editSlotStaff");
  populateHourOptions(editSlotHour);
  populateDayOptions(editSlotDayOffset);

  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
  }

  const slotDetailModal = document.getElementById("slotDetailModal");
  const slotDetailEditable = document.getElementById("slotDetailEditable");
  const slotDetailBookedInfo = document.getElementById("slotDetailBookedInfo");
  const slotDetailActionsAvailable = document.getElementById("slotDetailActionsAvailable");
  const slotDetailActionsBooked = document.getElementById("slotDetailActionsBooked");
  let detailSlotId = null;

  function closeSlotDetail() {
    slotDetailModal.classList.remove("show");
    detailSlotId = null;
  }
  document.getElementById("closeSlotDetailBtn").addEventListener("click", closeSlotDetail);
  document.getElementById("cancelSlotDetailBtn").addEventListener("click", closeSlotDetail);
  slotDetailModal.addEventListener("click", (e) => { if (e.target === slotDetailModal) closeSlotDetail(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSlotDetail(); });

  function openSlotDetail(slotId) {
    const slot = business.slots.find((s) => s.id === slotId);
    if (!slot) return;
    detailSlotId = slotId;

    if (slot.status === "available") {
      slotDetailEditable.hidden = false;
      slotDetailBookedInfo.hidden = true;
      slotDetailActionsAvailable.hidden = false;
      slotDetailActionsBooked.hidden = true;

      populateServiceOptions(editSlotService);
      populateStaffOptions(editSlotStaff);
      const dayIdx = Math.round((DataStore.startOfDay(slot.time) - DataStore.startOfDay(Date.now())) / 86400000);
      editSlotDayOffset.value = String(Math.max(0, dayIdx));
      editSlotHour.value = String(new Date(slot.time).getHours());
      document.getElementById("editSlotDuration").value = slot.duration;
      document.getElementById("editSlotPrice").value = slot.originalPrice || slot.price;
      document.getElementById("editSlotDiscount").value = slot.discountPct || 0;
      if (slot.service) editSlotService.value = slot.service;
      editSlotStaff.value = slot.staffId || "";
    } else {
      slotDetailEditable.hidden = true;
      slotDetailBookedInfo.hidden = false;
      slotDetailActionsAvailable.hidden = true;
      slotDetailActionsBooked.hidden = false;
      slotDetailBookedInfo.textContent =
        `Reservado por ${slot.clientName || "un cliente"} · ${slot.service ? slot.service + " · " : ""}${slot.label}` +
        `${slot.staffName ? " · con " + slot.staffName : ""} · $${slot.price}. ` +
        `Para liberar este cupo, reábrelo por cancelación.`;
    }

    slotDetailModal.classList.add("show");
  }

  document.getElementById("deleteSlotBtn").addEventListener("click", async () => {
    if (!detailSlotId) return;
    await DataStore.removeSlot(business.id, detailSlotId);
    closeSlotDetail();
    showToast("Cupo eliminado.");
    await render({ silent: true });
  });

  const saveSlotBtn = document.getElementById("saveSlotBtn");
  saveSlotBtn.addEventListener("click", async () => {
    if (!detailSlotId) return;
    saveSlotBtn.disabled = true;
    const result = await DataStore.updateSlot(business.id, detailSlotId, {
      hour: editSlotHour.value,
      minute: 0,
      duration: document.getElementById("editSlotDuration").value,
      price: document.getElementById("editSlotPrice").value,
      service: editSlotService.value,
      dayOffset: editSlotDayOffset.value,
      discountPct: document.getElementById("editSlotDiscount").value,
      staffId: editSlotStaff.value,
    });
    saveSlotBtn.disabled = false;
    if (result && result.ok === false) {
      showToast(result.error || "No se pudo guardar. Intenta de nuevo.");
      return;
    }
    closeSlotDetail();
    showToast("Cupo actualizado.");
    await render({ silent: true });
  });

  document.getElementById("reopenSlotBtn").addEventListener("click", async () => {
    if (!detailSlotId) return;
    await DataStore.reopenSlot(business.id, detailSlotId);
    closeSlotDetail();
    showToast("Cupo reabierto por cancelación.");
    await render({ silent: true });
  });

  async function render({ silent } = {}) {
    try {
      business = await getBusiness();
    } catch (err) {
      console.error("render failed:", err);
      // Silencioso en el refresco de fondo y justo después de una acción que
      // ya mostró su propio toast — deja la agenda tal como estaba en vez de
      // romper la pantalla por un parpadeo de conexión.
      if (!silent) showToast("No se pudo actualizar. Revisa tu conexión.");
      return;
    }
    renderStaffOptions();
    const todayStart = DataStore.startOfDay(Date.now());
    // Solo de hoy en adelante, y en orden cronológico (hoy primero, luego
    // mañana, etc.) — lo ya pasado vive en el dashboard de Ventas, no aquí.
    const slots = business.slots
      .filter((s) => s.time >= todayStart)
      .sort((a, b) => a.time - b.time);

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
      slotList.innerHTML = slots.map((s) => {
        const cls = s.status === "available" ? "available" : "mine";
        const sub = s.status === "available" ? "Disponible" : (s.clientName || "Reservado");
        const sameDay = DataStore.startOfDay(s.time) === todayStart;
        const dateStr = sameDay ? "" : new Date(s.time).toLocaleDateString("es-MX", { weekday: "short", day: "numeric" }) + " ";
        const priceHtml = s.discountPct > 0
          ? `<span class="price"><s>$${s.originalPrice}</s> $${s.price} <span class="discount-badge">-${s.discountPct}%</span></span>`
          : `<span class="price">$${s.price}</span>`;
        return `<div class="slot ${cls}" data-slot="${s.id}" title="Clic para ver detalles">
          <span class="time">${dateStr}${s.label}</span>
          ${s.service ? `<span class="price">${esc(s.service)}</span>` : ""}
          ${priceHtml}
          ${s.staffName ? `<span class="price">${esc(s.staffName)}</span>` : ""}
          <span class="price">${esc(sub)}</span>
        </div>`;
      }).join("");
    }

    slotList.querySelectorAll(".slot").forEach((el) => {
      el.addEventListener("click", () => openSlotDetail(el.dataset.slot));
    });

    const bookingsList = document.getElementById("bookingsList");
    if (!booked.length) {
      bookingsList.innerHTML = '<div class="empty-state">Ningún cliente ha reservado todavía.</div>';
    } else {
      bookingsList.innerHTML = '<div class="biz-card">' + booked.map((s) =>
        `<div class="reservation-row">
          <span>${esc(s.clientName)} · ${s.service ? esc(s.service) + " · " : ""}${s.label}${s.staffName ? " · " + esc(s.staffName) : ""}</span>
          <strong>$${s.price}</strong>
        </div>`
      ).join("") + '</div>';
    }

    // Citas ya atendidas (cupos reservados con fecha anterior a hoy). Es
    // solo un recordatorio visual — el detalle de ventas/cancelaciones
    // vive en el dashboard de Ventas, que lee de la tabla sales.
    const pastBooked = business.slots
      .filter((s) => s.time < todayStart && s.status === "booked")
      .sort((a, b) => b.time - a.time);
    const pastAppointmentsList = document.getElementById("pastAppointmentsList");
    if (!pastBooked.length) {
      pastAppointmentsList.innerHTML = '<div class="empty-state">Todavía no tienes citas pasadas.</div>';
    } else {
      pastAppointmentsList.innerHTML = '<div class="biz-card">' + pastBooked.map((s) => {
        const dateStr = new Date(s.time).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
        return `<div class="reservation-row">
          <span>${dateStr} · ${esc(s.clientName)} · ${s.service ? esc(s.service) + " · " : ""}${s.label}${s.staffName ? " · " + esc(s.staffName) : ""}</span>
          <strong>$${s.price}</strong>
        </div>`;
      }).join("") + '</div>';
    }
  }

  const addSlotBtn = document.getElementById("addSlotBtn");
  addSlotBtn.addEventListener("click", async () => {
    const hour = hourSelect.value;
    const duration = document.getElementById("newDuration").value;
    const price = document.getElementById("newPrice").value;
    const service = serviceSelect.value;
    const dayOffset = dayOffsetSelect.value;
    const discountPct = document.getElementById("newDiscount").value;
    const staffId = document.getElementById("newStaff").value;
    addSlotBtn.disabled = true;
    await DataStore.addSlot(business.id, { hour, minute: 0, duration, price, service, dayOffset, discountPct, staffId });
    addSlotBtn.disabled = false;
    showToast("Cupo publicado.");
    await render({ silent: true });
  });

  await render();

  // Igual que en el panel del cliente: si reservan un cupo desde otro
  // dispositivo mientras el negocio tiene la agenda abierta, que se entere
  // sin recargar. Se salta el ciclo si hay un modal de edición abierto.
  setInterval(async () => {
    if (document.hidden) return;
    if (slotDetailModal.classList.contains("show") || editModal.classList.contains("show")) return;
    await render({ silent: true });
  }, 20000);
})();
