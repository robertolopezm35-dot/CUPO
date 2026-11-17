(function () {
  const params = new URLSearchParams(window.location.search);
  const norm = (v) => String(v || "").trim().toLowerCase();
  // Los valores de la URL se leen sin importar mayúsculas ("mode=LOGIN" también cuenta).
  let role = norm(params.get("role")) === "negocio" ? "negocio" : "cliente";
  let mode = norm(params.get("mode")) === "login" ? "login" : "register";

  const roleClienteBtn = document.getElementById("roleClienteBtn");
  const roleNegocioBtn = document.getElementById("roleNegocioBtn");
  const authTitle = document.getElementById("authTitle");
  const authSub = document.getElementById("authSub");
  const errorMsg = document.getElementById("errorMsg");
  const modeToggleText = document.getElementById("modeToggleText");
  const modeToggleBtn = document.getElementById("modeToggleBtn");
  const $authAside = document.getElementById("authAside");
  const $authStatus = document.getElementById("authStatus");
  const $authBack = document.getElementById("authBack");
  const $sessionNotice = document.getElementById("sessionNotice");

  const forms = {
    "cliente-register": document.getElementById("registerClienteForm"),
    "negocio-register": document.getElementById("registerNegocioForm"),
    "cliente-login": document.getElementById("loginClienteForm"),
    "negocio-login": document.getElementById("loginNegocioForm"),
  };

  const countryCodeSelect = document.getElementById("countryCodeSelect");
  DataStore.COUNTRY_CODES.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.iso;
    opt.textContent = c.flag + " " + c.name + " (" + c.dial + ")";
    if (c.iso === "MX") opt.selected = true;
    countryCodeSelect.appendChild(opt);
  });

  // Las 6 subcategorías reales vienen de DataStore.CATEGORIES (misma fuente
  // que usa el negocio para editar su perfil) — antes este <select> traía
  // una lista fija de 4 opciones desactualizada, con "Estética" (que no es
  // una categoría válida, es el nombre del área) y sin Uñas ni Maquillaje,
  // así que un negocio nuevo de esas categorías no podía registrarse bien y
  // quedaba invisible para todos los clientes.
  const registerCategorySelect = document.getElementById("registerCategorySelect");
  DataStore.CATEGORIES.forEach((cat) => {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    registerCategorySelect.appendChild(opt);
  });

  const copy = {
    "cliente-register": { title: "Crear cuenta", sub: "Encuentra citas de último momento cerca de ti.", toggleText: "¿Ya tienes cuenta?", toggleBtn: "Inicia sesión" },
    "negocio-register": { title: "Registra tu negocio", sub: "Publica tus cupos disponibles y llena tu agenda.", toggleText: "¿Ya tienes cuenta?", toggleBtn: "Inicia sesión" },
    "cliente-login": { title: "Inicia sesión", sub: "Entra para ver los cupos disponibles cerca de ti.", toggleText: "¿No tienes cuenta?", toggleBtn: "Regístrate" },
    "negocio-login": { title: "Inicia sesión", sub: "Entra para gestionar la agenda de tu negocio.", toggleText: "¿No tienes cuenta?", toggleBtn: "Regístrate" },
  };

  // Quien llega aquí porque tocó un cupo para reservarlo: se le dice que es
  // un paso rápido y que regresa justo a ese cupo.
  if (params.get("reason") === "reservar") {
    copy["cliente-register"].sub = "Un paso más: crea tu cuenta y te regresamos a tu cupo para confirmar.";
    copy["cliente-login"].sub = "Inicia sesión y te regresamos a tu cupo para confirmar.";
  }
  // Quien llegó desde una sección de negocios (agenda, ventas) sin sesión de negocio.
  if (params.get("reason") === "negocio") {
    copy["negocio-login"].sub = "Esta sección es para negocios: entra con la cuenta de tu negocio.";
  }

  // ── Destino después de entrar ──────────────────────────────────────────
  // `next` solo vale si apunta a una página propia del sitio, en la misma carpeta que esta, y que corresponde
  // al rol (un cliente solo vuelve a cliente.html; un negocio a su agenda o Ventas). Se resuelve con URL()
  // en vez de comparar texto: "cliente.html:foo", "//otro.com" o "cliente.html@otro.com" no pasan.
  const NEXT_PAGES = { cliente: ["cliente.html", "cliente"], negocio: ["negocio.html", "negocio", "ventas.html", "ventas"] };
  function safeNext(forRole) {
    const raw = params.get("next");
    if (!raw) return null;
    try {
      const u = new URL(raw, window.location.href);
      if (u.origin !== window.location.origin) return null;
      const dir = (p) => p.replace(/[^/]*$/, "");
      if (dir(u.pathname) !== dir(window.location.pathname)) return null;
      const file = u.pathname.split("/").pop();
      if (!NEXT_PAGES[forRole].includes(file)) return null;
      return (file.endsWith(".html") ? file : file + ".html") + u.search;
    } catch (err) {
      return null;
    }
  }

  function goToDashboard() {
    // Si llegaron aquí por un link compartido (?negocio=ID) o desde una sección privada, regresan exactamente
    // a donde iban en vez de a la lista genérica. location.replace: el formulario enviado no se queda en el
    // historial, así que "Atrás" desde el panel no regresa a un formulario ya usado.
    const next = safeNext(role);
    window.location.replace(next || (role === "cliente" ? "cliente.html" : "negocio.html"));
  }

  function key() {
    return role + "-" + mode;
  }

  // La URL refleja la pestaña y el modo (recargar o compartir esta página conserva lo que se ve).
  function syncUrl() {
    const p = new URLSearchParams();
    p.set("mode", mode);
    p.set("role", role);
    ["next", "reason"].forEach((k) => { if (params.get(k)) p.set(k, params.get(k)); });
    try { history.replaceState(null, "", window.location.pathname + "?" + p.toString()); } catch (err) { /* sin historial */ }
  }

  // Línea de ayuda según la pestaña: quien entró como Cliente teniendo un negocio (o al revés) tiene una salida a un clic.
  const ASIDE = {
    "negocio-register": '¿Primera vez aquí? <a href="negocios.html">Mira cómo funciona CUPO para negocios</a>.',
    "cliente-login": '¿Tienes un negocio? <button type="button" class="btn-link" data-set-role="negocio">Entra como negocio</button>.',
    "negocio-login": '¿Eres cliente? <button type="button" class="btn-link" data-set-role="cliente">Entra como cliente</button>.',
  };

  function render({ announce } = {}) {
    roleClienteBtn.classList.toggle("active", role === "cliente");
    roleNegocioBtn.classList.toggle("active", role === "negocio");
    roleClienteBtn.setAttribute("aria-pressed", role === "cliente" ? "true" : "false");
    roleNegocioBtn.setAttribute("aria-pressed", role === "negocio" ? "true" : "false");

    Object.values(forms).forEach((f) => f.classList.remove("active"));
    forms[key()].classList.add("active");

    const c = copy[key()];
    authTitle.textContent = c.title;
    authSub.textContent = c.sub;
    document.title = "CUPO — " + c.title + (role === "negocio" ? " (negocio)" : "");
    // Un negocio que está por registrarse puede querer ver primero de qué se trata; en el login, la salida al otro rol.
    const aside = ASIDE[key()];
    $authAside.hidden = !aside;
    $authAside.innerHTML = aside || "";
    modeToggleText.textContent = c.toggleText;
    modeToggleBtn.textContent = c.toggleBtn;
    // "Volver a los cupos" para quien vino de reservar y quiere seguir mirando.
    const back = safeNext("cliente");
    $authBack.hidden = !(back && role === "cliente");
    if (back) $authBack.querySelector("a").href = back;

    errorMsg.classList.remove("show");
    errorMsg.textContent = "";
    syncUrl();
    if (announce && $authStatus) $authStatus.textContent = (mode === "login" ? "Iniciar sesión" : "Crear cuenta") + " como " + (role === "negocio" ? "negocio" : "cliente") + ".";
  }

  roleClienteBtn.addEventListener("click", () => { role = "cliente"; render({ announce: true }); });
  roleNegocioBtn.addEventListener("click", () => { role = "negocio"; render({ announce: true }); });
  modeToggleBtn.addEventListener("click", () => {
    mode = mode === "register" ? "login" : "register";
    render({ announce: true });
  });
  $authAside.addEventListener("click", (e) => {
    const b = e.target.closest("[data-set-role]");
    if (!b) return;
    role = b.dataset.setRole;
    render({ announce: true });
    const first = forms[key()].querySelector("input");
    if (first) first.focus();
  });

  // El aviso de error debe verse: en celular el formulario es largo y el mensaje quedaba fuera de pantalla.
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add("show");
    const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    errorMsg.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
    errorMsg.focus({ preventScroll: true });
  }

  // Mínimo de contraseña de Supabase Auth (6): con menos, regresaba un error crudo en inglés.
  const MIN_PASSWORD = 6;
  function checkPassword(pw) {
    if (String(pw || "").length < MIN_PASSWORD) return "La contraseña debe tener al menos " + MIN_PASSWORD + " caracteres.";
    return null;
  }

  // Un login fallido con la pestaña equivocada ("Correo o contraseña incorrectos" cuando la cuenta es de otro tipo)
  // debe orientar: se sugiere cambiar la pestaña.
  function loginErrorMessage(error) {
    const msg = String(error || "No pudimos iniciar sesión.");
    if (/incorrect|no es de|no existe/i.test(msg)) {
      return msg + " Si tu cuenta es de " + (role === "cliente" ? "un negocio" : "cliente") + ", cambia la pestaña de arriba.";
    }
    return msg;
  }

  // Deshabilita el botón de submit (con un texto de "cargando") mientras la
  // llamada async está en curso, igual que ya se hace en el resto de la
  // app — sin esto, un doble clic en "Crear cuenta"/"Iniciar sesión" podía
  // disparar dos registros o dos logins a la vez.
  async function withLoading(form, fn) {
    const btn = form.querySelector('button[type="submit"]');
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Un momento...";
    try {
      await fn();
    } catch (err) {
      // Antes un fallo inesperado (red, servidor) dejaba el botón girando sin mensaje.
      console.error("auth failed:", err);
      showError("No pudimos completar la operación. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  const ACCEPT_ERROR = "Para crear tu cuenta acepta los Términos y el Aviso de privacidad.";

  forms["cliente-register"].addEventListener("submit", (e) => {
    e.preventDefault();
    withLoading(e.target, async () => {
      const fd = new FormData(e.target);
      // Se normaliza igual que en el resto de la app: "+52 81 1234 5678" o con espacios/guiones queda en 10 dígitos
      // (antes el campo cortaba a 10 caracteres y guardaba otro número sin avisar).
      const ph = CupoValidate.phone(fd.get("phone"));
      if (!ph.ok || !ph.phone) return showError("El teléfono debe tener 10 dígitos (puedes pegarlo con +52).");
      // Un nombre de solo espacios pasaba el "required" del navegador y creaba una cuenta sin nombre.
      const names = CupoValidate.personName(fd.get("firstName"), fd.get("lastName"));
      if (!names.ok) return showError(names.error);
      const pwError = checkPassword(fd.get("password"));
      if (pwError) return showError(pwError);
      if (!fd.get("accept")) return showError(ACCEPT_ERROR);
      const result = await DataStore.registerClient({
        firstName: names.first,
        lastName: names.last,
        email: String(fd.get("email") || "").trim(),
        password: fd.get("password"),
        countryCode: DataStore.COUNTRY_CODES.find((c) => c.iso === fd.get("countryIso")).dial,
        phone: ph.phone,
      });
      if (!result.ok) return showError(result.error);
      await DataStore.setSession({ role: "cliente", id: result.client.id });
      goToDashboard();
    });
  });

  forms["negocio-register"].addEventListener("submit", (e) => {
    e.preventDefault();
    withLoading(e.target, async () => {
      const fd = new FormData(e.target);
      const text = CupoValidate.businessText(fd.get("name"), fd.get("address"));
      if (!text.ok) return showError(text.error);
      const pwError = checkPassword(fd.get("password"));
      if (pwError) return showError(pwError);
      if (!fd.get("accept")) return showError(ACCEPT_ERROR);
      const result = await DataStore.registerBusiness({
        name: text.name,
        category: fd.get("category"),
        address: text.address,
        email: String(fd.get("email") || "").trim(),
        password: fd.get("password"),
      });
      if (!result.ok) return showError(result.error);
      await DataStore.setSession({ role: "negocio", id: result.business.id });
      goToDashboard();
    });
  });

  forms["cliente-login"].addEventListener("submit", (e) => {
    e.preventDefault();
    withLoading(e.target, async () => {
      const fd = new FormData(e.target);
      const result = await DataStore.login("cliente", fd.get("email"), fd.get("password"));
      if (!result.ok) return showError(loginErrorMessage(result.error));
      await DataStore.setSession({ role: "cliente", id: result.id });
      goToDashboard();
    });
  });

  forms["negocio-login"].addEventListener("submit", (e) => {
    e.preventDefault();
    withLoading(e.target, async () => {
      const fd = new FormData(e.target);
      const result = await DataStore.login("negocio", fd.get("email"), fd.get("password"));
      if (!result.ok) return showError(loginErrorMessage(result.error));
      await DataStore.setSession({ role: "negocio", id: result.id });
      goToDashboard();
    });
  });

  // ── Recuperar contraseña ────────────────────────────────────────────────
  const forgotForm = document.getElementById("forgotPasswordForm");
  const forgotFields = document.getElementById("forgotFields");
  const forgotSuccess = document.getElementById("forgotSuccess");
  const roleToggleEl = document.querySelector(".role-toggle");
  const modeToggleEl = document.querySelector(".mode-toggle");

  function showForgotPassword() {
    // Si ya habían escrito su correo en el login, se conserva (no hay que volver a teclearlo).
    const typed = forms[key()].querySelector('input[type="email"]');
    const typedEmail = typed ? typed.value : "";
    Object.values(forms).forEach((f) => f.classList.remove("active"));
    forgotForm.classList.add("active");
    forgotFields.hidden = false;
    forgotForm.querySelector('button[type="submit"]').hidden = false;
    forgotSuccess.hidden = true;
    roleToggleEl.hidden = true;
    modeToggleEl.hidden = true;
    $authAside.hidden = true;
    authTitle.textContent = "Recuperar contraseña";
    authSub.textContent = "Te mandamos un link para que elijas una contraseña nueva.";
    document.title = "CUPO — Recuperar contraseña";
    errorMsg.classList.remove("show");
    errorMsg.textContent = "";
    const input = forgotForm.querySelector('input[name="email"]');
    if (typedEmail) input.value = typedEmail;
    input.focus();
    if ($authStatus) $authStatus.textContent = "Recuperar contraseña.";
  }

  function hideForgotPassword() {
    forgotForm.classList.remove("active");
    roleToggleEl.hidden = false;
    modeToggleEl.hidden = false;
    render({ announce: true });
    const first = forms[key()].querySelector("input");
    if (first) first.focus();
  }

  document.querySelectorAll("[data-forgot]").forEach((btn) => {
    btn.addEventListener("click", showForgotPassword);
  });
  document.getElementById("backToLoginBtn").addEventListener("click", hideForgotPassword);

  forgotForm.addEventListener("submit", (e) => {
    e.preventDefault();
    withLoading(e.target, async () => {
      const fd = new FormData(e.target);
      const result = await DataStore.requestPasswordReset(fd.get("email"));
      if (!result.ok) return showError(result.error);
      // No decimos "no existe esa cuenta" aunque el correo esté mal escrito
      // — es el mismo criterio que usa cualquier plataforma real para no
      // confirmarle a un desconocido qué correos sí están registrados.
      errorMsg.classList.remove("show");
      // Confirmación bien visible (y anunciada): reemplaza el formulario en vez de quedar escondida en el subtítulo.
      forgotSuccess.textContent = "Listo: si existe una cuenta con ese correo, te llegará un link para elegir una contraseña nueva (revisa también spam). Puede tardar un par de minutos.";
      forgotSuccess.hidden = false;
      forgotFields.hidden = true;
      e.target.querySelector('button[type="submit"]').hidden = true;
      e.target.reset();
      // Para que, si el link venció, la página de nueva contraseña sepa a qué login regresar.
      try { sessionStorage.setItem("cupo_reset_role", role); } catch (err) { /* sin almacenamiento */ }
      document.getElementById("backToLoginBtn").focus();
    });
  });

  // ── Sesión ya abierta ────────────────────────────────────────────────────
  // Quien ya tiene sesión y abre esta página se entera (y puede ir a su panel o cerrarla) en vez de poder
  // registrar otra cuenta encima sin darse cuenta. No se redirige solo: puede haber llegado a propósito.
  Promise.resolve()
    .then(() => DataStore.getSession())
    .then((s) => {
      if (!s || !$sessionNotice) return;
      const isNegocio = s.role === "negocio";
      const target = safeNext(isNegocio ? "negocio" : "cliente") || (isNegocio ? "negocio.html" : "cliente.html");
      $sessionNotice.innerHTML = "";
      const text = document.createElement("span");
      text.textContent = "Ya tienes una sesión abierta como " + (isNegocio ? "negocio" : "cliente") + ".";
      const go = document.createElement("a");
      go.href = target;
      go.textContent = isNegocio ? "Ir a mi agenda" : "Ir a mis cupos";
      const out = document.createElement("button");
      out.type = "button";
      out.textContent = "Cerrar sesión";
      out.addEventListener("click", async () => {
        out.disabled = true;
        try { await DataStore.clearSession(); } catch (err) { /* se avisa abajo */ }
        $sessionNotice.hidden = true;
        if ($authStatus) $authStatus.textContent = "Sesión cerrada.";
      });
      $sessionNotice.append(text, go, out);
      $sessionNotice.hidden = false;
    })
    .catch(() => { /* sin sesión legible: se muestra el formulario normal */ });

  render();
  // auth.html?mode=login&forgot=1 (desde "Pedir un link nuevo") abre directo la recuperación.
  if (params.get("forgot") === "1" && mode === "login") showForgotPassword();
})();
