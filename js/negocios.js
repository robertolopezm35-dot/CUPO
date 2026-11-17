// Calculadora de "¿cuánto te cuesta un hueco?" de negocios.html. Solo usa los números que escribe
// quien la usa: no hay cifras inventadas ni promesas de resultados.
(function () {
  const $ = (id) => document.getElementById(id);
  const gapsEl = $("calcGaps");
  const ticketEl = $("calcTicket");
  const fillEl = $("calcFill");
  if (!gapsEl || !ticketEl || !fillEl) return;
  const WEEKS_PER_MONTH = 4.3;
  const GAPS_MAX = 500;
  const TICKET_MAX = 100000;
  const money = (n) => "$" + Math.round(n).toLocaleString("es-MX");
  // El número tal como lo escribió (sin redondear a peso entero), para que la nota coincida con la cuenta.
  const plain = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

  // Un campo inválido (vacío, texto, negativo, fuera de rango) se avisa junto al campo, en vez de
  // recortar el valor en silencio o dar "$0" sin explicación.
  function readField(el, min, max, label) {
    let err = el.parentElement.querySelector(".field-error");
    if (!err) {
      err = document.createElement("p");
      err.className = "field-error";
      err.id = el.id + "Err";
      err.hidden = true;
      el.insertAdjacentElement("afterend", err);
    }
    const raw = String(el.value).trim().replace(/,/g, "");
    const v = parseFloat(raw);
    let message = "";
    if (raw === "" || !Number.isFinite(v)) message = "Escribe un número.";
    else if (v < min) message = label + " no puede ser menor que " + min + ".";
    else if (v > max) message = label + " puede ser de hasta " + max.toLocaleString("es-MX") + ".";
    err.textContent = message;
    err.hidden = !message;
    if (message) { el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", err.id); }
    else { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); }
    return message ? null : v;
  }

  let liveTimer = null;
  function update() {
    const gaps = readField(gapsEl, 0, GAPS_MAX, "Los huecos por semana");
    const ticket = readField(ticketEl, 0, TICKET_MAX, "El precio promedio");
    const fill = Math.round(Math.min(Math.max(parseFloat(fillEl.value) || 0, 0), 10));
    $("calcFillOut").textContent = fill + " de cada 10";
    fillEl.setAttribute("aria-valuetext", fill + " de cada 10");
    const valid = gaps !== null && ticket !== null;
    // Cada cifra sale de la anterior ya redondeada a pesos: lo que se ve siempre suma (año = 12 × mes).
    const loss = valid ? Math.round(gaps * ticket * WEEKS_PER_MONTH) : 0;
    const gain = Math.round(loss * (fill / 10));
    const year = gain * 12;
    $("calcLoss").textContent = money(loss);
    $("calcGain").textContent = money(gain);
    $("calcYear").textContent = money(year);
    let note;
    if (!valid) note = "Corrige los campos marcados para ver la cuenta.";
    else if (gaps > 0 && ticket > 0) note = "La cuenta: " + plain(gaps) + " huecos × $" + plain(ticket) + " × 4.3 semanas al mes = " + money(loss) + ". Llenando " + fill + " de cada 10, recuperarías " + money(gain) + " al mes (" + money(year) + " al año).";
    else note = "Escribe cuántos huecos tienes por semana y cuánto cobras para ver la cuenta.";
    $("calcNote").textContent = note;
    // Lector de pantalla: un solo resumen corto, con una pausa tras dejar de teclear (no 50 palabras por tecla).
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      const live = $("calcLive");
      if (live) live.textContent = valid && loss > 0 ? "Dejas de ganar " + money(loss) + " al mes; podrías recuperar " + money(gain) + "." : "";
    }, 700);
  }

  [gapsEl, ticketEl, fillEl].forEach((el) => el.addEventListener("input", update));
  update();
})();
