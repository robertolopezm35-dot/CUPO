// CupoShare — compartir sin servidor: links directos, mensajes listos para WhatsApp/Instagram y
// código QR (con la librería incluida en js/vendor/qrcode.js, así que ningún link sale a un
// servicio externo). Sin base de datos y sin estado: lo usan el panel del negocio y el del cliente.
const CupoShare = (() => {
  // Un link absoluto a otra página del propio sitio (funciona igual en mycupo.com que en github.io/CUPO/).
  function siteBase() {
    const cfg = window.SITE_CONFIG && String(window.SITE_CONFIG.baseUrl || "").trim();
    if (cfg) {
      try {
        const u = new URL(cfg.endsWith("/") ? cfg : cfg + "/");
        if (u.protocol === "https:" || u.protocol === "http:") return u.href;
      } catch (err) { /* baseUrl mal escrita: se usa la dirección actual */ }
    }
    return window.location.href;
  }
  // ¿Esta página se abrió desde una dirección real (no localhost, no un archivo local)?
  // Un link o QR sacado de una versión de prueba no sirve fuera de ahí.
  function isLiveHost() {
    try {
      const u = new URL(siteBase());
      return !(u.protocol === "file:" || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(u.hostname) || u.hostname.endsWith(".local"));
    } catch (err) {
      return false;
    }
  }
  function pageUrl(file, params) {
    const url = new URL(file, siteBase());
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value != null && value !== "") url.searchParams.set(key, value);
    });
    url.hash = "";
    return url.href;
  }

  const bookingLink = (businessId, slotId) => pageUrl("cliente.html", { negocio: businessId, slot: slotId });
  const forBusinessesLink = () => pageUrl("negocios.html");
  const whatsappShareUrl = (text) => "https://wa.me/?text=" + encodeURIComponent(text);
  const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-MX");

  // ── Mensajes ─────────────────────────────────────────────────────────────
  // Para que el negocio se lo mande a SUS clientes (WhatsApp, estados, grupos).
  function inviteMessage(business) {
    return "¡Hola! Ya puedes reservar tu cita en " + business.name + " desde tu celular, sin escribir y viendo los horarios libres (la primera vez te pide crear una cuenta rápida): " + bookingLink(business.id);
  }

  // WhatsApp da formato con * _ ~ ` : un nombre de negocio con esos signos rompería el texto en negritas.
  const waSafe = (text) => String(text == null ? "" : text).replace(/[*_~`]/g, "");

  // "Hoy" / "Mañana" / "Jue 12 nov" para un cupo de otro día (cuando el mensaje no es de hoy).
  function dayWordOf(ts) {
    const startOf = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const diff = Math.round((startOf(ts) - startOf(Date.now())) / 86400000);
    if (diff === 0) return "Hoy";
    if (diff === 1) return "Mañana";
    return new Date(ts).toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" }).replace(/\.$/, "").replace(/^\w/, (c) => c.toUpperCase());
  }

  // Texto corto para la descripción de Instagram / Facebook / Google.
  function bioText(business) {
    return "📅 Reserva tu cita al instante: " + bookingLink(business.id);
  }

  function slotText(business, slot, withDay) {
    const info = CupoSchedule.describeSlot(business, slot);
    const price = info.bookable ? (info.from ? "desde " + money(info.price) : money(info.price)) : "";
    const what = info.bookable && !info.from && info.service ? info.service : "";
    const off = slot.discountPct > 0 ? " (-" + slot.discountPct + "%)" : "";
    const when = withDay && slot.time ? dayWordOf(slot.time) + " " + slot.label : slot.label;
    return [when, [what, price + off].filter(Boolean).join(" · ")].filter(Boolean).join(" — ");
  }

  // Un solo cupo (botón en el detalle del cupo): el link abre justo ese cupo.
  function slotMessage(business, slot) {
    // Con el día: un cupo de mañana o de la semana que entra sin decir cuándo es confunde (y lo reserva otro día).
    return "✨ ¡Cupo libre en " + business.name + "! " + slotText(business, slot, true) + ".\nReserva en un toque 👉 " + bookingLink(business.id, slot.id);
  }

  // Todos los cupos libres que quedan (hoy): el negocio los manda y llena el día.
  function slotsMessage(business, slots, max) {
    const limit = max || 8;
    const shown = slots.slice(0, limit);
    const lines = shown.map((s) => "• " + slotText(business, s));
    if (slots.length > shown.length) lines.push("• y " + (slots.length - shown.length) + " más");
    return "✨ *" + (slots.length === 1 ? "Cupo libre hoy en " : "Cupos libres hoy en ") + waSafe(business.name) + "*\n" + lines.join("\n") + "\nReserva en un toque 👉 " + bookingLink(business.id);
  }

  // Para que un cliente invite a su barbería/salón favorito a sumarse (así crece la oferta).
  function inviteBusinessMessage() {
    return "Oye, existe CUPO: una página donde los negocios publican sus cupos libres de último momento y los clientes reservan al instante. ¿Te animas a registrar tu negocio? " + forBusinessesLink();
  }

  // ── QR ───────────────────────────────────────────────────────────────────
  function qrMatrix(text) {
    if (typeof qrcode === "undefined") return null;
    try {
      const qr = qrcode(0, "M");
      qr.addData(String(text));
      qr.make();
      return qr;
    } catch (err) {
      console.error("No se pudo generar el QR:", err);
      return null;
    }
  }

  // SVG escalable del QR (un solo <path>: ligero y nítido al imprimir).
  function qrSvg(text, options) {
    const { size = 220, margin = 2, dark = "#14142B", light = "#FFFFFF", label = "Código QR para reservar" } = options || {};
    const qr = qrMatrix(text);
    if (!qr) return "";
    const n = qr.getModuleCount();
    const total = n + margin * 2;
    let path = "";
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) path += "M" + (c + margin) + "," + (r + margin) + "h1v1h-1z";
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + " " + total + '" width="' + size + '" height="' + size + '" role="img" aria-label="' + label + '" shape-rendering="crispEdges">'
      + '<rect width="' + total + '" height="' + total + '" fill="' + light + '"/><path d="' + path + '" fill="' + dark + '"/></svg>';
  }

  // PNG para descargar (alta resolución, para imprimir o subir a redes).
  function qrPngBlob(text, pixels) {
    return new Promise((resolve) => {
      const qr = qrMatrix(text);
      if (!qr) return resolve(null);
      const margin = 4;
      const n = qr.getModuleCount();
      const cell = Math.max(2, Math.floor((pixels || 1024) / (n + margin * 2)));
      const side = (n + margin * 2) * cell;
      const canvas = document.createElement("canvas");
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, side, side);
      ctx.fillStyle = "#14142B";
      for (let r = 0; r < n; r++) {
        for (let c = 0; c < n; c++) {
          if (qr.isDark(r, c)) ctx.fillRect((c + margin) * cell, (r + margin) * cell, cell, cell);
        }
      }
      canvas.toBlob((blob) => resolve(blob), "image/png");
    });
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Copiar al portapapeles con respaldo para navegadores/contextos sin la API moderna.
  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (err) {
      // se intenta el respaldo
    }
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    } catch (err) {
      return false;
    }
  }

  function slugForFile(name) {
    return String(name || "negocio").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "negocio";
  }

  return { pageUrl, isLiveHost, bookingLink, forBusinessesLink, whatsappShareUrl, inviteMessage, bioText, slotText, slotMessage, slotsMessage, inviteBusinessMessage, qrSvg, qrPngBlob, downloadBlob, copyText, slugForFile };
})();
