// CupoValidate — reglas de validación y normalización compartidas por los dos backends
// (CupoStore y SupabaseStore) y por la interfaz. Sin DOM ni base de datos.
// Cada validador regresa { ok: true, ... } o { ok: false, error: "mensaje en español" }.
const CupoValidate = (() => {
  const LIMITS = {
    name: 80,        // nombre del negocio
    address: 200,
    personName: 60,  // nombre / apellido de una persona
    serviceName: 80,
    comment: 1000,
    durationMin: 5,
    durationMax: 480,
    priceMax: 100000,
    discountMax: 90,
    photosMax: 20,
    servicesMax: 60,
  };

  const digits = (s) => String(s == null ? "" : s).replace(/\D/g, "");

  // Texto sin acentos y en minúsculas, para buscar ("barberia" encuentra "Barbería").
  function fold(s) {
    return String(s == null ? "" : s).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  }

  // Primera letra "de verdad" de un nombre (un emoji es un par sustituto: charAt(0) lo parte).
  function initial(name) {
    const first = Array.from(String(name == null ? "" : name).trim())[0];
    return first ? first.toLocaleUpperCase("es-MX") : "?";
  }

  // Teléfono mexicano de 10 dígitos. Acepta que peguen "+52 81 1234 5678", "52 81…" o "521 81…".
  // Vacío es válido (el teléfono casi siempre es opcional): regresa phone "".
  function phone(input) {
    let d = digits(input);
    if (!d) return { ok: true, phone: "" };
    if (d.length === 13 && d.startsWith("521")) d = d.slice(3);
    else if (d.length === 12 && d.startsWith("52")) d = d.slice(2);
    if (d.length !== 10) return { ok: false, error: "El teléfono debe tener 10 dígitos (puedes pegarlo con +52)." };
    return { ok: true, phone: d };
  }

  function personName(first, last) {
    const f = String(first == null ? "" : first).trim();
    const l = String(last == null ? "" : last).trim();
    if (!f || !l) return { ok: false, error: "Escribe tu nombre y tu apellido." };
    if (f.length > LIMITS.personName || l.length > LIMITS.personName) {
      return { ok: false, error: "El nombre y el apellido pueden tener hasta " + LIMITS.personName + " caracteres." };
    }
    return { ok: true, first: f, last: l };
  }

  function businessText(name, address) {
    const n = String(name == null ? "" : name).trim();
    const a = String(address == null ? "" : address).trim();
    if (!n) return { ok: false, error: "Escribe el nombre de tu negocio." };
    if (!a) return { ok: false, error: "Escribe la dirección de tu negocio." };
    if (n.length > LIMITS.name) return { ok: false, error: "El nombre del negocio puede tener hasta " + LIMITS.name + " caracteres." };
    if (a.length > LIMITS.address) return { ok: false, error: "La dirección puede tener hasta " + LIMITS.address + " caracteres." };
    return { ok: true, name: n, address: a };
  }

  const isInt = (v) => /^\d+$/.test(String(v == null ? "" : v).trim());

  // Un cupo suelto: duración, precio y descuento con rangos reales (antes "-30", "1e3" o
  // "descuento 150" se guardaban o se recortaban en silencio).
  function slotInput({ duration, price, discountPct, flexible }) {
    let durationValue = 45;
    if (String(duration == null ? "" : duration).trim() !== "") {
      if (!isInt(duration)) return { ok: false, error: "La duración debe ser un número entero de minutos." };
      durationValue = parseInt(duration, 10);
    }
    if (durationValue < LIMITS.durationMin || durationValue > LIMITS.durationMax) {
      return { ok: false, error: "La duración debe estar entre " + LIMITS.durationMin + " y " + LIMITS.durationMax + " minutos." };
    }
    let priceValue = 0;
    // En un cupo flexible el precio es solo el "desde" (lo calcula quien llama); no se exige.
    if (flexible) {
      if (isInt(price)) priceValue = parseInt(price, 10);
    } else {
      if (String(price == null ? "" : price).trim() === "") return { ok: false, error: "Escribe el precio del cupo." };
      if (!isInt(price)) return { ok: false, error: "El precio debe ser un número entero, sin signos ni decimales." };
      priceValue = parseInt(price, 10);
      if (priceValue < 1 || priceValue > LIMITS.priceMax) {
        return { ok: false, error: "El precio debe estar entre $1 y $" + LIMITS.priceMax.toLocaleString("es-MX") + "." };
      }
    }
    let pct = 0;
    if (String(discountPct == null ? "" : discountPct).trim() !== "") {
      if (!isInt(discountPct)) return { ok: false, error: "El descuento debe ser un número entero de 0 a " + LIMITS.discountMax + "." };
      pct = parseInt(discountPct, 10);
      if (pct > LIMITS.discountMax) return { ok: false, error: "El descuento máximo es " + LIMITS.discountMax + "%." };
    }
    return { ok: true, duration: durationValue, price: priceValue, pct };
  }

  // Catálogo de servicios: nombre 1–80, precio entero 0–100,000, sin nombres repetidos.
  function catalog(rows) {
    const seen = new Set();
    const out = [];
    for (const row of rows || []) {
      const name = String(row.name == null ? "" : row.name).trim();
      if (!name) continue;
      if (name.length > LIMITS.serviceName) return { ok: false, error: "El nombre de un servicio puede tener hasta " + LIMITS.serviceName + " caracteres." };
      const raw = String(row.price == null ? "" : row.price).trim();
      if (raw === "") return { ok: false, error: "Ponle precio a “" + name + "” (o quítalo de tu catálogo)." };
      if (!isInt(raw)) return { ok: false, error: "El precio de “" + name + "” debe ser un número entero, sin signos ni decimales." };
      const price = parseInt(raw, 10);
      if (price > LIMITS.priceMax) return { ok: false, error: "El precio de “" + name + "” no puede pasar de $" + LIMITS.priceMax.toLocaleString("es-MX") + "." };
      const key = fold(name);
      if (seen.has(key)) return { ok: false, error: "“" + name + "” está repetido en tu catálogo." };
      seen.add(key);
      out.push({ name, price });
    }
    if (out.length > LIMITS.servicesMax) return { ok: false, error: "Tu catálogo puede tener hasta " + LIMITS.servicesMax + " servicios." };
    return { ok: true, catalog: out };
  }

  // Normaliza lo que llega de la base (un negocio puede haber guardado cualquier cosa en
  // estos campos): la interfaz siempre recibe listas con la forma correcta.
  function safeCatalog(value) {
    if (!Array.isArray(value)) return [];
    return value
      .filter((s) => s && typeof s === "object" && typeof s.name === "string" && s.name.trim())
      .map((s) => ({ name: s.name, price: Number.isFinite(Number(s.price)) ? Number(s.price) : 0 }));
  }
  function safePhotos(value) {
    if (!Array.isArray(value)) return [];
    return value.filter((u) => typeof u === "string" && /^(https?:\/\/|data:image\/)/i.test(u));
  }

  // ¿Se encima el intervalo [start, start+duration) con algún cupo de la lista (misma persona)?
  // rows: [{ id, time, duration, staffId, status }]. Regresa el cupo en conflicto o null.
  function slotConflict(rows, start, duration, staffId, ignoreId) {
    const end = start + duration * 60000;
    return (rows || []).find((r) => {
      if (ignoreId && r.id === ignoreId) return false;
      if ((r.staffId || null) !== (staffId || null)) return false;
      const rEnd = r.time + (r.duration || 45) * 60000;
      return r.time < end && rEnd > start;
    }) || null;
  }

  return { LIMITS, digits, fold, initial, phone, personName, businessText, slotInput, catalog, safeCatalog, safePhotos, slotConflict };
})();
