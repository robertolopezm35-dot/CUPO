// Lógica del "Horario semanal": el negocio define su semana una sola vez
// (turnos por persona) y de ahí salen solos los cupos de las próximas
// semanas. Este archivo no toca ni el DOM ni la base de datos — solo decide
// QUÉ cupos deberían existir. CupoStore (localStorage) y SupabaseStore
// (Postgres) lo usan igual y cada uno se encarga de guardarlos a su manera.
//
// Formas de los datos:
//   business.schedule = {
//     rules:    [{ id, staffId|null, days: [0-6 con 0 = domingo], start, end, every }]
//               (start/end/every en minutos: 540 = 9:00 AM, every = duración de cada cita)
//     closures: [{ date: "AAAA-MM-DD", staffId|null, reason }]   (staffId null = todo el negocio)
//     skips:    ["<llave de cupo>", ...]   cupos del horario que el negocio quitó a mano
//   }
//   slot.scheduleKey  — de qué turno/día/hora salió (null si se publicó a mano)
//   slot.flexible     — el cliente elige el servicio al reservar (de los que hace esa persona)
const CupoSchedule = (() => {
  const HORIZON_DAYS = 28;
  const WEEKDAYS_SHORT = ["D", "L", "M", "M", "J", "V", "S"];
  const WEEKDAYS_LONG = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function startOfDay(ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function dateKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function parseDateKey(key) {
    const [y, m, d] = String(key).split("-").map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  function minutesLabel(min) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    const displayH = h % 12 === 0 ? 12 : h % 12;
    return displayH + ":" + pad(m) + " " + (h >= 12 ? "PM" : "AM");
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    return minutesLabel(d.getHours() * 60 + d.getMinutes());
  }

  function newRuleId() {
    return "r" + Math.random().toString(36).slice(2, 9);
  }

  function ruleError(rule) {
    if (!rule.days || !rule.days.length) return "Elige al menos un día.";
    if (!(rule.end > rule.start)) return "La hora de salida debe ser después de la de entrada.";
    if (!(rule.every >= 5)) return "La duración de cada cita debe ser de al menos 5 minutos.";
    if (rule.end - rule.start < rule.every) return "En ese turno no cabe ni una cita completa.";
    return null;
  }

  function cleanRule(raw) {
    if (!raw || typeof raw !== "object") return null;
    const days = Array.from(new Set(
      (Array.isArray(raw.days) ? raw.days : []).map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
    )).sort();
    const rule = {
      id: String(raw.id || newRuleId()),
      staffId: raw.staffId || null,
      days,
      start: parseInt(raw.start, 10),
      end: parseInt(raw.end, 10),
      every: parseInt(raw.every, 10),
    };
    if (!(rule.start >= 0) || !(rule.end <= 1440) || ruleError(rule)) return null;
    return rule;
  }

  function normalize(raw) {
    const s = raw && typeof raw === "object" ? raw : {};
    return {
      rules: (Array.isArray(s.rules) ? s.rules : []).map(cleanRule).filter(Boolean),
      closures: (Array.isArray(s.closures) ? s.closures : [])
        .filter((c) => c && /^\d{4}-\d{2}-\d{2}$/.test(c.date))
        .map((c) => ({ date: c.date, staffId: c.staffId || null, reason: String(c.reason || "").slice(0, 80) })),
      skips: (Array.isArray(s.skips) ? s.skips : []).filter((k) => typeof k === "string"),
    };
  }

  // Lo que se guarda: sin cierres viejos ni llaves omitidas de días que ya
  // pasaron, para que el horario no crezca sin límite con el tiempo.
  function prune(schedule, now) {
    const s = normalize(schedule);
    const today = dateKey(now);
    const oldest = dateKey(startOfDay(now) - 60 * 86400000);
    return {
      rules: s.rules,
      closures: s.closures.filter((c) => c.date >= oldest),
      skips: s.skips.filter((k) => (k.split("@")[1] || "").slice(0, 10) >= today),
    };
  }

  // staffId null pregunta por el negocio completo; con staffId también
  // cuenta el cierre de solo esa persona.
  function isClosed(schedule, key, staffId) {
    return schedule.closures.some((c) => c.date === key && (c.staffId === null || (staffId && c.staffId === staffId)));
  }

  function activeRules(business) {
    const staffIds = new Set((business.staff || []).map((s) => s.id));
    return normalize(business.schedule).rules.filter((r) => r.staffId === null || staffIds.has(r.staffId));
  }

  // Mismo redondeo a múltiplos de $5 que un cupo con descuento publicado a
  // mano, pero con enteros (base * (100 - pct) / 500) para que el navegador
  // y Postgres (book_slot en schema.sql) den siempre el mismo precio.
  function applyDiscount(base, pct) {
    return pct > 0 ? Math.round((base * (100 - pct)) / 500) * 5 : base;
  }

  // Servicios que se pueden reservar en un cupo, ya con su precio final.
  // Un cupo normal tiene uno solo (el suyo); uno flexible ofrece los del
  // catálogo del negocio que hace la persona asignada.
  function slotOptions(business, slot) {
    if (!slot.flexible || slot.status !== "available") {
      return [{ name: slot.service || null, price: slot.price, originalPrice: slot.originalPrice || null }];
    }
    const staff = slot.staffId ? (business.staff || []).find((st) => st.id === slot.staffId) : null;
    const allowed = staff && Array.isArray(staff.services) && staff.services.length ? staff.services : null;
    const pct = slot.discountPct || 0;
    const seen = new Set();
    return (business.servicesCatalog || [])
      .filter((s) => s && s.name && !seen.has(s.name) && seen.add(s.name))
      .filter((s) => !allowed || allowed.includes(s.name))
      .map((s) => {
        const base = parseInt(s.price, 10) || 0;
        return { name: s.name, price: applyDiscount(base, pct), originalPrice: pct > 0 ? base : null };
      });
  }

  function fromPrice(options) {
    return options.length ? Math.min(...options.map((o) => o.price)) : 0;
  }

  // Resumen de un cupo para pintarlo: un solo servicio con su precio, o
  // "N servicios" con el precio más bajo ("desde $X"). bookable = false si
  // es flexible pero no hay ningún servicio con precio que ofrecer.
  function describeSlot(business, slot) {
    const options = slotOptions(business, slot);
    if (!options.length) return { options, bookable: false, service: null, price: 0, originalPrice: null, from: false };
    if (options.length === 1) {
      return { options, bookable: true, service: options[0].name, price: options[0].price, originalPrice: options[0].originalPrice, from: false };
    }
    const cheapest = options.reduce((a, b) => (b.price < a.price ? b : a));
    return { options, bookable: true, service: options.length + " servicios", price: cheapest.price, originalPrice: cheapest.originalPrice, from: true };
  }

  // Lista de días "AAAA-MM-DD" entre dos fechas (incluidas), máximo 60.
  function dateRange(from, to) {
    const keys = [];
    const day = new Date(parseDateKey(from));
    const last = to && to > from ? to : from;
    while (keys.length < 60) {
      const key = dateKey(day.getTime());
      if (key > last) break;
      keys.push(key);
      day.setDate(day.getDate() + 1);
    }
    return keys;
  }

  // Compara el horario contra los cupos que ya existen y regresa qué falta
  // crear y qué sobra. Nunca toca una cita ya reservada ni un cupo publicado
  // a mano: esos solo "ocupan" su lugar para que no se les encime otro.
  function plan(business, now, horizonDays) {
    const schedule = normalize(business.schedule);
    const rules = activeRules(business);
    const staffNames = {};
    (business.staff || []).forEach((s) => { staffNames[s.id] = s.name; });
    const skips = new Set(schedule.skips);
    const existing = business.slots || [];
    const byKey = new Map();
    existing.forEach((s) => { if (s.scheduleKey) byKey.set(s.scheduleKey, s); });

    const lanes = new Map();
    const lane = (staffId) => {
      const id = staffId || "_";
      if (!lanes.has(id)) lanes.set(id, []);
      return lanes.get(id);
    };
    const overlaps = (list, start, end) => list.some(([a, b]) => start < b && a < end);
    existing.forEach((s) => {
      const end = s.time + (s.duration || 0) * 60000;
      if (end <= now) return;
      if (s.status !== "available" || !s.scheduleKey) lane(s.staffId).push([s.time, end]);
    });

    const desired = new Set();
    const toCreate = [];
    const today = startOfDay(now);
    const days = horizonDays || HORIZON_DAYS;
    for (let i = 0; i < days; i++) {
      const day = new Date(today);
      day.setDate(day.getDate() + i);
      const key = dateKey(day.getTime());
      if (isClosed(schedule, key, null)) continue;
      const weekday = day.getDay();
      rules.forEach((rule) => {
        if (!rule.days.includes(weekday)) return;
        if (rule.staffId && isClosed(schedule, key, rule.staffId)) return;
        for (let m = rule.start; m + rule.every <= rule.end; m += rule.every) {
          const t = new Date(day);
          t.setHours(Math.floor(m / 60), m % 60, 0, 0);
          const time = t.getTime();
          const end = time + rule.every * 60000;
          const slotKey = rule.id + "@" + key + "T" + pad(Math.floor(m / 60)) + ":" + pad(m % 60);
          if (skips.has(slotKey)) continue;
          const mine = byKey.get(slotKey);
          if (mine && mine.status !== "available") continue;
          // Un cupo que ya empezó no se publica nuevo, pero si ya existía se
          // queda hasta que termine (el negocio aún puede agendar a alguien
          // que llegó unos minutos tarde).
          if (time <= now && !(mine && end > now)) continue;
          const occupied = lane(rule.staffId);
          if (overlaps(occupied, time, end)) continue;
          occupied.push([time, end]);
          desired.add(slotKey);
          const unchanged = mine && (mine.staffId || null) === rule.staffId && mine.duration === rule.every && mine.time === time;
          if (!unchanged) {
            toCreate.push({
              scheduleKey: slotKey,
              time,
              duration: rule.every,
              staffId: rule.staffId,
              staffName: rule.staffId ? staffNames[rule.staffId] || null : null,
            });
          }
        }
      });
    }

    const recreated = new Set(toCreate.map((c) => c.scheduleKey));
    const toRemove = existing
      .filter((s) => s.scheduleKey && s.status === "available" && (!desired.has(s.scheduleKey) || recreated.has(s.scheduleKey)))
      .map((s) => s.id);
    return { toCreate, toRemove };
  }

  return {
    HORIZON_DAYS,
    WEEKDAYS_SHORT,
    WEEKDAYS_LONG,
    startOfDay,
    dateKey,
    parseDateKey,
    minutesLabel,
    timeLabel,
    newRuleId,
    ruleError,
    normalize,
    prune,
    isClosed,
    activeRules,
    applyDiscount,
    slotOptions,
    fromPrice,
    describeSlot,
    dateRange,
    plan,
  };
})();
