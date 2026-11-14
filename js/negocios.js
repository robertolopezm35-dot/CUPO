// Calculadora de "¿cuánto te cuesta un hueco?" de negocios.html. Solo usa los números que escribe
// quien la usa: no hay cifras inventadas ni promesas de resultados.
(function () {
  const $ = (id) => document.getElementById(id);
  const gapsEl = $("calcGaps");
  const ticketEl = $("calcTicket");
  const fillEl = $("calcFill");
  if (!gapsEl || !ticketEl || !fillEl) return;
  const WEEKS_PER_MONTH = 4.3;
  const money = (n) => "$" + Math.round(n).toLocaleString("es-MX");
  const num = (el, min, max) => {
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) return 0;
    return Math.min(Math.max(v, min), max);
  };

  function update() {
    const gaps = num(gapsEl, 0, 500);
    const ticket = num(ticketEl, 0, 100000);
    const fill = Math.round(num(fillEl, 0, 10));
    const loss = gaps * ticket * WEEKS_PER_MONTH;
    const gain = loss * (fill / 10);
    $("calcFillOut").textContent = fill + " de cada 10";
    $("calcLoss").textContent = money(loss);
    $("calcGain").textContent = money(gain);
    $("calcYear").textContent = money(gain * 12);
    $("calcNote").textContent = gaps > 0 && ticket > 0
      ? "La cuenta: " + gaps + " huecos × " + money(ticket) + " × 4.3 semanas al mes. Llenando " + fill + " de cada 10, recuperarías " + money(gain) + " al mes (" + money(gain * 12) + " al año)."
      : "Escribe cuántos huecos tienes por semana y cuánto cobras para ver la cuenta.";
  }

  [gapsEl, ticketEl, fillEl].forEach((el) => el.addEventListener("input", update));
  update();
})();
