(async function () {
  const session = await DataStore.getSession();
  if (!session || session.role !== "negocio") {
    window.location.href = "auth.html?mode=login&role=negocio";
    return;
  }

  const business = await DataStore.getBusinessById(session.id);
  if (!business) {
    await DataStore.clearSession();
    window.location.href = "auth.html?mode=login&role=negocio";
    return;
  }

  document.getElementById("userName").textContent = business.name;
  document.getElementById("userAvatar").textContent = business.name.charAt(0).toUpperCase();

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await DataStore.clearSession();
    window.location.href = "index.html";
  });

  const allSales = await DataStore.getSales(business.id);
  let period = "today";

  const MONEY = (n) => "$" + Math.round(n).toLocaleString("es-MX");
  const DAY_MS = 86400000;

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function filterByPeriod(sales, p) {
    const now = Date.now();
    if (p === "today") {
      const start = startOfDay(now);
      return sales.filter((s) => s.date >= start);
    }
    if (p === "7" || p === "30") {
      const start = now - parseInt(p, 10) * DAY_MS;
      return sales.filter((s) => s.date >= start);
    }
    return sales.slice();
  }

  function renderBars(container, rows, opts = {}) {
    if (!rows.length) {
      container.innerHTML = '<span style="color:var(--gray);font-size:13.5px">Sin datos en este período.</span>';
      return;
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    container.innerHTML = rows.map((r) => `
      <div class="bar-row">
        <span class="bar-label">${r.label}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max((r.value / max) * 100, r.value > 0 ? 3 : 0)}%"></div></div>
        <span class="bar-value">${opts.money ? MONEY(r.value) : r.value}</span>
      </div>
    `).join("");
  }

  function dayLabel(ts) {
    return new Date(ts).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  }

  function weekLabel(weekStart) {
    const start = new Date(weekStart);
    const end = new Date(weekStart + DAY_MS * 6);
    const startDay = start.toLocaleDateString("es-MX", { day: "numeric" });
    const endLabel = end.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    return startDay + "–" + endLabel;
  }

  function bucketRevenue(sales) {
    const completed = sales.filter((s) => s.status === "completada");
    if (!completed.length) return [];
    const byDay = period === "today" || period === "7";
    const bucketSize = byDay ? DAY_MS : DAY_MS * 7;
    const buckets = new Map();
    completed.forEach((s) => {
      const bucketStart = Math.floor(s.date / bucketSize) * bucketSize;
      buckets.set(bucketStart, (buckets.get(bucketStart) || 0) + s.price);
    });
    const keys = Array.from(buckets.keys()).sort((a, b) => a - b);
    const limited = keys.slice(-12); // no más de 12 barras para que no se vea infinito
    return limited.map((k) => ({
      label: byDay ? dayLabel(k) : weekLabel(k),
      value: buckets.get(k),
    }));
  }

  const HOUR_RANGES = [
    { from: 9, to: 11, label: "9–11" },
    { from: 11, to: 13, label: "11–13" },
    { from: 13, to: 15, label: "13–15" },
    { from: 15, to: 17, label: "15–17" },
    { from: 17, to: 19, label: "17–19" },
    { from: 19, to: 21, label: "19–21" },
  ];

  function bucketByHour(sales) {
    const completed = sales.filter((s) => s.status === "completada");
    return HOUR_RANGES.map((range) => {
      const value = completed
        .filter((s) => {
          const h = new Date(s.date).getHours();
          return h >= range.from && h < range.to;
        })
        .reduce((sum, s) => sum + s.price, 0);
      return { label: range.label, value };
    });
  }

  function renderServiceRank(container, sales) {
    const completed = sales.filter((s) => s.status === "completada" && s.service);
    if (!completed.length) {
      container.innerHTML = '<span style="color:var(--gray);font-size:13.5px">Sin ventas con servicio registrado en este período.</span>';
      return;
    }
    const byService = new Map();
    completed.forEach((s) => {
      const entry = byService.get(s.service) || { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += s.price;
      byService.set(s.service, entry);
    });
    const rows = Array.from(byService.entries())
      .map(([service, v]) => ({ service, ...v }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 6);
    container.innerHTML = rows.map((r) => `
      <div class="rank-row">
        <span class="rank-name">${r.service}</span>
        <span class="rank-count">${r.count} venta${r.count === 1 ? "" : "s"}</span>
        <span class="rank-amount">${MONEY(r.amount)}</span>
      </div>
    `).join("");
  }

  function renderSalesList(container, sales) {
    if (!sales.length) {
      container.innerHTML = '<div class="empty-state">No hay ventas en este período.</div>';
      return;
    }
    const sorted = sales.slice().sort((a, b) => b.date - a.date);
    container.innerHTML = '<div class="biz-card">' + sorted.map((s) => {
      const dt = new Date(s.date).toLocaleString("es-MX", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      const cancelled = s.status === "cancelada";
      return `<div class="sale-row ${cancelled ? "cancelada" : ""}">
        <div class="sale-info">
          <span class="sale-service">${s.service || "Servicio"}</span>
          <span class="sale-meta">${dt} · ${s.clientName || "Cliente"}</span>
        </div>
        <div style="display:flex;align-items:center;gap:10px">
          ${cancelled ? '<span class="sale-badge">Cancelada</span>' : ""}
          <span class="sale-amount">${MONEY(s.price)}</span>
        </div>
      </div>`;
    }).join("") + "</div>";
  }

  function render() {
    const sales = filterByPeriod(allSales, period);
    const completed = sales.filter((s) => s.status === "completada");

    const total = completed.reduce((sum, s) => sum + s.price, 0);
    document.getElementById("statTotal").textContent = MONEY(total);
    document.getElementById("statTicket").textContent = MONEY(completed.length ? total / completed.length : 0);
    document.getElementById("statCount").textContent = completed.length;

    renderBars(document.getElementById("dayChart"), bucketRevenue(sales), { money: true });
    renderBars(document.getElementById("hourChart"), bucketByHour(sales), { money: true });
    renderServiceRank(document.getElementById("serviceRank"), sales);
    renderSalesList(document.getElementById("salesList"), sales);
  }

  document.getElementById("periodTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn) return;
    document.querySelectorAll("#periodTabs button").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    period = btn.dataset.period;
    render();
  });

  render();
})();
