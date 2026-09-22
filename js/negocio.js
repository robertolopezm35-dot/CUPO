(function () {
  const session = CupoStore.getSession();
  if (!session || session.role !== "negocio") {
    window.location.href = "auth.html?mode=login&role=negocio";
    return;
  }

  function getBusiness() {
    return CupoStore.getBusinesses().find((b) => b.id === session.id);
  }

  let business = getBusiness();
  if (!business) {
    CupoStore.clearSession();
    window.location.href = "auth.html?mode=login&role=negocio";
    return;
  }

  document.getElementById("userName").textContent = business.name;
  document.getElementById("userAvatar").textContent = business.name.charAt(0).toUpperCase();
  document.getElementById("bizTitle").textContent = business.name;

  document.getElementById("logoutBtn").addEventListener("click", () => {
    CupoStore.clearSession();
    window.location.href = "index.html";
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

  function showToast(msg) {
    const toast = document.getElementById("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function render() {
    business = getBusiness();
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
      slotList.innerHTML = slots.map((s) => {
        const cls = s.status === "available" ? "available" : "mine";
        const sub = s.status === "available" ? "Disponible" : (s.clientName || "Reservado");
        return `<div class="slot ${cls}" data-slot="${s.id}" title="Clic para ${s.status === 'available' ? 'quitar' : 'reabrir (cancelación)'}">
          <span class="time">${s.label}</span>
          <span class="price">$${s.price}</span>
          <span class="price">${sub}</span>
        </div>`;
      }).join("");
    }

    slotList.querySelectorAll(".slot").forEach((el) => {
      el.addEventListener("click", () => {
        const slotId = el.dataset.slot;
        const slot = business.slots.find((s) => s.id === slotId);
        if (slot.status === "available") {
          CupoStore.removeSlot(business.id, slotId);
          showToast("Cupo eliminado.");
        } else {
          CupoStore.reopenSlot(business.id, slotId);
          showToast("Cupo reabierto por cancelación.");
        }
        render();
      });
    });

    const bookingsList = document.getElementById("bookingsList");
    if (!booked.length) {
      bookingsList.innerHTML = '<div class="empty-state">Ningún cliente ha reservado todavía.</div>';
    } else {
      bookingsList.innerHTML = '<div class="biz-card">' + booked.map((s) =>
        `<div class="reservation-row">
          <span>${s.clientName} · ${s.label}</span>
          <strong>$${s.price}</strong>
        </div>`
      ).join("") + '</div>';
    }
  }

  document.getElementById("addSlotBtn").addEventListener("click", () => {
    const hour = hourSelect.value;
    const duration = document.getElementById("newDuration").value;
    const price = document.getElementById("newPrice").value;
    CupoStore.addSlot(business.id, { hour, minute: 0, duration, price });
    showToast("Cupo publicado.");
    render();
  });

  render();
})();
