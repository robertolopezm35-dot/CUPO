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

  const S = CupoSchedule;
  const DAY_MS = 86400000;
  const FLEX = "__flex__";
  const $ = (id) => document.getElementById(id);

  function setHeader() {
    $("userName").textContent = business.name;
    $("userAvatar").textContent = business.name.charAt(0).toUpperCase();
    $("bizTitle").textContent = business.name;
  }
  setHeader();

  $("logoutBtn").addEventListener("click", async () => {
    await DataStore.clearSession();
    window.location.href = "index.html";
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

  function showToast(msg) {
    const toast = $("toast");
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), Math.max(2200, msg.length * 55));
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  // ── Fechas ────────────────────────────────────────────────────────────
  function todayKey() {
    return S.dateKey(Date.now());
  }

  function dayRange(key) {
    const start = S.parseDateKey(key);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return [start, end.getTime()];
  }

  function dayOffsetOf(key) {
    return Math.round((S.parseDateKey(key) - S.startOfDay(Date.now())) / DAY_MS);
  }

  function longDate(key) {
    const d = new Date(S.parseDateKey(key));
    const opts = { weekday: "long", day: "numeric", month: "long" };
    if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
    return d.toLocaleDateString("es-MX", opts);
  }

  function shortDate(ts) {
    return new Date(ts).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
  }

  function slotEnd(s) {
    return s.time + (s.duration || 0) * 60000;
  }

  let selectedDate = todayKey();
  let calMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  let dayIndex = new Map();
  let schedule = S.normalize(business.schedule);

  // Un solo recorrido de todos los cupos por render: cuántas citas y cuántos
  // cupos libres tiene cada día (el calendario pinta ~30 celdas de aquí).
  function buildDayIndex() {
    const now = Date.now();
    schedule = S.normalize(business.schedule);
    dayIndex = new Map();
    business.slots.forEach((s) => {
      const key = S.dateKey(s.time);
      if (!dayIndex.has(key)) dayIndex.set(key, { booked: 0, free: 0 });
      const entry = dayIndex.get(key);
      if (s.status === "booked") entry.booked++;
      else if (slotEnd(s) > now) entry.free++;
    });
  }

  function dayInfo(key) {
    const counts = dayIndex.get(key) || { booked: 0, free: 0 };
    const today = todayKey();
    const weekday = new Date(S.parseDateKey(key)).getDay();
    const rules = S.activeRules(business);
    const worksThatWeekday = rules.some((r) => r.days.includes(weekday));
    const closure = schedule.closures.find((c) => c.date === key && c.staffId === null) || null;
    const staffIds = new Set((business.staff || []).map((st) => st.id));
    return {
      booked: counts.booked,
      free: counts.free,
      past: key < today,
      today: key === today,
      closure,
      absences: closure ? [] : schedule.closures.filter((c) => c.date === key && c.staffId && staffIds.has(c.staffId)),
      off: rules.length > 0 && !worksThatWeekday,
      planned: worksThatWeekday && !closure && key > today && !counts.booked && !counts.free,
    };
  }

  // Lo que se enseña de un día: en días pasados solo las citas que hubo; de
  // hoy en adelante, citas + cupos libres que todavía no terminan.
  function slotsOn(key) {
    const [start, end] = dayRange(key);
    const now = Date.now();
    const past = key < todayKey();
    return business.slots
      .filter((s) => s.time >= start && s.time < end)
      .filter((s) => s.status === "booked" || (!past && slotEnd(s) > now))
      .sort((a, b) => a.time - b.time);
  }

  // ── Calendario ────────────────────────────────────────────────────────
  function renderCalendar() {
    const first = new Date(calMonth);
    $("calTitle").textContent = first.toLocaleDateString("es-MX", { month: "long", year: "numeric" }).replace(/^./, (c) => c.toUpperCase());
    const lead = (first.getDay() + 6) % 7; // semana de lunes a domingo
    const daysInMonth = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < lead; i++) cells.push('<span class="cal-day blank"></span>');
    for (let d = 1; d <= daysInMonth; d++) {
      const key = S.dateKey(new Date(first.getFullYear(), first.getMonth(), d).getTime());
      const info = dayInfo(key);
      const cls = ["cal-day"];
      const tags = [];
      const aria = [longDate(key)];
      if (info.today) { cls.push("today"); aria.push("hoy"); }
      if (info.past) cls.push("past");
      if (key === selectedDate) cls.push("selected");
      if (info.closure) {
        cls.push("closed");
        tags.push('<span class="cal-tag closed"><b class="cal-icon">✕</b><i>Cerrado</i></span>');
        aria.push("cerrado");
      }
      if (info.booked) {
        tags.push(`<span class="cal-tag booked"><b>${info.booked}</b><i> ${info.booked === 1 ? "cita" : "citas"}</i></span>`);
        aria.push(plural(info.booked, "cita", "citas"));
      }
      if (info.free && !info.past) {
        tags.push(`<span class="cal-tag free"><b>${info.free}</b><i> ${info.free === 1 ? "libre" : "libres"}</i></span>`);
        aria.push(plural(info.free, "cupo libre", "cupos libres"));
      }
      if (info.absences.length && !info.past) {
        tags.push('<span class="cal-tag absent"><b class="cal-icon">!</b><i>Ausencia</i></span>');
        aria.push("alguien no trabaja");
      }
      if (!info.closure && info.off && !info.booked && !info.free) {
        cls.push("off");
        if (!info.past) tags.push('<span class="cal-tag off"><i>Descanso</i></span>');
        aria.push("no se trabaja");
      }
      if (info.planned) tags.push('<span class="cal-tag planned"><i>Programado</i></span>');
      cells.push(`<button type="button" class="${cls.join(" ")}" data-date="${key}" aria-label="${esc(aria.join(", "))}" aria-pressed="${key === selectedDate}">
        <span class="cal-num">${d}</span>${tags.join("")}
      </button>`);
    }
    $("calGrid").innerHTML = cells.join("");
    $("calGrid").querySelectorAll("button.cal-day").forEach((btn) => {
      btn.addEventListener("click", () => selectDay(btn.dataset.date));
    });
  }

  function selectDay(key) {
    selectedDate = key;
    const d = new Date(S.parseDateKey(key));
    calMonth = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    $("addSlotForm").hidden = true;
    renderCalendar();
    renderDay();
  }

  function shiftMonth(delta) {
    const d = new Date(calMonth);
    calMonth = new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime();
    renderCalendar();
  }
  $("calPrev").addEventListener("click", () => shiftMonth(-1));
  $("calNext").addEventListener("click", () => shiftMonth(1));
  $("calTodayBtn").addEventListener("click", () => selectDay(todayKey()));

  // ── Panel del día ─────────────────────────────────────────────────────
  function priceHtml(d) {
    const amount = (d.from ? "desde " : "") + "$" + d.price;
    return d.originalPrice
      ? `<s>$${d.originalPrice}</s> ${amount}`
      : amount;
  }

  // slotId → su venta (teléfono, asistencia). Se llena en render().
  let salesBySlot = new Map();

  function waLink(sale, name) {
    return CupoContact.whatsappUrl(sale && sale.clientCountry, sale && sale.clientPhone, "Hola " + String(name || "").split(" ")[0] + ", te escribimos de " + business.name + " sobre tu cita. ");
  }

  // "Citas del día": una fila por cita con quién es, cómo contactarle y, si ya
  // empezó, si llegó o no. Tocar la fila abre el detalle (cancelar, etc.).
  function renderDayAgenda(slots) {
    const el = $("dayAgenda");
    const booked = slots.filter((s) => s.status === "booked").sort((a, b) => a.time - b.time);
    if (!booked.length) {
      el.innerHTML = "";
      return;
    }
    const now = Date.now();
    el.innerHTML = `<p class="day-group">Citas del día (${booked.length})</p><div class="agenda-list">` + booked.map((s) => {
      const sale = salesBySlot.get(s.id);
      const wa = waLink(sale, s.clientName);
      const tel = sale ? CupoContact.telUrl(sale.clientCountry, sale.clientPhone) : null;
      const started = s.time <= now;
      const att = sale ? sale.attendance : "pendiente";
      let status = "";
      if (sale && started) {
        status = att === "pendiente"
          ? `<button type="button" class="att-btn ok" data-att="asistio" data-sale="${esc(sale.id)}">✓ Llegó</button><button type="button" class="att-btn no" data-att="no_asistio" data-sale="${esc(sale.id)}">✗ No llegó</button>`
          : `<button type="button" class="att-btn undo ${att === "no_asistio" ? "is-no" : ""}" data-att="pendiente" data-sale="${esc(sale.id)}">${att === "asistio" ? "✓ Llegó" : "✗ No llegó"}<span>cambiar</span></button>`;
      } else if (!started) {
        status = '<span class="sale-badge upcoming">Por venir</span>';
      }
      return `<div class="agenda-row ${att === "no_asistio" ? "noshow" : ""}" data-slot="${esc(s.id)}">
        <button type="button" class="agenda-main" data-open="${esc(s.id)}" aria-label="Ver la cita de ${esc(s.clientName || "cliente")} a las ${esc(s.label)}">
          <span class="agenda-time">${esc(s.label)}</span>
          <span class="agenda-who"><strong>${esc(s.clientName || "Reservado")}${s.walkinName ? " <em>(agendado por ti)</em>" : ""}</strong>
            <span>${esc(s.service || "Servicio")} · $${s.price}${s.staffName ? " · con " + esc(s.staffName) : ""}</span></span>
        </button>
        <div class="agenda-side">
          ${(wa || tel) ? `<span class="sale-contact">${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : ""}${tel ? `<a href="${esc(tel)}">Llamar</a>` : ""}</span>` : ""}
          <span class="agenda-status">${status}</span>
        </div>
      </div>`;
    }).join("") + "</div>";
    el.querySelectorAll("[data-open]").forEach((b) => b.addEventListener("click", () => openSlotDetail(b.dataset.open)));
    el.querySelectorAll("button[data-att]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      const result = await DataStore.setAttendance(business.id, b.dataset.sale, b.dataset.att);
      if (!result || result.ok === false) {
        b.disabled = false;
        showToast((result && result.error) || "No se pudo guardar. Intenta de nuevo.");
        return;
      }
      await render({ silent: true });
    }));
  }

  function agendaSlotHtml(s, showStaff) {
    const d = S.describeSlot(business, s);
    const staff = showStaff && s.staffName ? `<span class="price">${esc(s.staffName)}</span>` : "";
    if (s.status === "booked") {
      return `<div class="slot mine" data-slot="${s.id}" title="Clic para ver la cita">
        <span class="time">${s.label}</span>
        ${s.service ? `<span class="price">${esc(s.service)}</span>` : ""}
        <span class="price">$${s.price}</span>
        ${staff}
        <span class="price">${esc(s.clientName || "Reservado")}</span>
      </div>`;
    }
    if (!d.bookable) {
      return `<div class="slot available warn" data-slot="${s.id}" title="Agrega servicios con precio en Editar negocio para que se pueda reservar">
        <span class="time">${s.label}</span>
        <span class="price">Sin servicios</span>
        ${staff}
      </div>`;
    }
    return `<div class="slot available" data-slot="${s.id}" title="Clic para editar, agendar o quitar">
      <span class="time">${s.label}</span>
      ${d.service ? `<span class="price">${esc(d.service)}</span>` : ""}
      <span class="price">${priceHtml(d)}${s.discountPct > 0 ? ` <span class="discount-badge">-${s.discountPct}%</span>` : ""}</span>
      ${staff}
      <span class="price">Disponible</span>
    </div>`;
  }

  function renderDay() {
    const key = selectedDate;
    const info = dayInfo(key);
    const slots = slotsOn(key);
    const staffList = business.staff || [];
    const staffName = (id) => (staffList.find((st) => st.id === id) || {}).name || "Alguien";

    $("dayTitle").textContent = longDate(key).replace(/^./, (c) => c.toUpperCase());
    const summary = [];
    if (info.booked) summary.push(plural(info.booked, "cita", "citas"));
    if (info.free && !info.past) summary.push(plural(info.free, "cupo libre", "cupos libres"));
    $("daySummary").textContent = summary.length ? summary.join(" · ") : (info.past ? "Sin citas ese día" : "Sin citas ni cupos");

    const badge = info.today ? "Hoy" : info.past ? "Pasado" : info.closure ? "Cerrado" : info.off ? "No se trabaja" : "";
    $("dayBadge").innerHTML = badge ? `<span class="badge">${badge}</span>` : "";

    const notices = [];
    if (info.closure) {
      const pending = info.booked && !info.past
        ? ` Tienes ${plural(info.booked, "cita reservada", "citas reservadas")}: no se cancelan solas, tócalas si necesitas cancelarlas.`
        : "";
      notices.push(`<div class="day-notice closed">
        <span>🔒 Día cerrado${info.closure.reason ? ": " + esc(info.closure.reason) : ""}.${pending}</span>
        ${info.past ? "" : '<button type="button" class="btn btn-outline btn-sm" data-reopen="">Reabrir</button>'}
      </div>`);
    }
    info.absences.forEach((c) => {
      notices.push(`<div class="day-notice">
        <span>🙅 ${esc(staffName(c.staffId))} no trabaja este día${c.reason ? ": " + esc(c.reason) : ""}.</span>
        ${info.past ? "" : `<button type="button" class="btn btn-outline btn-sm" data-reopen="${esc(c.staffId)}">Quitar</button>`}
      </div>`);
    });
    if (!info.closure && info.off && !info.past) {
      notices.push('<div class="day-notice info"><span>Según tu horario semanal este día no se trabaja. Aun así puedes publicar un cupo suelto.</span></div>');
    }
    if (info.past) {
      notices.push('<div class="day-notice info"><span>Día pasado: solo se muestran las citas que tuviste.</span></div>');
    }
    $("dayNotices").innerHTML = notices.join("");
    $("dayNotices").querySelectorAll("[data-reopen]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const result = await DataStore.reopenDay(business.id, { date: key, staffId: btn.dataset.reopen || null });
        if (!result.ok) {
          btn.disabled = false;
          showToast(result.error || "No se pudo reabrir. Intenta de nuevo.");
          return;
        }
        showToast(result.created ? `Listo: ${plural(result.created, "cupo publicado", "cupos publicados")} de nuevo.` : "Listo, día reabierto.");
        await render({ silent: true });
      });
    });

    renderDayAgenda(slots);

    const daySlots = $("daySlots");
    if (!slots.length) {
      daySlots.innerHTML = info.past || info.closure
        ? ""
        : '<div class="empty-state">No hay cupos este día. Agrega uno suelto aquí abajo, o programa tu Horario semanal para que se publiquen solos.</div>';
    } else if (staffList.length) {
      const groups = staffList
        .map((st) => ({ name: st.name, list: slots.filter((s) => s.staffId === st.id) }))
        .concat([{ name: "Sin persona asignada", list: slots.filter((s) => !staffList.some((st) => st.id === s.staffId)) }])
        .filter((g) => g.list.length);
      // En "Sin persona asignada" también caen las citas de alguien que ya
      // no está en el equipo: ahí sí se enseña el nombre que traía el cupo.
      daySlots.innerHTML = groups.map((g, i) =>
        `<p class="day-group">${esc(g.name)}</p><div class="slot-list">${g.list.map((s) => agendaSlotHtml(s, i === groups.length - 1 && g.name === "Sin persona asignada")).join("")}</div>`
      ).join("");
    } else {
      daySlots.innerHTML = `<div class="slot-list">${slots.map((s) => agendaSlotHtml(s, true)).join("")}</div>`;
    }
    daySlots.querySelectorAll(".slot").forEach((el) => {
      el.addEventListener("click", () => openSlotDetail(el.dataset.slot));
    });

    // En un día cerrado un cupo nuevo no le saldría a ningún cliente: primero
    // hay que reabrirlo (botón del aviso de arriba).
    const locked = info.past || !!info.closure;
    $("dayActions").hidden = locked;
    if (locked) $("addSlotForm").hidden = true;
  }

  function absentOn(key, staffId) {
    return !!staffId && S.isClosed(schedule, key, staffId);
  }

  // ── Publicar un cupo suelto en el día elegido ─────────────────────────
  const hourSelect = $("newHour");
  const serviceSelect = $("newService");
  const editSlotHour = $("editSlotHour");
  const editSlotService = $("editSlotService");
  const editSlotStaff = $("editSlotStaff");
  const editSlotDate = $("editSlotDate");

  function populateTimeOptions(select) {
    select.innerHTML = "";
    for (let m = 6 * 60; m <= 22 * 60 + 30; m += 30) {
      const opt = document.createElement("option");
      opt.value = m;
      opt.textContent = S.minutesLabel(m);
      select.appendChild(opt);
    }
  }

  // Los cupos del horario pueden caer en minutos que el selector no trae
  // (9:45, 10:20...): se agrega esa opción para poder mostrarla tal cual.
  function setTimeValue(select, minutes) {
    if (![...select.options].some((o) => parseInt(o.value, 10) === minutes)) {
      const opt = document.createElement("option");
      opt.value = minutes;
      opt.textContent = S.minutesLabel(minutes);
      const after = [...select.options].find((o) => parseInt(o.value, 10) > minutes);
      select.insertBefore(opt, after || null);
    }
    select.value = String(minutes);
  }

  function catalogPrice(name) {
    const item = (business.servicesCatalog || []).find((s) => s.name === name);
    return item ? item.price : null;
  }

  // Servicios para un cupo: primero los del catálogo propio del negocio
  // (con su precio), luego los sugeridos de su categoría. Si hay catálogo,
  // también "el cliente elige": un cupo flexible que ofrece todos.
  function populateServiceOptions(select, keep) {
    const current = keep !== undefined ? keep : select.value;
    const catalog = (business.servicesCatalog || []).map((s) => s.name).filter(Boolean);
    const names = Array.from(new Set(catalog.concat(DataStore.SERVICES_BY_CATEGORY[business.category] || [])));
    if (current && current !== FLEX && !names.includes(current)) names.push(current);
    select.innerHTML = "";
    if (catalog.length && business.scheduleSupported !== false) {
      const opt = document.createElement("option");
      opt.value = FLEX;
      opt.textContent = "✨ El cliente elige (cualquiera de mis servicios)";
      select.appendChild(opt);
    }
    names.forEach((name) => {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === current)) select.value = current;
    else if (names.length) select.value = names[0];
  }

  function populateStaffOptions(select, keep) {
    const current = keep !== undefined ? keep : select.value;
    select.innerHTML = '<option value="">Sin preferencia</option>';
    (business.staff || []).forEach((st) => {
      const opt = document.createElement("option");
      opt.value = st.id;
      opt.textContent = st.name;
      select.appendChild(opt);
    });
    if ([...select.options].some((o) => o.value === current)) select.value = current;
  }

  // Con "el cliente elige" el precio sale del catálogo, así que el campo se
  // apaga; con un servicio del catálogo se sugiere su precio.
  function syncPriceField(select, priceInput, suggest) {
    const flexible = select.value === FLEX;
    priceInput.disabled = flexible;
    if (flexible) {
      priceInput.value = "";
      priceInput.placeholder = "Según el servicio";
    } else {
      priceInput.placeholder = "";
      const known = catalogPrice(select.value);
      if (suggest && known != null) priceInput.value = known;
      else if (priceInput.value === "") priceInput.value = known != null ? known : 200;
    }
  }

  function flexibleFromPrice(staffId) {
    const options = S.slotOptions(business, { flexible: true, status: "available", staffId: staffId || null });
    return options.length ? S.fromPrice(options) : null;
  }

  populateTimeOptions(hourSelect);
  populateTimeOptions(editSlotHour);
  serviceSelect.addEventListener("change", () => syncPriceField(serviceSelect, $("newPrice"), true));
  editSlotService.addEventListener("change", () => syncPriceField(editSlotService, $("editSlotPrice"), true));

  $("dayAddBtn").addEventListener("click", () => {
    const form = $("addSlotForm");
    form.hidden = !form.hidden;
    if (form.hidden) return;
    populateServiceOptions(serviceSelect);
    populateStaffOptions($("newStaff"));
    syncPriceField(serviceSelect, $("newPrice"), false);
    if (selectedDate === todayKey()) {
      const now = new Date();
      const next = Math.min(22 * 60 + 30, Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30);
      setTimeValue(hourSelect, Math.max(6 * 60, next));
    } else if (!hourSelect.dataset.touched) {
      setTimeValue(hourSelect, 10 * 60);
    }
    form.scrollIntoView({ behavior: "smooth", block: "nearest" });
  });
  hourSelect.addEventListener("change", () => { hourSelect.dataset.touched = "1"; });

  const addSlotBtn = $("addSlotBtn");
  addSlotBtn.addEventListener("click", async () => {
    const dayOffset = dayOffsetOf(selectedDate);
    if (dayOffset < 0) {
      showToast("No puedes publicar un cupo en un día que ya pasó.");
      return;
    }
    const minutes = parseInt(hourSelect.value, 10);
    const staffId = $("newStaff").value;
    if (absentOn(selectedDate, staffId)) {
      showToast("Esa persona no trabaja este día (lo marcaste arriba). Quita la ausencia o elige a alguien más.");
      return;
    }
    const flexible = serviceSelect.value === FLEX;
    let price = $("newPrice").value;
    if (flexible) {
      price = flexibleFromPrice(staffId);
      if (price == null) {
        showToast("Esa persona no tiene servicios con precio. Revisa tu catálogo y el Horario semanal.");
        return;
      }
    }
    addSlotBtn.disabled = true;
    const result = await DataStore.addSlot(business.id, {
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
      duration: $("newDuration").value,
      price,
      service: flexible ? null : serviceSelect.value,
      dayOffset,
      discountPct: $("newDiscount").value,
      staffId,
      flexible,
    });
    addSlotBtn.disabled = false;
    if (result && result.ok === false) {
      showToast(result.error || "No se pudo publicar. Intenta de nuevo.");
      return;
    }
    showToast("Cupo publicado.");
    await render({ silent: true });
  });

  // ── Detalle de un cupo: editar, quitar, agendar a mano, cancelar cita ──
  const slotDetailModal = $("slotDetailModal");
  let detailSlotId = null;

  function closeSlotDetail() {
    slotDetailModal.classList.remove("show");
    detailSlotId = null;
  }
  $("closeSlotDetailBtn").addEventListener("click", closeSlotDetail);
  $("cancelSlotDetailBtn").addEventListener("click", closeSlotDetail);
  slotDetailModal.addEventListener("click", (e) => { if (e.target === slotDetailModal) closeSlotDetail(); });

  function openSlotDetail(slotId) {
    const slot = business.slots.find((s) => s.id === slotId);
    if (!slot) return;
    detailSlotId = slotId;
    const available = slot.status === "available";
    $("slotDetailContact").hidden = true;
    $("slotDetailEditable").hidden = !available;
    $("slotDetailBookedInfo").hidden = available;
    $("slotDetailActionsAvailable").hidden = !available;
    $("slotDetailActionsBooked").hidden = available;

    if (available) {
      $("slotDetailTitle").textContent = "Detalles del cupo";
      const generated = !!slot.scheduleKey;
      $("slotDetailScheduleNote").hidden = !generated;
      populateServiceOptions(editSlotService, slot.flexible ? FLEX : (slot.service || ""));
      populateStaffOptions(editSlotStaff, slot.staffId || "");
      editSlotDate.min = todayKey();
      editSlotDate.value = S.dateKey(slot.time);
      const t = new Date(slot.time);
      setTimeValue(editSlotHour, t.getHours() * 60 + t.getMinutes());
      $("editSlotDuration").value = slot.duration;
      $("editSlotPrice").value = slot.flexible ? "" : (slot.originalPrice || slot.price);
      $("editSlotDiscount").value = slot.discountPct || 0;
      syncPriceField(editSlotService, $("editSlotPrice"), false);
      [editSlotDate, editSlotHour, $("editSlotDuration"), editSlotStaff].forEach((el) => { el.disabled = generated; });

      $("walkinName").value = "";
      $("walkinPhone").value = "";
      const options = S.slotOptions(business, slot);
      const walkinService = $("walkinService");
      walkinService.hidden = !(slot.flexible && options.length > 1);
      walkinService.innerHTML = options.map((o) => `<option value="${esc(o.name)}">${esc(o.name)} — $${o.price}</option>`).join("");
    } else {
      $("slotDetailTitle").textContent = "Cita reservada";
      const upcoming = slotEnd(slot) > Date.now();
      $("slotDetailBookedInfo").textContent =
        `${slot.clientName || "Un cliente"}${slot.walkinName ? " (agendado por ti)" : ""} · ` +
        `${slot.service ? slot.service + " · " : ""}${shortDate(slot.time)}, ${slot.label}` +
        `${slot.staffName ? " · con " + slot.staffName : ""} · $${slot.price}.` +
        (upcoming ? " Si cancelas la cita, el cupo vuelve a quedar libre para alguien más." : "");
      $("reopenSlotBtn").hidden = !upcoming;
      const sale = salesBySlot.get(slot.id);
      const wa = waLink(sale, slot.clientName);
      const tel = sale ? CupoContact.telUrl(sale.clientCountry, sale.clientPhone) : null;
      const contact = $("slotDetailContact");
      contact.hidden = !(wa || tel);
      contact.innerHTML = (wa ? `<a class="btn btn-outline btn-sm" href="${esc(wa)}" target="_blank" rel="noopener">WhatsApp</a>` : "")
        + (tel ? `<a class="btn btn-outline btn-sm" href="${esc(tel)}">Llamar ${esc(CupoContact.prettyPhone(sale.clientPhone))}</a>` : "");
    }
    slotDetailModal.classList.add("show");
  }

  $("deleteSlotBtn").addEventListener("click", async () => {
    if (!detailSlotId) return;
    const slot = business.slots.find((s) => s.id === detailSlotId);
    const result = await DataStore.removeSlot(business.id, detailSlotId);
    if (result && result.ok === false) {
      showToast(result.error || "No se pudo eliminar. Intenta de nuevo.");
      return;
    }
    closeSlotDetail();
    showToast(slot && slot.scheduleKey ? "Cupo quitado. Tu horario no lo volverá a publicar ese día." : "Cupo eliminado.");
    await render({ silent: true });
  });

  const saveSlotBtn = $("saveSlotBtn");
  saveSlotBtn.addEventListener("click", async () => {
    if (!detailSlotId) return;
    const dayOffset = editSlotDate.value ? dayOffsetOf(editSlotDate.value) : -1;
    if (dayOffset < 0) {
      showToast("Elige un día de hoy en adelante.");
      return;
    }
    const minutes = parseInt(editSlotHour.value, 10);
    const staffId = editSlotStaff.value;
    if (S.isClosed(schedule, editSlotDate.value, staffId || null)) {
      showToast("Ese día está cerrado (o esa persona no trabaja). Reábrelo primero o elige otro día.");
      return;
    }
    const flexible = editSlotService.value === FLEX;
    let price = $("editSlotPrice").value;
    if (flexible) {
      price = flexibleFromPrice(staffId);
      if (price == null) {
        showToast("Esa persona no tiene servicios con precio. Revisa tu catálogo y el Horario semanal.");
        return;
      }
    }
    saveSlotBtn.disabled = true;
    const result = await DataStore.updateSlot(business.id, detailSlotId, {
      hour: Math.floor(minutes / 60),
      minute: minutes % 60,
      duration: $("editSlotDuration").value,
      price,
      service: flexible ? null : editSlotService.value,
      dayOffset,
      discountPct: $("editSlotDiscount").value,
      staffId,
      flexible,
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

  const walkinBtn = $("walkinBtn");
  async function bookWalkin() {
    if (!detailSlotId) return;
    const clientName = $("walkinName").value.trim();
    if (!clientName) {
      showToast("Escribe el nombre del cliente.");
      $("walkinName").focus();
      return;
    }
    const walkinService = $("walkinService");
    const phone = $("walkinPhone").value.replace(/\D/g, "");
    if (phone && phone.length !== 10) {
      showToast("El teléfono debe tener 10 dígitos (o déjalo vacío).");
      $("walkinPhone").focus();
      return;
    }
    walkinBtn.disabled = true;
    const result = await DataStore.bookSlotManual(business.id, detailSlotId, {
      clientName,
      phone,
      service: walkinService.hidden ? null : walkinService.value,
    });
    walkinBtn.disabled = false;
    if (!result.ok) {
      showToast(result.error || "No se pudo agendar. Intenta de nuevo.");
      await render({ silent: true });
      return;
    }
    closeSlotDetail();
    showToast(`Cita agendada para ${clientName}.`);
    await render({ silent: true });
  }
  walkinBtn.addEventListener("click", bookWalkin);
  $("walkinName").addEventListener("keydown", (e) => { if (e.key === "Enter") bookWalkin(); });

  const reopenSlotBtn = $("reopenSlotBtn");
  reopenSlotBtn.addEventListener("click", async () => {
    if (!detailSlotId) return;
    const slot = business.slots.find((s) => s.id === detailSlotId);
    if (!window.confirm(`¿Cancelar la cita de ${slot && slot.clientName ? slot.clientName : "este cliente"}? El cupo queda libre otra vez.`)) return;
    reopenSlotBtn.disabled = true;
    const result = await DataStore.reopenSlot(business.id, detailSlotId);
    reopenSlotBtn.disabled = false;
    if (result && result.ok === false) {
      showToast(result.error || "No se pudo cancelar. Intenta de nuevo.");
      return;
    }
    closeSlotDetail();
    showToast("Cita cancelada.");
    await render({ silent: true });
  });

  // ── Cerrar un día (o varios seguidos) ─────────────────────────────────
  const closeDayModal = $("closeDayModal");
  function closeCloseDay() {
    closeDayModal.classList.remove("show");
  }
  $("closeCloseDayBtn").addEventListener("click", closeCloseDay);
  $("cancelCloseDayBtn").addEventListener("click", closeCloseDay);
  closeDayModal.addEventListener("click", (e) => { if (e.target === closeDayModal) closeCloseDay(); });

  function updateCloseDayWarning() {
    const who = $("closeDayWho").value || null;
    const dates = S.dateRange(selectedDate, $("closeDayTo").value);
    const start = S.parseDateKey(dates[0]);
    const end = dayRange(dates[dates.length - 1])[1];
    const affected = business.slots.filter((s) => s.time >= start && s.time < end && (!who || s.staffId === who));
    const free = affected.filter((s) => s.status === "available").length;
    const booked = affected.filter((s) => s.status === "booked").length;
    const parts = [];
    if (dates.length > 1) parts.push(`Se cierran ${dates.length} días seguidos.`);
    parts.push(free ? `Se ${free === 1 ? "quitará 1 cupo libre" : "quitarán " + free + " cupos libres"}.` : "No hay cupos libres que quitar.");
    if (booked) parts.push(`Hay ${plural(booked, "cita ya reservada", "citas ya reservadas")}: no se cancelan solas, cancélalas tú desde el calendario si hace falta.`);
    $("closeDayWarning").textContent = parts.join(" ");
    $("confirmCloseDayBtn").textContent = dates.length > 1 ? `Cerrar ${dates.length} días` : "Cerrar día";
  }
  $("closeDayWho").addEventListener("change", updateCloseDayWarning);
  $("closeDayTo").addEventListener("change", updateCloseDayWarning);

  $("dayCloseBtn").addEventListener("click", () => {
    $("closeDayText").textContent = "Vas a cerrar el " + longDate(selectedDate) + ". Ese día no se publican cupos y se quitan los que seguían libres.";
    $("closeDayTo").value = "";
    $("closeDayTo").min = selectedDate;
    $("closeDayReason").value = "";
    const staffList = business.staff || [];
    $("closeDayWhoField").hidden = !staffList.length;
    $("closeDayWho").innerHTML = '<option value="">Todo el negocio</option>' +
      staffList.map((st) => `<option value="${esc(st.id)}">Solo ${esc(st.name)}</option>`).join("");
    updateCloseDayWarning();
    closeDayModal.classList.add("show");
  });

  const confirmCloseDayBtn = $("confirmCloseDayBtn");
  confirmCloseDayBtn.addEventListener("click", async () => {
    confirmCloseDayBtn.disabled = true;
    const result = await DataStore.closeDay(business.id, {
      date: selectedDate,
      dateTo: $("closeDayTo").value || null,
      staffId: $("closeDayWho").value || null,
      reason: $("closeDayReason").value,
    });
    confirmCloseDayBtn.disabled = false;
    if (!result.ok) {
      showToast(result.error || "No se pudo cerrar el día. Intenta de nuevo.");
      return;
    }
    closeCloseDay();
    showToast(result.days > 1 ? `Listo: ${result.days} días cerrados.` : "Día cerrado.");
    await render({ silent: true });
  });

  // ── Horario semanal ───────────────────────────────────────────────────
  const scheduleModal = $("scheduleModal");
  const EVERY_OPTIONS = [15, 20, 30, 40, 45, 60, 75, 90, 120];
  const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
  let draft = null;
  let draftSnapshot = null;

  function catalogNames() {
    return Array.from(new Set((business.servicesCatalog || []).map((s) => s.name).filter(Boolean)));
  }

  function draftState() {
    return JSON.stringify(draft.lanes.map((l) => [l.staffId, l.services, l.rules]));
  }

  function buildDraft() {
    const names = catalogNames();
    const rulesOf = (staffId) => schedule.rules
      .filter((r) => r.staffId === staffId)
      .map((r) => ({ id: r.id, days: r.days.slice(), start: r.start, end: r.end, every: r.every }));
    const lanes = (business.staff || []).map((st) => ({
      staffId: st.id,
      name: st.name,
      services: st.services && st.services.length ? names.filter((n) => st.services.includes(n)) : names.slice(),
      rules: rulesOf(st.id),
    }));
    lanes.push({ staffId: null, name: "", services: names.slice(), rules: rulesOf(null) });
    return { lanes };
  }

  function timeOptionsHtml(selected, from, to) {
    const values = [];
    for (let m = from; m <= to; m += 30) values.push(m);
    if (!values.includes(selected)) values.push(selected);
    return values.sort((a, b) => a - b).map((m) =>
      `<option value="${m}" ${m === selected ? "selected" : ""}>${m === 1440 ? "Medianoche" : S.minutesLabel(m)}</option>`
    ).join("");
  }

  function ruleSlotsPerWeek(rule) {
    return S.ruleError(rule) ? 0 : Math.floor((rule.end - rule.start) / rule.every) * rule.days.length;
  }

  function renderScheduleCards() {
    const names = catalogNames();
    const hasStaff = draft.lanes.length > 1;
    $("scheduleCards").innerHTML = draft.lanes.map((lane, li) => {
      const others = draft.lanes.filter((l, i) => i !== li && l.rules.length);
      const title = lane.staffId
        ? "👤 " + esc(lane.name)
        : (hasStaff ? "🏪 Sin persona asignada" : "🏪 Mi negocio");
      const sub = !lane.staffId && hasStaff
        ? '<span class="field-hint">Opcional: cupos que puede atender cualquiera del equipo.</span>'
        : "";
      const services = lane.staffId && names.length
        ? `<span class="sched-label">Servicios que hace ${esc(lane.name)}</span>
           <div class="sched-services">${names.map((n) =>
             `<button type="button" class="sched-chip ${lane.services.includes(n) ? "active" : ""}" data-service="${esc(n)}" aria-pressed="${lane.services.includes(n)}">${esc(n)}</button>`
           ).join("")}</div>`
        : "";
      const rules = lane.rules.map((rule, ri) => {
        const error = S.ruleError(rule);
        const perDay = error ? 0 : Math.floor((rule.end - rule.start) / rule.every);
        return `<div class="sched-rule ${error ? "invalid" : ""}" data-rule="${ri}">
          <div class="sched-days">${WEEK_ORDER.map((d) =>
            `<button type="button" class="sched-day ${rule.days.includes(d) ? "active" : ""}" data-day="${d}" aria-pressed="${rule.days.includes(d)}" aria-label="${S.WEEKDAYS_LONG[d]}">${S.WEEKDAYS_SHORT[d]}</button>`
          ).join("")}<button type="button" class="btn-link-danger sched-remove" data-remove-rule aria-label="Quitar turno">✕</button></div>
          <div class="sched-times">
            <span>De</span>
            <select data-field="start" aria-label="Hora de entrada">${timeOptionsHtml(rule.start, 300, 1410)}</select>
            <span>a</span>
            <select data-field="end" aria-label="Hora de salida">${timeOptionsHtml(rule.end, 330, 1440)}</select>
            <span>· una cita cada</span>
            <select data-field="every" aria-label="Duración de cada cita">${EVERY_OPTIONS.map((m) => `<option value="${m}" ${m === rule.every ? "selected" : ""}>${m} min</option>`).join("")}</select>
          </div>
          <div class="sched-rule-info">${error ? esc(error) : `${plural(perDay, "cita", "citas")} por día · ${plural(rule.days.length, "día", "días")} a la semana`}</div>
        </div>`;
      }).join("");
      return `<div class="sched-card" data-lane="${li}">
        <div class="sched-card-head">
          <div><strong>${title}</strong>${sub}</div>
          ${others.length ? `<select data-copy aria-label="Copiar turnos de otra persona">
            <option value="">Copiar turnos de…</option>
            ${draft.lanes.map((l, i) => (i !== li && l.rules.length ? `<option value="${i}">${l.staffId ? esc(l.name) : "Sin persona asignada"}</option>` : "")).join("")}
          </select>` : ""}
        </div>
        ${services}
        <span class="sched-label">Turnos</span>
        ${rules || '<p class="field-hint sched-empty">Sin turnos: aquí no se publican cupos automáticos.</p>'}
        <button type="button" class="btn btn-outline btn-sm" data-add-rule>+ Agregar turno</button>
      </div>`;
    }).join("");

    const total = draft.lanes.reduce((sum, l) => sum + l.rules.reduce((n, r) => n + ruleSlotsPerWeek(r), 0), 0);
    $("scheduleTotal").textContent = total
      ? `En total: ${plural(total, "cupo", "cupos")} por semana.`
      : "Todavía no hay turnos: agrega al menos uno para que tus cupos se publiquen solos.";

    $("scheduleCards").querySelectorAll(".sched-card").forEach((card) => {
      const lane = draft.lanes[parseInt(card.dataset.lane, 10)];
      card.querySelectorAll("[data-service]").forEach((chip) => {
        chip.addEventListener("click", () => {
          const name = chip.dataset.service;
          if (lane.services.includes(name)) {
            if (lane.services.length === 1) {
              showToast("Cada persona debe hacer al menos un servicio.");
              return;
            }
            lane.services = lane.services.filter((n) => n !== name);
          } else {
            lane.services = catalogNames().filter((n) => n === name || lane.services.includes(n));
          }
          renderScheduleCards();
        });
      });
      const add = card.querySelector("[data-add-rule]");
      add.addEventListener("click", () => {
        // Un segundo turno casi siempre es "la tarde, después de comer":
        // mismos días, una hora después de que termina el anterior.
        const last = lane.rules[lane.rules.length - 1];
        const start = last ? last.end + 60 : 9 * 60;
        lane.rules.push(last && start + last.every <= 1440
          ? { id: S.newRuleId(), days: last.days.slice(), start, end: Math.min(1440, start + 240), every: last.every }
          : { id: S.newRuleId(), days: [1, 2, 3, 4, 5], start: 9 * 60, end: 18 * 60, every: 60 });
        renderScheduleCards();
      });
      const copy = card.querySelector("[data-copy]");
      if (copy) {
        copy.addEventListener("change", () => {
          if (copy.value === "") return;
          const source = draft.lanes[parseInt(copy.value, 10)];
          lane.rules = source.rules.map((r) => ({ ...r, id: S.newRuleId(), days: r.days.slice() }));
          renderScheduleCards();
        });
      }
      card.querySelectorAll(".sched-rule").forEach((row) => {
        const rule = lane.rules[parseInt(row.dataset.rule, 10)];
        row.querySelectorAll("[data-day]").forEach((btn) => {
          btn.addEventListener("click", () => {
            const day = parseInt(btn.dataset.day, 10);
            rule.days = rule.days.includes(day) ? rule.days.filter((d) => d !== day) : rule.days.concat(day).sort();
            renderScheduleCards();
          });
        });
        row.querySelectorAll("select[data-field]").forEach((sel) => {
          sel.addEventListener("change", () => {
            rule[sel.dataset.field] = parseInt(sel.value, 10);
            renderScheduleCards();
          });
        });
        row.querySelector("[data-remove-rule]").addEventListener("click", () => {
          lane.rules.splice(parseInt(row.dataset.rule, 10), 1);
          renderScheduleCards();
        });
      });
    });
  }

  function openSchedule() {
    draft = buildDraft();
    draftSnapshot = draftState();
    const warning = $("scheduleWarning");
    const saveBtn = $("saveScheduleBtn");
    saveBtn.disabled = false;
    if (business.scheduleSupported === false) {
      warning.hidden = false;
      warning.innerHTML = "<span>Falta un paso en Supabase para activar el horario semanal: corre <code>db/migracion-horario-semanal.sql</code> en el SQL Editor y recarga esta página.</span>";
      saveBtn.disabled = true;
    } else if (!catalogNames().length) {
      warning.hidden = false;
      warning.innerHTML = '<span>Primero necesitas al menos un servicio con precio: de ahí salen los servicios y precios de cada cupo.</span><button type="button" class="btn btn-primary btn-sm" id="scheduleGoCatalog">Agregar servicios</button>';
      saveBtn.disabled = true;
      $("scheduleGoCatalog").addEventListener("click", () => {
        closeSchedule({ force: true });
        openEditModal();
      });
    } else {
      warning.hidden = true;
    }
    $("scheduleStaffHint").textContent = (business.staff || []).length
      ? "¿Entró o salió alguien del equipo? Se cambia en Editar negocio → Personal."
      : "¿Trabajan varias personas? Agrégalas en Editar negocio → Personal y cada quien tendrá aquí su propio horario y sus servicios.";
    renderScheduleCards();
    scheduleModal.classList.add("show");
  }

  function closeSchedule({ force } = {}) {
    if (!force && draft && draftState() !== draftSnapshot && !window.confirm("Tienes cambios sin guardar en tu horario. ¿Descartarlos?")) return;
    draft = null;
    scheduleModal.classList.remove("show");
  }
  $("scheduleBtn").addEventListener("click", openSchedule);
  $("scheduleNudgeBtn").addEventListener("click", openSchedule);
  $("closeScheduleBtn").addEventListener("click", () => closeSchedule());
  $("cancelScheduleBtn").addEventListener("click", () => closeSchedule());
  scheduleModal.addEventListener("click", (e) => { if (e.target === scheduleModal) closeSchedule(); });

  const saveScheduleBtn = $("saveScheduleBtn");
  saveScheduleBtn.addEventListener("click", async () => {
    const names = catalogNames();
    const rules = [];
    const staffServices = {};
    let invalid = false;
    draft.lanes.forEach((lane) => {
      if (lane.staffId) staffServices[lane.staffId] = lane.services.length === names.length ? [] : lane.services.slice();
      lane.rules.forEach((r) => {
        const rule = { id: r.id, staffId: lane.staffId, days: r.days.slice(), start: r.start, end: r.end, every: r.every };
        if (S.ruleError(rule)) invalid = true;
        rules.push(rule);
      });
    });
    if (invalid) {
      showToast("Revisa los turnos marcados en rojo.");
      return;
    }
    saveScheduleBtn.disabled = true;
    saveScheduleBtn.textContent = "Publicando cupos...";
    const result = await DataStore.saveSchedule(business.id, { rules, staffServices });
    saveScheduleBtn.disabled = false;
    saveScheduleBtn.textContent = "Guardar horario";
    if (!result.ok) {
      showToast(result.error || "No se pudo guardar el horario. Intenta de nuevo.");
      return;
    }
    closeSchedule({ force: true });
    showToast(rules.length
      ? `Horario guardado. ${plural(result.created, "cupo nuevo publicado", "cupos nuevos publicados")} para las próximas 4 semanas.`
      : "Horario guardado. Ya no se publican cupos automáticos.");
    await render({ silent: true });
  });

  // ── Editar negocio ────────────────────────────────────────────────────
  const editModal = $("editModal");
  const editCategorySelect = $("editCategory");
  DataStore.CATEGORIES.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    editCategorySelect.appendChild(opt);
  });

  function addServiceRow(name, price) {
    const container = $("editServicesRows");
    const row = document.createElement("div");
    row.className = "edit-row";
    row.innerHTML =
      '<input type="text" class="svc-name" placeholder="Servicio" value="' + esc(name || "") + '">' +
      '<input type="number" class="svc-price" placeholder="Precio" min="0" step="10" value="' + (price === 0 || price ? price : "") + '">' +
      '<button type="button" class="btn-link-danger remove-row" aria-label="Eliminar servicio">✕</button>';
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  function addStaffRow(name, id) {
    const container = $("editStaffRows");
    const row = document.createElement("div");
    row.className = "edit-row";
    row.dataset.staffId = id || ("ST-" + Math.random().toString(36).slice(2, 8));
    row.innerHTML =
      '<input type="text" class="staff-name" placeholder="Nombre" value="' + esc(name || "") + '">' +
      '<button type="button" class="btn-link-danger remove-row" aria-label="Eliminar persona">✕</button>';
    row.querySelector(".remove-row").addEventListener("click", () => row.remove());
    container.appendChild(row);
  }

  $("addServiceRowBtn").addEventListener("click", () => addServiceRow("", ""));
  $("addStaffRowBtn").addEventListener("click", () => addStaffRow("", ""));
  $("suggestServicesBtn").addEventListener("click", () => {
    const existing = Array.from(document.querySelectorAll("#editServicesRows .svc-name")).map((el) => el.value.trim().toLowerCase());
    const missing = (DataStore.SERVICES_BY_CATEGORY[editCategorySelect.value] || []).filter((n) => !existing.includes(n.toLowerCase()));
    if (!missing.length) {
      showToast("Ya tienes todos los servicios sugeridos de esa categoría.");
      return;
    }
    missing.forEach((n) => addServiceRow(n, ""));
    showToast("Agregados. Ponle precio a cada uno y quita los que no ofrezcas.");
  });

  const editPhotoFileInput = $("editPhotoFile");
  const editPhotoHint = $("editPhotoHint");
  const editPhotoHintDefault = editPhotoHint.textContent;
  editPhotoFileInput.addEventListener("change", async () => {
    const files = Array.from(editPhotoFileInput.files || []);
    if (!files.length) return;
    const photosTextarea = $("editPhotos");
    editPhotoFileInput.disabled = true;
    for (const file of files) {
      editPhotoHint.textContent = "Subiendo " + file.name + "...";
      const result = await DataStore.uploadPhoto(business.id, file, "business");
      if (!result.ok) {
        showToast(result.error || "No se pudo subir la foto.");
        continue;
      }
      const current = photosTextarea.value.trim();
      photosTextarea.value = current ? current + "\n" + result.url : result.url;
    }
    editPhotoHint.textContent = editPhotoHintDefault;
    editPhotoFileInput.disabled = false;
    editPhotoFileInput.value = "";
  });

  // Para avisar si cierran el modal con cambios sin guardar: una foto del
  // estado del formulario al abrirlo, comparada contra el estado actual.
  let editModalSnapshot = null;
  function captureEditModalState() {
    return JSON.stringify({
      name: $("editName").value,
      category: $("editCategory").value,
      address: $("editAddress").value,
      phone: $("editPhone").value,
      cancelHours: $("editCancelHours").value,
      photos: $("editPhotos").value,
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

  function openEditModal() {
    $("editName").value = business.name;
    $("editCategory").value = business.category;
    $("editAddress").value = business.address;
    $("editPhone").value = business.phone || "";
    // Si el negocio trae un valor distinto de las opciones, se agrega para no perderlo.
    const hours = String(business.cancelHours != null ? business.cancelHours : 1);
    const hoursSelect = $("editCancelHours");
    if (!Array.from(hoursSelect.options).some((o) => o.value === hours)) {
      hoursSelect.add(new Option("Hasta " + hours + " h antes", hours));
    }
    hoursSelect.value = hours;
    $("editPhotos").value = (business.photos || []).join("\n");
    editPhotoFileInput.value = "";

    $("editServicesRows").innerHTML = "";
    (business.servicesCatalog || []).forEach((s) => addServiceRow(s.name, s.price));

    $("editStaffRows").innerHTML = "";
    (business.staff || []).forEach((s) => addStaffRow(s.name, s.id));

    editModal.classList.add("show");
    editModalSnapshot = captureEditModalState();
  }
  $("editProfileBtn").addEventListener("click", openEditModal);

  function closeEditModal({ force } = {}) {
    if (!force && editModalDirty() && !window.confirm("Tienes cambios sin guardar. ¿Descartarlos?")) {
      return;
    }
    editModalSnapshot = null;
    editModal.classList.remove("show");
  }
  $("cancelEditBtn").addEventListener("click", () => closeEditModal());
  $("closeEditBtn").addEventListener("click", () => closeEditModal());
  editModal.addEventListener("click", (e) => { if (e.target === editModal) closeEditModal(); });

  const saveEditBtn = $("saveEditBtn");
  saveEditBtn.addEventListener("click", async () => {
    const name = $("editName").value.trim();
    const category = $("editCategory").value;
    const address = $("editAddress").value.trim();
    if (!name || !address) return;
    const phone = $("editPhone").value.replace(/\D/g, "");
    if (phone && phone.length !== 10) {
      showToast("El teléfono del negocio debe tener 10 dígitos (o déjalo vacío).");
      $("editPhone").focus();
      return;
    }
    const cancelHours = parseInt($("editCancelHours").value, 10);

    const photos = $("editPhotos").value
      .split("\n").map((s) => s.trim()).filter(Boolean);

    // Un servicio sin precio quedaría reservable en $0 en los cupos del
    // horario semanal: mejor pedirlo aquí que descubrirlo con un cliente.
    const serviceRows = Array.from(document.querySelectorAll("#editServicesRows .edit-row"))
      .map((row) => ({ name: row.querySelector(".svc-name").value.trim(), raw: row.querySelector(".svc-price").value.trim() }))
      .filter((s) => s.name);
    const unpriced = serviceRows.find((s) => s.raw === "");
    if (unpriced) {
      showToast(`Ponle precio a “${unpriced.name}” (o quítalo de tu catálogo).`);
      return;
    }
    const servicesCatalog = serviceRows.map((s) => ({ name: s.name, price: parseInt(s.raw, 10) || 0 }));

    const staff = Array.from(document.querySelectorAll("#editStaffRows .edit-row")).map((row) => ({
      id: row.dataset.staffId,
      name: row.querySelector(".staff-name").value.trim(),
    })).filter((s) => s.name);

    saveEditBtn.disabled = true;
    const result = await DataStore.updateBusiness(business.id, { name, category, address, servicesCatalog, photos, staff, phone, cancelHours });
    if (result && result.ok === false) {
      saveEditBtn.disabled = false;
      showToast(result.error || "No se pudo guardar el perfil. Intenta de nuevo.");
      return;
    }
    // Quitar a alguien del equipo deja sus turnos sin dueño: el horario se
    // vuelve a cuadrar para que no queden cupos de una persona que ya no está.
    await DataStore.syncSchedule(business.id);
    saveEditBtn.disabled = false;
    closeEditModal({ force: true });
    showToast("Perfil actualizado.");
    await render({ silent: true });
    setHeader();
  });

  // ── Vista previa: la tarjeta tal como la ve un cliente ────────────────
  // Si la foto de un negocio en Vista previa no carga, cae de vuelta al
  // gradiente+emoji de siempre — igual que en cliente.js.
  window.__cupoPhotoError = function (img) {
    img.style.display = "none";
    const gallery = img.parentElement;
    if (!gallery) return;
    const allHidden = Array.from(gallery.querySelectorAll("img")).every((im) => im.style.display === "none");
    if (allHidden) {
      gallery.outerHTML = `<div class="biz-photo" style="background:${gallery.dataset.fallbackCss}"><span class="photo-icon">${gallery.dataset.fallbackEmoji}</span></div>`;
    }
  };

  // Mismo cálculo que businessPhoto()/avgRating() en cliente.js — duplicado
  // aquí para que Vista previa se vea igual sin cargar ese archivo entero.
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

  const previewModal = $("previewModal");
  function closePreview() {
    previewModal.classList.remove("show");
  }
  $("closePreviewBtn").addEventListener("click", closePreview);
  $("closePreviewBtn2").addEventListener("click", closePreview);
  previewModal.addEventListener("click", (e) => { if (e.target === previewModal) closePreview(); });

  function renderPreviewCard() {
    const b = business;
    const now = Date.now();
    const [todayStart, todayEnd] = dayRange(todayKey());
    // Igual que el panel del cliente: nada que ya empezó, ni cupos libres
    // sin servicio que ofrecer.
    const slotsForDay = b.slots
      .filter((s) => s.time >= todayStart && s.time < todayEnd && s.time > now)
      .filter((s) => s.status !== "available" || S.describeSlot(b, s).bookable);
    const availableCount = slotsForDay.filter((s) => s.status === "available").length;
    const urgencyHtml = availableCount > 0 && availableCount <= 2
      ? `<span class="urgency-badge">¡Solo queda${availableCount === 1 ? "" : "n"} ${availableCount}!</span>`
      : "";
    const slotsHtml = slotsForDay.length
      ? slotsForDay.map((s) => {
          const cls = s.status === "available" ? "available" : "booked";
          const d = S.describeSlot(b, s);
          const price = s.status === "booked"
            ? `<span class="price">$${s.price} · ocupado</span>`
            : `<span class="price">${priceHtml(d)}${s.discountPct > 0 ? ` <span class="discount-badge">-${s.discountPct}%</span>` : ""}</span>`;
          return `<div class="slot ${cls}">
            <span class="time">${s.label}</span>
            ${d.service ? `<span class="price">${esc(d.service)}</span>` : ""}
            <span class="price">${s.duration} min</span>
            ${s.staffName ? `<span class="price">con ${esc(s.staffName)}</span>` : ""}
            ${price}
          </div>`;
        }).join("")
      : '<span style="color:var(--gray);font-size:13.5px">Sin horarios publicados para hoy</span>';

    const photo = businessPhoto(b);
    const rating = avgRating(b);

    const photoHtml = b.photos && b.photos.length
      ? `<div class="photo-gallery" data-fallback-emoji="${photo.emoji}" data-fallback-css="${photo.css.replace(/"/g, "&quot;")}">${b.photos.slice(0, 5).map((url) => `<img src="${esc(url)}" alt="Foto de ${esc(b.name)}" onerror="window.__cupoPhotoError(this)">`).join("")}</div>`
      : `<div class="biz-photo" style="background:${photo.css}"><span class="photo-icon">${photo.emoji}</span></div>`;

    const catalogHtml = b.servicesCatalog && b.servicesCatalog.length
      ? `<details class="catalog-details" open>
          <summary>Servicios y precios (${b.servicesCatalog.length})</summary>
          ${b.servicesCatalog.map((s) => `<div class="catalog-row"><span>${esc(s.name)}</span><span>$${s.price}</span></div>`).join("")}
        </details>`
      : "";

    const recentReviews = (b.reviews || []).slice(0, 2);
    const reviewsHtml = `<details class="catalog-details">
        <summary>★ ${rating.value.toFixed(1)} (${rating.count} reseña${rating.count === 1 ? "" : "s"})</summary>
        ${recentReviews.length ? recentReviews.map((r) => `<div class="review-row"><strong>${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</strong> ${r.comment ? "— " + esc(r.comment) : ""} <span class="review-author">· ${esc(r.clientName)}</span>${r.photoUrl ? `<img class="review-photo" src="${esc(r.photoUrl)}" alt="Foto de la reseña de ${esc(r.clientName)}">` : ""}</div>`).join("") : '<div class="review-row" style="color:var(--gray)">Sin reseñas todavía.</div>'}
      </details>`;

    $("previewCardContainer").innerHTML = `<div class="biz-card">
      ${photoHtml}
      <div class="biz-head">
        <div>
          <p class="biz-name">${esc(b.name)}</p>
          <div class="biz-meta">
            <span>${esc(b.address)}</span>
            <span>★ ${rating.value.toFixed(1)}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px">
          <span class="badge">${esc(b.category)}</span>
          ${urgencyHtml}
        </div>
      </div>
      ${catalogHtml}
      <div class="slot-list">${slotsHtml}</div>
      ${reviewsHtml}
    </div>`;
  }

  $("previewBtn").addEventListener("click", async () => {
    try {
      business = await getBusiness();
    } catch (err) {
      console.error("getBusiness for preview failed:", err);
    }
    renderPreviewCard();
    previewModal.classList.add("show");
  });

  // ── Render general ────────────────────────────────────────────────────
  function renderStats() {
    const now = Date.now();
    const [todayStart, todayEnd] = dayRange(todayKey());
    const weekEnd = todayStart + 7 * DAY_MS;
    const today = business.slots.filter((s) => s.time >= todayStart && s.time < todayEnd);
    $("statToday").textContent = today.filter((s) => s.status === "booked").length;
    $("statFreeToday").textContent = today.filter((s) => s.status === "available" && slotEnd(s) > now).length;
    $("statWeek").textContent = business.slots.filter((s) => s.status === "booked" && s.time >= todayStart && s.time < weekEnd).length;
  }

  function renderBookings() {
    const todayStart = S.startOfDay(Date.now());
    const upcoming = business.slots
      .filter((s) => s.status === "booked" && s.time >= todayStart)
      .sort((a, b) => a.time - b.time);
    const bookingsList = $("bookingsList");
    if (!upcoming.length) {
      bookingsList.innerHTML = '<div class="empty-state">Ningún cliente ha reservado todavía.</div>';
    } else {
      const shown = upcoming.slice(0, 40);
      bookingsList.innerHTML = '<div class="biz-card">' + shown.map((s) =>
        `<div class="reservation-row clickable" data-slot="${s.id}" title="Clic para ver la cita">
          <span>${shortDate(s.time)} · ${s.label} · ${esc(s.clientName || "Reservado")}${s.service ? " · " + esc(s.service) : ""}${s.staffName ? " · con " + esc(s.staffName) : ""}</span>
          <strong>$${s.price}</strong>
        </div>`
      ).join("") + (upcoming.length > shown.length ? `<p class="field-hint" style="margin-top:10px">y ${upcoming.length - shown.length} más — búscalas en el calendario.</p>` : "") + '</div>';
      bookingsList.querySelectorAll("[data-slot]").forEach((row) => {
        row.addEventListener("click", () => {
          const slot = business.slots.find((s) => s.id === row.dataset.slot);
          if (!slot) return;
          selectDay(S.dateKey(slot.time));
          openSlotDetail(slot.id);
        });
      });
    }

    // Citas ya atendidas (cupos reservados con fecha anterior a hoy). Es
    // solo un recordatorio visual — el detalle de ventas/cancelaciones
    // vive en el dashboard de Ventas, que lee de la tabla sales.
    const pastBooked = business.slots
      .filter((s) => s.time < todayStart && s.status === "booked")
      .sort((a, b) => b.time - a.time);
    const pastAppointmentsList = $("pastAppointmentsList");
    if (!pastBooked.length) {
      pastAppointmentsList.innerHTML = '<div class="empty-state">Todavía no tienes citas pasadas.</div>';
    } else {
      pastAppointmentsList.innerHTML = '<div class="biz-card">' + pastBooked.slice(0, 60).map((s) =>
        `<div class="reservation-row">
          <span>${shortDate(s.time)} · ${esc(s.clientName || "Reservado")} · ${s.service ? esc(s.service) + " · " : ""}${s.label}${s.staffName ? " · " + esc(s.staffName) : ""}</span>
          <strong>$${s.price}</strong>
        </div>`
      ).join("") + '</div>';
    }
  }

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
    if (!business) return;
    // Teléfono y asistencia de cada cita viven en las ventas (solo las ve el
    // propio negocio). Si falla leerlas se conserva lo último que se tenía.
    try {
      const sales = await DataStore.getSales(business.id);
      salesBySlot = new Map();
      sales
        .filter((v) => v.status === "completada" && v.slotId)
        .sort((a, b) => a.date - b.date)
        .forEach((v) => salesBySlot.set(v.slotId, v));
    } catch (err) {
      console.error("getSales failed:", err);
    }
    buildDayIndex();
    $("scheduleNudge").hidden = S.activeRules(business).length > 0;
    renderStats();
    renderCalendar();
    renderDay();
    renderBookings();
  }

  // El horario semanal solo lo puede "publicar" el propio negocio, así que
  // se pone al corriente cada vez que abre su panel (y si se queda abierto
  // de un día para otro, al cambiar la fecha).
  // Solo se da por hecho cuando de verdad funcionó: si falla (red caída), se
  // reintenta en el siguiente ciclo en vez de quedarse sin publicar todo el día.
  let lastSyncDay = null;
  let syncFailures = 0;
  async function syncIfNeeded() {
    const today = todayKey();
    if (lastSyncDay === today || syncFailures >= 5) return;
    try {
      const result = await DataStore.syncSchedule(business.id);
      if (!result || result.ok === false) throw new Error((result && result.error) || "sin respuesta");
      lastSyncDay = today;
      syncFailures = 0;
      if (result.created || result.removed) await render({ silent: true });
    } catch (err) {
      syncFailures++;
      console.error("syncSchedule failed:", err);
    }
  }

  await render();
  await syncIfNeeded();

  const modals = [slotDetailModal, editModal, scheduleModal, closeDayModal, previewModal];
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    closeSlotDetail();
    closeCloseDay();
    closePreview();
    if (editModal.classList.contains("show")) closeEditModal();
    if (scheduleModal.classList.contains("show")) closeSchedule();
  });

  // Igual que en el panel del cliente: si reservan un cupo desde otro
  // dispositivo mientras el negocio tiene la agenda abierta, que se entere
  // sin recargar. Se salta el ciclo si hay un modal abierto.
  setInterval(async () => {
    if (document.hidden) return;
    if (modals.some((m) => m.classList.contains("show"))) return;
    await render({ silent: true });
    await syncIfNeeded();
  }, 20000);
})();
