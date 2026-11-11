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

  let allSales = [];
  try {
    allSales = await DataStore.getSales(business.id);
  } catch (e) {
    console.error(e);
    toast("No se pudieron cargar tus ventas. Revisa tu conexión y recarga.");
  }

  const MONEY = (n) => "$" + Math.round(n).toLocaleString("es-MX");
  const DAY_MS = 86400000;
  const HIST_PAGE = 40;

  let period = "today";
  let customFrom = "";
  let customTo = "";
  let histFilter = "all";
  let histQuery = "";
  let histLimit = HIST_PAGE;

  // Escapa nombre de cliente/colaborador antes de insertarlo en innerHTML —
  // cualquiera puede registrarse como cliente con el nombre que quiera, así
  // que sin esto una venta con nombre malicioso ejecuta HTML/script en el
  // dashboard del negocio (XSS almacenado).
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function addDays(ts, n) {
    const d = new Date(ts);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  // ── Ventana de tiempo ────────────────────────────────────────────────────
  // Todo se agrupa por la hora de la CITA (startsAt), no por la de la reserva.
  // La ventana incluye el día de hoy completo: así "Hoy" muestra lo ya
  // atendido y, aparte, lo que falta por venir hoy.
  function windowFor(p, now) {
    const today = startOfDay(now);
    if (p === "today") return { from: today, to: addDays(today, 1) };
    if (p === "7") return { from: addDays(today, -6), to: addDays(today, 1) };
    if (p === "30") return { from: addDays(today, -29), to: addDays(today, 1) };
    if (p === "custom") {
      if (!customFrom || !customTo) return null;
      const from = startOfDay(new Date(customFrom + "T00:00:00").getTime());
      const to = addDays(startOfDay(new Date(customTo + "T00:00:00").getTime()), 1);
      if (!(to > from)) return null;
      return { from, to };
    }
    return { from: -Infinity, to: Infinity };
  }

  // La ventana inmediata anterior y de la misma duración, para la tendencia.
  function previousWindow(win, p) {
    if (!win || !Number.isFinite(win.from)) return null;
    if (p === "today") return { from: addDays(win.from, -1), to: win.from };
    const days = Math.round((win.to - win.from) / DAY_MS);
    return { from: addDays(win.from, -days), to: win.from };
  }

  // Hora de la cita. Una venta guardada antes de existir ese dato (o en una
  // base sin migrar) la recupera de la hora de su cupo; si el cupo ya no está,
  // lo más cercano que se sabe es cuándo se reservó.
  const slotTime = new Map((business.slots || []).map((sl) => [sl.id, sl.time]));
  const whenOf = (s) => s.startsAt || slotTime.get(s.slotId) || s.date;
  const inWin = (s, win) => win && whenOf(s) >= win.from && whenOf(s) < win.to;

  // cancelada | porvenir | noshow | realizada (incluye "sin confirmar": se
  // da por buena hasta que el negocio marque lo contrario).
  function stateOf(s, now) {
    if (s.status === "cancelada") return "cancelada";
    if (whenOf(s) > now) return "porvenir";
    if (s.attendance === "no_asistio") return "noshow";
    return "realizada";
  }

  function clientKey(s) {
    if (s.clientId) return "id:" + s.clientId;
    return "n:" + String(s.clientName || "").trim().toLowerCase();
  }

  const sum = (arr) => arr.reduce((t, s) => t + s.price, 0);

  // ── Gráficas (SVG/HTML puro) ─────────────────────────────────────────────
  function emptyMsg(text) {
    return '<span class="muted-msg">' + text + "</span>";
  }

  function renderBars(container, rows, opts = {}) {
    if (!rows.length || rows.every((r) => !r.value)) {
      container.innerHTML = emptyMsg("Sin datos en este período.");
      return;
    }
    const max = Math.max(...rows.map((r) => r.value), 1);
    container.innerHTML = rows.map((r) => `
      <div class="bar-row">
        <span class="bar-label">${esc(r.label)}</span>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.max((r.value / max) * 100, r.value > 0 ? 3 : 0)}%"></div></div>
        <span class="bar-value">${opts.money ? MONEY(r.value) : r.value}</span>
      </div>
    `).join("");
  }

  // Línea/área en SVG puro (sin librerías) para "Ingresos por día" — con un
  // solo punto no hay línea que trazar, así que cae de vuelta a las barras.
  function renderLineChart(container, rows, opts = {}) {
    if (!rows.length) {
      container.innerHTML = emptyMsg("Sin datos en este período.");
      return;
    }
    if (rows.length < 2) {
      renderBars(container, rows, opts);
      return;
    }
    const W = 640, H = 220, padX = 36, padY = 24, labelH = 24;
    const max = Math.max(...rows.map((r) => r.value), 1);
    const plotW = W - padX * 2;
    const plotH = H - padY * 2 - labelH;
    const stepX = plotW / (rows.length - 1);
    const points = rows.map((r, i) => ({
      x: padX + stepX * i,
      y: padY + plotH - (r.value / max) * plotH,
      r,
    }));
    const linePath = points.map((p, i) => (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1)).join(" ");
    const floorY = (padY + plotH).toFixed(1);
    const areaPath = `${linePath} L${points[points.length - 1].x.toFixed(1)},${floorY} L${points[0].x.toFixed(1)},${floorY} Z`;
    const dots = points.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.5" fill="#4338CA"><title>${esc(p.r.label)}: ${opts.money ? MONEY(p.r.value) : p.r.value}</title></circle>`).join("");
    // Con muchos puntos las etiquetas del eje se encimarían: se muestran
    // una de cada N.
    const every = Math.ceil(rows.length / 9);
    const axisLabels = points.map((p, i) => (i % every === 0 || i === points.length - 1)
      ? `<text x="${p.x.toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="11" fill="#4B5563">${esc(p.r.label)}</text>` : "").join("");
    const valueLabels = rows.length <= 8
      ? points.map((p) => `<text x="${p.x.toFixed(1)}" y="${(Math.max(p.y - 10, 12)).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#14142B">${opts.money ? MONEY(p.r.value) : p.r.value}</text>`).join("")
      : "";
    container.innerHTML = `
      <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Ingresos por día">
        <defs>
          <linearGradient id="lineChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="#4338CA" stop-opacity="0.25" />
            <stop offset="100%" stop-color="#4338CA" stop-opacity="0" />
          </linearGradient>
        </defs>
        <path d="${areaPath}" fill="url(#lineChartFill)" />
        <path d="${linePath}" fill="none" stroke="#4338CA" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
        ${dots}
        ${valueLabels}
        ${axisLabels}
      </svg>
    `;
  }

  function dayLabel(ts) {
    return new Date(ts).toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  }

  function weekLabel(weekStart) {
    const start = new Date(weekStart);
    const end = new Date(addDays(weekStart, 6));
    const startDay = start.toLocaleDateString("es-MX", { day: "numeric" });
    const endLabel = end.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    return startDay + "–" + endLabel;
  }

  // Ingresos por día (o por semana si el rango es largo), sobre las citas
  // realizadas. Los días sin ventas dentro del rango salen en cero para que
  // la línea no "salte" días.
  function bucketRevenue(done, win) {
    if (!done.length) return [];
    const times = done.map(whenOf);
    const first = startOfDay(Math.min(...times));
    const last = startOfDay(Math.max(...times));
    const spanDays = Math.round((last - first) / DAY_MS) + 1;
    const byWeek = spanDays > 45;
    const buckets = new Map();
    const stepOf = (ts) => {
      if (!byWeek) return startOfDay(ts);
      const d = new Date(startOfDay(ts));
      const dow = (d.getDay() + 6) % 7; // lunes = 0
      return addDays(d.getTime(), -dow);
    };
    done.forEach((s) => {
      const key = stepOf(whenOf(s));
      buckets.set(key, (buckets.get(key) || 0) + s.price);
    });
    const keys = [];
    const step = byWeek ? 7 : 1;
    for (let k = stepOf(first); k <= last; k = addDays(k, step)) keys.push(k);
    return keys.slice(-31).map((k) => ({ label: byWeek ? weekLabel(k) : dayLabel(k), value: buckets.get(k) || 0 }));
  }

  const WEEKDAYS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
  function bucketByWeekday(done) {
    const totals = new Array(7).fill(0);
    done.forEach((s) => {
      totals[(new Date(whenOf(s)).getDay() + 6) % 7] += s.price;
    });
    return WEEKDAYS.map((label, i) => ({ label, value: totals[i] }));
  }

  // Una barra por hora, solo en el rango donde hay citas (no un 9–21 fijo:
  // un negocio puede abrir a las 8 o cerrar a las 22).
  function bucketByHour(done) {
    if (!done.length) return [];
    const byHour = new Map();
    done.forEach((s) => {
      const h = new Date(whenOf(s)).getHours();
      byHour.set(h, (byHour.get(h) || 0) + s.price);
    });
    const hours = Array.from(byHour.keys());
    const min = Math.min(...hours);
    const max = Math.max(...hours);
    const rows = [];
    for (let h = min; h <= max; h++) rows.push({ label: h + ":00", value: byHour.get(h) || 0 });
    return rows;
  }

  function groupAndRank(items, keyFn, opts = {}) {
    const map = new Map();
    items.forEach((item) => {
      const key = keyFn(item);
      if (!key) return;
      const entry = map.get(key) || { count: 0, amount: 0 };
      entry.count += 1;
      entry.amount += item.price;
      map.set(key, entry);
    });
    let rows = Array.from(map.entries())
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.amount - a.amount);
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows;
  }

  function renderRankRows(container, rows, total, emptyText) {
    if (!rows.length) {
      container.innerHTML = emptyMsg(emptyText);
      return;
    }
    container.innerHTML = rows.map((r) => {
      const share = total ? Math.round((r.amount / total) * 100) : 0;
      return `
      <div class="rank-row">
        <span class="rank-name">${esc(r.name)}</span>
        <span class="rank-count">${r.count} cita${r.count === 1 ? "" : "s"} · ${share}%</span>
        <span class="rank-amount">${MONEY(r.amount)}</span>
      </div>`;
    }).join("");
  }

  // ── Tendencia ────────────────────────────────────────────────────────────
  const PREVIOUS_LABEL = { today: "ayer", "7": "los 7 días anteriores", "30": "los 30 días anteriores", custom: "el período anterior" };

  function renderTrend(el, current, previous, label) {
    el.className = "trend";
    if (!label) {
      el.textContent = "";
      return;
    }
    if (previous <= 0) {
      el.textContent = current > 0 ? "Sin ingresos en " + label + " para comparar" : "";
      return;
    }
    const pct = ((current - previous) / previous) * 100;
    el.textContent = (pct > 0 ? "+" : "") + pct.toFixed(0) + "% vs. " + label;
    el.className = "trend " + (pct > 0 ? "up" : pct < 0 ? "down" : "");
  }

  // ── Secciones ────────────────────────────────────────────────────────────
  function renderDiscountInsight(container, done, total) {
    const discounted = done.filter((s) => s.discountPct > 0);
    if (!discounted.length) {
      container.innerHTML = emptyMsg("No tuviste ventas con descuento en este período.");
      return;
    }
    const revenue = sum(discounted);
    const share = total ? (revenue / total) * 100 : 0;
    const avgPct = discounted.reduce((t, s) => t + s.discountPct, 0) / discounted.length;
    container.innerHTML = `
      <div class="mini-stat-row">
        <div class="mini-stat"><strong>${discounted.length}</strong><span>venta${discounted.length === 1 ? "" : "s"} con descuento</span></div>
        <div class="mini-stat"><strong>${MONEY(revenue)}</strong><span>ingreso generado</span></div>
        <div class="mini-stat"><strong>${share.toFixed(0)}%</strong><span>de tus ventas totales</span></div>
        <div class="mini-stat"><strong>${avgPct.toFixed(0)}%</strong><span>descuento promedio</span></div>
      </div>`;
  }

  // Dinero que todavía se puede ganar: cupos libres que aún no empiezan.
  function renderFillInsight(container, win, now) {
    const slots = (business.slots || []).filter((s) => s.status === "available" && s.time > now && s.time >= win.from && s.time < win.to);
    const priced = slots.map((s) => {
      const info = CupoSchedule.describeSlot(business, s);
      return { slot: s, price: info.bookable ? info.price : 0 };
    }).filter((x) => x.price > 0);
    const published = (business.slots || []).length;
    if (!priced.length) {
      container.innerHTML = published
        ? emptyMsg("No tienes cupos libres por venir en este período. ¡Buen trabajo, tu agenda está llena!")
        : emptyMsg('Aún no publicas cupos. Define tu horario semanal en <a href="negocio.html">Mi agenda</a> y se publican solos.');
      return;
    }
    const potential = priced.reduce((t, x) => t + x.price, 0);
    const byDay = new Map();
    priced.forEach((x) => {
      const key = startOfDay(x.slot.time);
      const e = byDay.get(key) || { count: 0, amount: 0 };
      e.count += 1;
      e.amount += x.price;
      byDay.set(key, e);
    });
    const days = Array.from(byDay.entries()).sort((a, b) => a[0] - b[0]).slice(0, 7);
    const todayKey = startOfDay(now);
    container.innerHTML = `
      <div class="mini-stat-row">
        <div class="mini-stat"><strong>${priced.length}</strong><span>cupo${priced.length === 1 ? "" : "s"} libre${priced.length === 1 ? "" : "s"}</span></div>
        <div class="mini-stat"><strong>${MONEY(potential)}</strong><span>que puedes vender</span></div>
      </div>
      <div class="fill-days">
        ${days.map(([k, v]) => `<div class="rank-row"><span class="rank-name">${k === todayKey ? "Hoy" : esc(new Date(k).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "short" }))}</span><span class="rank-count">${v.count} cupo${v.count === 1 ? "" : "s"}</span><span class="rank-amount">${MONEY(v.amount)}</span></div>`).join("")}
      </div>
      <p class="fill-tip">Tip: un descuento de último momento en los cupos de hoy suele llenarlos más rápido que dejarlos vacíos. Ponlo desde <a href="negocio.html">Mi agenda</a> tocando un cupo.</p>`;
  }

  function renderClientMix(mixEl, topEl, done) {
    if (!done.length) {
      mixEl.innerHTML = emptyMsg("Sin clientes en este período.");
      topEl.innerHTML = emptyMsg("Sin clientes en este período.");
      return;
    }
    // Primera visita de cada cliente en TODO el historial (no solo el período):
    // así "nuevo" significa nuevo de verdad.
    const firstVisit = new Map();
    allSales.forEach((s) => {
      if (stateOf(s, Date.now()) !== "realizada") return;
      const k = clientKey(s);
      const t = whenOf(s);
      if (!firstVisit.has(k) || t < firstVisit.get(k)) firstVisit.set(k, t);
    });
    const clients = new Map();
    done.forEach((s) => {
      const k = clientKey(s);
      const c = clients.get(k) || { name: s.clientName || "Cliente", visits: 0, amount: 0, phone: null, country: null };
      c.visits += 1;
      c.amount += s.price;
      if (s.clientPhone) { c.phone = s.clientPhone; c.country = s.clientCountry; }
      clients.set(k, c);
    });
    const winFrom = windowStartForMix;
    let fresh = 0;
    clients.forEach((c, k) => {
      if (firstVisit.get(k) >= winFrom) fresh += 1;
    });
    const total = clients.size;
    const returning = total - fresh;
    const returningPct = total ? Math.round((returning / total) * 100) : 0;
    mixEl.innerHTML = `
      <div class="mini-stat-row">
        <div class="mini-stat"><strong>${fresh}</strong><span>nuevo${fresh === 1 ? "" : "s"}</span></div>
        <div class="mini-stat"><strong>${returning}</strong><span>recurrente${returning === 1 ? "" : "s"}</span></div>
        <div class="mini-stat"><strong>${returningPct}%</strong><span>vuelven a visitarte</span></div>
      </div>
      <div class="mix-bar" role="img" aria-label="${fresh} nuevos y ${returning} recurrentes">
        <div class="mix-fresh" style="width:${total ? (fresh / total) * 100 : 0}%"></div>
      </div>
      <div class="mix-legend"><span><i class="dot fresh"></i> Nuevos</span><span><i class="dot ret"></i> Recurrentes</span></div>`;

    const top = Array.from(clients.values()).sort((a, b) => b.amount - a.amount).slice(0, 5);
    topEl.innerHTML = top.map((c) => {
      const wa = CupoContact.whatsappUrl(c.country, c.phone, "Hola " + c.name.split(" ")[0] + ", te escribimos de " + business.name + ". ");
      return `<div class="rank-row">
        <span class="rank-name">${esc(c.name)}</span>
        <span class="rank-count">${c.visits} visita${c.visits === 1 ? "" : "s"}${wa ? ` · <a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</span>
        <span class="rank-amount">${MONEY(c.amount)}</span>
      </div>`;
    }).join("");
  }
  let windowStartForMix = -Infinity;

  // ── Historial ────────────────────────────────────────────────────────────
  const STATE_BADGE = {
    cancelada: '<span class="sale-badge cancel">Cancelada</span>',
    porvenir: '<span class="sale-badge upcoming">Por venir</span>',
    noshow: '<span class="sale-badge noshow">No llegó</span>',
  };

  function matchesQuery(s, q) {
    if (!q) return true;
    const hay = [s.clientName, s.service, s.folio, s.staffName].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  }

  function matchesFilter(s, filter, now) {
    const st = stateOf(s, now);
    if (filter === "all") return true;
    if (filter === "confirmar") return st === "realizada" && s.attendance === "pendiente";
    return st === filter;
  }

  function historyRows(win, now) {
    const q = histQuery.trim().toLowerCase();
    return allSales
      .filter((s) => inWin(s, win) && matchesFilter(s, histFilter, now) && matchesQuery(s, q))
      .sort((a, b) => whenOf(b) - whenOf(a));
  }

  function renderSalesList(win, now) {
    const container = document.getElementById("salesList");
    const more = document.getElementById("histMore");
    const rows = historyRows(win, now);
    if (!rows.length) {
      container.innerHTML = '<div class="empty-state">No hay citas con ese filtro en este período.</div>';
      more.hidden = true;
      return;
    }
    const visible = rows.slice(0, histLimit);
    container.innerHTML = '<div class="biz-card hist-card">' + visible.map((s) => {
      const st = stateOf(s, now);
      const dt = new Date(whenOf(s)).toLocaleString("es-MX", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
      const wa = CupoContact.whatsappUrl(s.clientCountry, s.clientPhone, "Hola " + String(s.clientName || "").split(" ")[0] + ", te escribimos de " + business.name + ". ");
      const tel = CupoContact.telUrl(s.clientCountry, s.clientPhone);
      let actions = "";
      if (st === "realizada" || st === "noshow") {
        if (s.attendance === "pendiente") {
          actions = `<button class="att-btn ok" data-att="asistio" data-sale="${esc(s.id)}">✓ Llegó</button><button class="att-btn no" data-att="no_asistio" data-sale="${esc(s.id)}">✗ No llegó</button>`;
        } else {
          actions = `<button class="att-btn undo ${s.attendance === "no_asistio" ? "is-no" : ""}" data-att="pendiente" data-sale="${esc(s.id)}" aria-label="${s.attendance === "asistio" ? "Llegó" : "No llegó"}. Cambiar">${s.attendance === "asistio" ? "✓ Llegó" : "✗ No llegó"}<span>cambiar</span></button>`;
        }
      }
      const contact = (wa || tel)
        ? `<span class="sale-contact">${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp a ${esc(s.clientName)}">WhatsApp</a>` : ""}${tel ? `<a href="${esc(tel)}" aria-label="Llamar a ${esc(s.clientName)}">Llamar</a>` : ""}</span>` : "";
      const discount = s.discountPct > 0 ? ` · -${s.discountPct}%` : "";
      return `<div class="sale-row ${st === "cancelada" ? "cancelada" : ""}">
        <div class="sale-info">
          <span class="sale-service">${esc(s.service || "Servicio")}${esc(discount)}</span>
          <span class="sale-meta">${esc(dt)} · ${esc(s.clientName || "Cliente")}${s.staffName ? " · con " + esc(s.staffName) : ""}</span>
          ${contact}
        </div>
        <div class="sale-right">
          <div class="sale-top">${STATE_BADGE[st] || ""}<span class="sale-amount">${MONEY(s.price)}</span></div>
          ${actions ? `<div class="sale-actions">${actions}</div>` : ""}
        </div>
      </div>`;
    }).join("") + "</div>";
    more.hidden = rows.length <= visible.length;
    more.textContent = "Ver más (" + (rows.length - visible.length) + " restantes)";
  }

  // ── CSV ──────────────────────────────────────────────────────────────────
  // Un nombre de cliente que empiece con = + - @ se abriría como fórmula en
  // Excel/Sheets: se antepone una comilla para neutralizarlo.
  function csvCell(v) {
    let s = String(v == null ? "" : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function exportCsv() {
    const now = Date.now();
    const win = windowFor(period, now) || { from: -Infinity, to: Infinity };
    const rows = historyRows(win, now);
    if (!rows.length) {
      toast("No hay citas que exportar con este filtro.");
      return;
    }
    const attLabel = { pendiente: "Sin confirmar", asistio: "Llegó", no_asistio: "No llegó" };
    const stateLabel = { cancelada: "Cancelada", porvenir: "Por venir", noshow: "No llegó", realizada: "Realizada" };
    const header = ["Fecha de la cita", "Hora", "Cliente", "Teléfono", "Servicio", "Colaborador", "Precio", "Descuento %", "Estado", "Asistencia", "Folio", "Reservada el"];
    const lines = [header.map(csvCell).join(",")];
    rows.forEach((s) => {
      const d = new Date(whenOf(s));
      lines.push([
        d.toLocaleDateString("es-MX"),
        d.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
        s.clientName || "",
        s.clientPhone || "",
        s.service || "",
        s.staffName || "",
        s.price,
        s.discountPct || 0,
        stateLabel[stateOf(s, now)],
        s.status === "cancelada" ? "" : attLabel[s.attendance] || "",
        s.folio || "",
        new Date(s.date).toLocaleString("es-MX"),
      ].map(csvCell).join(","));
    });
    // BOM para que Excel respete los acentos.
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cupo-ventas-" + new Date().toISOString().slice(0, 10) + ".csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── Render principal ─────────────────────────────────────────────────────
  function captionFor(win) {
    if (!win) return "Elige las dos fechas del rango.";
    if (!Number.isFinite(win.from)) return "Todo tu historial.";
    const last = win.to - DAY_MS;
    if (win.to - win.from <= DAY_MS) return new Date(win.from).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" });
    return "Del " + new Date(win.from).toLocaleDateString("es-MX", { day: "numeric", month: "short" }) + " al " + new Date(last).toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
  }

  function render() {
    const now = Date.now();
    const win = windowFor(period, now);
    document.getElementById("periodCaption").textContent = captionFor(win);
    document.getElementById("rangeInputs").hidden = period !== "custom";

    // "Por confirmar": citas de las últimas 2 semanas sin marcar. Más viejas
    // se dan por atendidas para no estar molestando por siempre.
    const pending = allSales.filter((s) => stateOf(s, now) === "realizada" && s.attendance === "pendiente" && whenOf(s) >= now - 14 * DAY_MS);
    const banner = document.getElementById("pendingBanner");
    banner.hidden = !pending.length;
    if (pending.length) {
      document.getElementById("pendingText").textContent = pending.length + " cita" + (pending.length === 1 ? "" : "s") + " reciente" + (pending.length === 1 ? "" : "s") + " sin confirmar si el cliente llegó.";
    }

    const w = win || { from: Infinity, to: Infinity };
    windowStartForMix = w.from;
    const inRange = allSales.filter((s) => inWin(s, w));
    const done = inRange.filter((s) => stateOf(s, now) === "realizada");
    const noshow = inRange.filter((s) => stateOf(s, now) === "noshow");
    const upcoming = inRange.filter((s) => stateOf(s, now) === "porvenir");
    const cancelled = inRange.filter((s) => stateOf(s, now) === "cancelada");

    // Tarjetas principales
    const total = sum(done);
    document.getElementById("statTotal").textContent = MONEY(total);
    document.getElementById("statCount").textContent = done.length;
    document.getElementById("statCountDetail").textContent = done.filter((s) => s.attendance === "asistio").length
      ? done.filter((s) => s.attendance === "asistio").length + " confirmadas" : "";
    document.getElementById("statTicket").textContent = MONEY(done.length ? total / done.length : 0);
    const unique = new Set(done.map(clientKey));
    document.getElementById("statClients").textContent = unique.size;
    document.getElementById("statClientsDetail").textContent = done.length > unique.size ? "Regresaron " + (done.length - unique.size) + " vez/veces" : "";

    const prevWin = previousWindow(win, period);
    const prevTotal = prevWin ? sum(allSales.filter((s) => inWin(s, prevWin) && stateOf(s, now) === "realizada")) : 0;
    renderTrend(document.getElementById("statTotalTrend"), total, prevTotal, prevWin ? PREVIOUS_LABEL[period] : null);

    // Segunda fila
    document.getElementById("statUpcoming").textContent = MONEY(sum(upcoming));
    document.getElementById("statUpcomingDetail").textContent = upcoming.length ? upcoming.length + " cita" + (upcoming.length === 1 ? "" : "s") + " reservada" + (upcoming.length === 1 ? "" : "s") : "Nada reservado por venir";

    const slotsInWin = (business.slots || []).filter((s) => s.time >= w.from && s.time < w.to);
    const booked = slotsInWin.filter((s) => s.status === "booked").length;
    const occ = slotsInWin.length ? (booked / slotsInWin.length) * 100 : null;
    document.getElementById("statOccupancy").textContent = occ == null ? "—" : occ.toFixed(0) + "%";
    document.getElementById("statOccupancyDetail").textContent = slotsInWin.length ? booked + " de " + slotsInWin.length + " cupos" : "Sin cupos publicados";

    const past = done.length + noshow.length;
    const noshowRate = past ? (noshow.length / past) * 100 : 0;
    document.getElementById("statNoShow").textContent = noshowRate.toFixed(0) + "%";
    document.getElementById("statNoShowDetail").textContent = past ? noshow.length + " de " + past + " citas" : "Sin citas pasadas";
    document.getElementById("statNoShowCard").classList.toggle("warn", noshowRate >= 10);

    const grossCount = inRange.length;
    const cancelRate = grossCount ? (cancelled.length / grossCount) * 100 : 0;
    document.getElementById("statCancelRate").textContent = cancelRate.toFixed(0) + "%";
    document.getElementById("statCancelDetail").textContent = grossCount ? cancelled.length + " de " + grossCount + " reservas" : "Sin reservas";
    document.getElementById("statCancelCard").classList.toggle("warn", cancelRate >= 20);

    // Gráficas y desgloses
    renderFillInsight(document.getElementById("fillInsight"), w, now);
    renderLineChart(document.getElementById("dayChart"), bucketRevenue(done, w), { money: true });
    renderBars(document.getElementById("weekdayChart"), bucketByWeekday(done), { money: true });
    renderBars(document.getElementById("hourChart"), bucketByHour(done), { money: true });
    renderDiscountInsight(document.getElementById("discountInsight"), done, total);
    renderRankRows(document.getElementById("serviceRank"), groupAndRank(done.filter((s) => s.service), (s) => s.service, { limit: 8 }), total, "Sin ventas con servicio registrado en este período.");
    const staffCard = document.getElementById("staffRankCard");
    if (business.staff && business.staff.length) {
      staffCard.hidden = false;
      renderRankRows(document.getElementById("staffRank"), groupAndRank(done.filter((s) => s.staffName), (s) => s.staffName), total, "Sin ventas asignadas a un colaborador en este período.");
    } else {
      staffCard.hidden = true;
    }
    renderClientMix(document.getElementById("clientMix"), document.getElementById("topClients"), done);
    renderSalesList(w, now);
  }

  // ── Eventos ──────────────────────────────────────────────────────────────
  function setPeriod(p) {
    period = p;
    histLimit = HIST_PAGE;
    document.querySelectorAll("#periodTabs button").forEach((b) => {
      const on = b.dataset.period === p;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    render();
  }

  document.getElementById("periodTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-period]");
    if (!btn) return;
    if (btn.dataset.period === "custom" && !customFrom) {
      // Primera vez: el rango arranca en los últimos 7 días.
      const today = new Date();
      customTo = today.toISOString().slice(0, 10);
      customFrom = new Date(addDays(today.getTime(), -6)).toISOString().slice(0, 10);
      document.getElementById("rangeFrom").value = customFrom;
      document.getElementById("rangeTo").value = customTo;
    }
    setPeriod(btn.dataset.period);
  });

  function onRangeChange() {
    customFrom = document.getElementById("rangeFrom").value;
    customTo = document.getElementById("rangeTo").value;
    if (customFrom && customTo && customTo < customFrom) {
      // Si el "al" queda antes que el "del", se acomodan solos.
      [customFrom, customTo] = [customTo, customFrom];
      document.getElementById("rangeFrom").value = customFrom;
      document.getElementById("rangeTo").value = customTo;
    }
    histLimit = HIST_PAGE;
    render();
  }
  document.getElementById("rangeFrom").addEventListener("change", onRangeChange);
  document.getElementById("rangeTo").addEventListener("change", onRangeChange);

  document.getElementById("histSearch").addEventListener("input", (e) => {
    histQuery = e.target.value;
    histLimit = HIST_PAGE;
    render();
  });
  document.getElementById("histFilter").addEventListener("change", (e) => {
    histFilter = e.target.value;
    histLimit = HIST_PAGE;
    render();
  });
  document.getElementById("histMore").addEventListener("click", () => {
    histLimit += HIST_PAGE;
    render();
  });
  document.getElementById("exportCsv").addEventListener("click", exportCsv);

  document.getElementById("pendingReview").addEventListener("click", () => {
    histFilter = "confirmar";
    document.getElementById("histFilter").value = "confirmar";
    // Las pendientes pueden ser de hace dos semanas: se abre un rango que las incluya.
    setPeriod("30");
    document.getElementById("salesList").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("salesList").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-att]");
    if (!btn) return;
    const sale = allSales.find((s) => s.id === btn.dataset.sale);
    if (!sale) return;
    const next = btn.dataset.att;
    btn.disabled = true;
    try {
      const res = await DataStore.setAttendance(business.id, sale.id, next);
      if (!res || !res.ok) {
        toast((res && res.error) || "No se pudo guardar. Intenta de nuevo.");
        btn.disabled = false;
        return;
      }
      sale.attendance = next;
      render();
    } catch (err) {
      console.error(err);
      toast("No se pudo guardar. Revisa tu conexión.");
      btn.disabled = false;
    }
  });

  render();
})();
