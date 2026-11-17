// Reconoce una sesión abierta en las páginas públicas que NO cargan la base de datos (landing, "Para negocios"):
// quien ya entró ve "Ir a mi panel" en vez de "Iniciar sesión / Crear cuenta". Solo lee el almacenamiento del
// navegador (nunca pide nada a la red); si no hay sesión o no se puede leer, la página queda como siempre.
(function () {
  function readRole() {
    try {
      const local = JSON.parse(localStorage.getItem("cupo_session") || "null"); // modo demostración
      if (local && (local.role === "negocio" || local.role === "cliente")) return local.role;
    } catch (err) { /* sin almacenamiento o dato dañado */ }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!/^sb-.*-auth-token$/.test(key || "")) continue;
        const token = JSON.parse(localStorage.getItem(key));
        if (!token || !token.user) continue;
        const role = token.user.user_metadata && token.user.user_metadata.role;
        return role === "negocio" ? "negocio" : "cliente"; // modo conectado: el rol viene en los datos de la cuenta
      }
    } catch (err) { /* sin almacenamiento o dato dañado */ }
    return null;
  }

  const role = readRole();
  if (!role) return;
  const isNegocio = role === "negocio";
  document.querySelectorAll("[data-guest-only]").forEach((el) => { el.hidden = true; });
  document.querySelectorAll("[data-session-link]").forEach((el) => {
    el.hidden = false;
    el.href = isNegocio ? "negocio.html" : "cliente.html";
    el.textContent = isNegocio ? "Ir a mi agenda" : "Ir a mis cupos";
  });
  // Un negocio que ya tiene cuenta no necesita "Registrar mi negocio": va a su agenda.
  if (isNegocio) {
    document.querySelectorAll("[data-negocio-cta]").forEach((el) => {
      el.href = "negocio.html";
      el.textContent = "Ir a mi agenda";
    });
  }
})();
