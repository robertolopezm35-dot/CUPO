// CupoUI — comportamiento común de la interfaz que no depende de la base de datos:
//   · Ventanas emergentes (modales) accesibles: role="dialog", foco que entra y regresa,
//     la página de atrás queda inerte, no se desplaza el fondo.
//   · Etiquetas asociadas a sus campos (para lectores de pantalla) sin tener que tocar
//     cada formulario.
//   · Avisos (toasts) que se anuncian solos y un aviso "no se pudo cargar" con Reintentar.
const CupoUI = (() => {
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  const openModals = []; // pila: el último es el de arriba
  let titleSeq = 0;
  let labelSeq = 0;

  // ── Aviso de carga fallida ───────────────────────────────────────────────
  // Un fallo de red al cargar NO es "tu cuenta no existe": se avisa y se deja reintentar sin
  // cerrar la sesión (antes un solo error 500 mandaba al usuario al login).
  function fatal(message) {
    if (document.querySelector(".fatal-banner")) return;
    const el = document.createElement("div");
    el.className = "fatal-banner";
    el.setAttribute("role", "alert");
    const strong = document.createElement("strong");
    strong.textContent = message || "No pudimos cargar tu información.";
    const note = document.createElement("span");
    note.textContent = "Revisa tu conexión. No cerramos tu sesión.";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-primary btn-sm";
    button.textContent = "Reintentar";
    button.addEventListener("click", () => window.location.reload());
    el.append(strong, note, button);
    const header = document.querySelector("header, nav");
    if (header) header.after(el);
    else document.body.prepend(el);
  }

  // ── Modales ──────────────────────────────────────────────────────────────
  function setBackgroundInert(on) {
    Array.from(document.body.children).forEach((el) => {
      if (el.matches(".modal-overlay, script, .toast, .fatal-banner")) return;
      if (on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    });
  }

  function visibleFocusables(root) {
    return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function onOpen(overlay, modal) {
    openModals.push({ overlay, modal, opener: document.activeElement });
    document.documentElement.classList.add("modal-open");
    setBackgroundInert(true);
    if (modal) {
      // El foco entra al diálogo (no a un botón de acción: un Enter accidental no debe confirmar nada).
      modal.setAttribute("tabindex", "-1");
      window.requestAnimationFrame(() => modal.focus({ preventScroll: true }));
    }
  }

  function onClose(overlay) {
    const idx = openModals.findIndex((m) => m.overlay === overlay);
    if (idx === -1) return;
    const [{ opener }] = openModals.splice(idx, 1);
    if (!openModals.length) {
      document.documentElement.classList.remove("modal-open");
      setBackgroundInert(false);
    }
    // El foco regresa a lo que abrió el diálogo; si ya no existe (la lista se repintó), a la zona principal.
    window.requestAnimationFrame(() => {
      if (openModals.length) return;
      if (opener && opener !== document.body && document.contains(opener) && opener.offsetParent !== null) {
        opener.focus({ preventScroll: true });
      } else {
        const main = document.querySelector("main");
        if (main) {
          if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
          main.focus({ preventScroll: true });
        }
      }
    });
  }

  function trapTab(e) {
    if (e.key !== "Tab" || !openModals.length) return;
    const { modal } = openModals[openModals.length - 1];
    if (!modal) return;
    const items = visibleFocusables(modal);
    if (!items.length) {
      e.preventDefault();
      modal.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === modal)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function initModals() {
    document.querySelectorAll(".modal-overlay").forEach((overlay) => {
      const modal = overlay.querySelector(".modal");
      if (modal) {
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        const title = modal.querySelector(".modal-header h3, h3");
        if (title) {
          if (!title.id) title.id = "modal-title-" + ++titleSeq;
          modal.setAttribute("aria-labelledby", title.id);
        }
      }
      // Las páginas abren y cierran con classList.add/remove("show"): se observa el cambio
      // en vez de tocar cada lugar donde se abre un modal.
      new MutationObserver(() => {
        const open = overlay.classList.contains("show");
        const known = openModals.some((m) => m.overlay === overlay);
        if (open && !known) onOpen(overlay, modal);
        else if (!open && known) onClose(overlay);
      }).observe(overlay, { attributes: true, attributeFilter: ["class"] });
      if (overlay.classList.contains("show")) onOpen(overlay, modal);
    });
    document.addEventListener("keydown", trapTab, true);
  }

  // ── Etiquetas ────────────────────────────────────────────────────────────
  // Un <label> sin for/anidado no le da nombre al campo para un lector de pantalla. Si el
  // campo tiene su etiqueta justo en el mismo contenedor, se asocian; los campos que solo
  // traen placeholder reciben un aria-label con ese texto.
  function labelFields(root) {
    const scope = root || document;
    scope.querySelectorAll("label:not([for])").forEach((label) => {
      if (label.querySelector("input, select, textarea")) return;
      const parent = label.parentElement;
      if (!parent) return;
      const controls = parent.querySelectorAll("input:not([type='hidden']), select, textarea");
      const sibling = label.nextElementSibling;
      const control = sibling && sibling.matches("input, select, textarea") ? sibling : controls.length === 1 ? controls[0] : null;
      if (!control) return;
      if (!control.id) control.id = "campo-" + ++labelSeq;
      label.setAttribute("for", control.id);
    });
    scope.querySelectorAll("input:not([type='hidden']):not([type='checkbox']):not([type='radio']), select, textarea").forEach((control) => {
      if (control.getAttribute("aria-label") || control.getAttribute("aria-labelledby")) return;
      if (control.labels && control.labels.length) return;
      const text = control.getAttribute("placeholder") || control.getAttribute("title");
      if (text) control.setAttribute("aria-label", text);
    });
  }

  function announceToasts() {
    document.querySelectorAll(".toast").forEach((t) => {
      t.setAttribute("role", "status");
      t.setAttribute("aria-live", "polite");
    });
    const err = document.getElementById("errorMsg");
    if (err) err.setAttribute("role", "alert");
  }

  function init() {
    initModals();
    announceToasts();
    labelFields(document);
    // Las filas que la página agrega después (servicios, personal, turnos) también se etiquetan.
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      window.requestAnimationFrame(() => {
        pending = false;
        labelFields(document);
      });
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  return { fatal, labelFields };
})();
