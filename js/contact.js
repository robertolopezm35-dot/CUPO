// CupoContact — pequeños ayudantes para contactar y ubicar: links de
// WhatsApp, llamada, mapa y archivo de calendario (.ics). Sin DOM ni base de
// datos, así que los usan igual el panel del negocio, el del cliente y Ventas.
const CupoContact = (() => {
  function digits(s) {
    return String(s == null ? "" : s).replace(/\D/g, "");
  }

  // dial = "+52" tal cual lo guarda clients.country_code; phone = 10 dígitos.
  function fullNumber(dial, phone) {
    const p = digits(phone);
    if (!p) return "";
    return digits(dial || "+52") + p;
  }

  function whatsappUrl(dial, phone, text) {
    const n = fullNumber(dial, phone);
    if (!n) return null;
    return "https://wa.me/" + n + (text ? "?text=" + encodeURIComponent(text) : "");
  }

  function telUrl(dial, phone) {
    const n = fullNumber(dial, phone);
    return n ? "tel:+" + n : null;
  }

  // Búsqueda en Google Maps por dirección (sin API key): abre la app de mapas
  // en el celular. Con coordenadas aproximadas por colonia no se promete un
  // punto exacto, así que se busca por nombre + dirección.
  function mapsUrl(name, address) {
    const q = [name, address].filter(Boolean).join(", ");
    return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  }

  function icsDate(ts) {
    const d = new Date(ts);
    const p = (n) => String(n).padStart(2, "0");
    return d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + "T" + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + "Z";
  }

  // Texto de un valor iCalendar (RFC 5545 §3.3.11): \ ; , y saltos de línea se escapan.
  // (Antes el ";" quedaba sin escapar —"\;" en JS es solo ";"— y un "\r" suelto rompía la línea.)
  function icsEscape(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
  }

  // Una línea de un .ics no puede pasar de 75 octetos: se parte y las continuaciones
  // empiezan con un espacio. Se cuenta en bytes UTF-8 (un acento o emoji ocupa 2–4) y
  // nunca se corta a la mitad de un carácter.
  function icsFold(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = "";
    let bytes = 0;
    let limit = 75;
    for (const ch of Array.from(line)) {
      const n = enc.encode(ch).length;
      if (bytes + n > limit) {
        out.push(cur);
        cur = " ";
        bytes = 1;
        limit = 75;
      }
      cur += ch;
      bytes += n;
    }
    out.push(cur);
    return out.join("\r\n");
  }

  // Contenido de un archivo .ics con la cita (se agrega al calendario del celular).
  function icsContent({ uid, start, durationMin, title, location, description }) {
    const end = start + (durationMin || 45) * 60000;
    return [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//CUPO//mycupo.com//ES",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "UID:" + icsEscape(uid || String(start)) + "@mycupo.com",
      "DTSTAMP:" + icsDate(Date.now()),
      "DTSTART:" + icsDate(start),
      "DTEND:" + icsDate(end),
      "SUMMARY:" + icsEscape(title),
      location ? "LOCATION:" + icsEscape(location) : null,
      description ? "DESCRIPTION:" + icsEscape(description) : null,
      "BEGIN:VALARM",
      "TRIGGER:-PT1H",
      "ACTION:DISPLAY",
      "DESCRIPTION:" + icsEscape(title),
      "END:VALARM",
      "END:VEVENT",
      "END:VCALENDAR",
    ].filter(Boolean).map(icsFold).join("\r\n") + "\r\n"; // CRLF también en la última línea
  }

  // Descarga el .ics desde el navegador.
  function downloadIcs(filename, content) {
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // "81 1234 5678"
  function prettyPhone(phone) {
    const p = digits(phone);
    return p.length === 10 ? p.slice(0, 2) + " " + p.slice(2, 6) + " " + p.slice(6) : p;
  }

  return { digits, fullNumber, whatsappUrl, telUrl, mapsUrl, icsContent, downloadIcs, prettyPhone };
})();
