(function () {
  const params = new URLSearchParams(window.location.search);
  let role = params.get("role") === "negocio" ? "negocio" : "cliente";
  let mode = params.get("mode") === "login" ? "login" : "register";

  const roleClienteBtn = document.getElementById("roleClienteBtn");
  const roleNegocioBtn = document.getElementById("roleNegocioBtn");
  const authTitle = document.getElementById("authTitle");
  const authSub = document.getElementById("authSub");
  const errorMsg = document.getElementById("errorMsg");
  const modeToggleText = document.getElementById("modeToggleText");
  const modeToggleBtn = document.getElementById("modeToggleBtn");

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

  function key() {
    return role + "-" + mode;
  }

  function render() {
    roleClienteBtn.classList.toggle("active", role === "cliente");
    roleNegocioBtn.classList.toggle("active", role === "negocio");
    roleClienteBtn.setAttribute("aria-pressed", role === "cliente" ? "true" : "false");
    roleNegocioBtn.setAttribute("aria-pressed", role === "negocio" ? "true" : "false");

    Object.values(forms).forEach((f) => f.classList.remove("active"));
    forms[key()].classList.add("active");

    const c = copy[key()];
    authTitle.textContent = c.title;
    authSub.textContent = c.sub;
    modeToggleText.textContent = c.toggleText;
    modeToggleBtn.textContent = c.toggleBtn;

    errorMsg.classList.remove("show");
    errorMsg.textContent = "";
  }

  roleClienteBtn.addEventListener("click", () => { role = "cliente"; render(); });
  roleNegocioBtn.addEventListener("click", () => { role = "negocio"; render(); });
  modeToggleBtn.addEventListener("click", () => {
    mode = mode === "register" ? "login" : "register";
    render();
  });

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add("show");
  }

  function goToDashboard() {
    // Si llegaron aquí por un link compartido (?negocio=ID) que los mandó a
    // loguearse primero, que regresen exactamente a donde iban en vez de a
    // la lista genérica — pero solo si de verdad vienen para cliente.html,
    // nunca si cambiaron de rol a Negocio en el camino.
    // location.replace: el formulario de registro/login no se queda en el historial, así
    // que "Atrás" desde el panel no regresa a un formulario ya enviado.
    const next = params.get("next");
    if (next && role === "cliente" && next.startsWith("cliente.html")) {
      window.location.replace(next);
      return;
    }
    window.location.replace(role === "cliente" ? "cliente.html" : "negocio.html");
  }

  // Mínimo de contraseña de Supabase Auth (6): con menos, regresaba un error crudo en inglés.
  const MIN_PASSWORD = 6;
  function checkPassword(pw) {
    if (String(pw || "").length < MIN_PASSWORD) return "La contraseña debe tener al menos " + MIN_PASSWORD + " caracteres.";
    return null;
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
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  }

  forms["cliente-register"].addEventListener("submit", (e) => {
    e.preventDefault();
    withLoading(e.target, async () => {
      const fd = new FormData(e.target);
      const phone = fd.get("phone").trim();
      if (!/^\d{10}$/.test(phone)) return showError("El teléfono debe tener 10 dígitos.");
      // Un nombre de solo espacios pasaba el "required" del navegador y creaba una cuenta sin nombre.
      const names = CupoValidate.personName(fd.get("firstName"), fd.get("lastName"));
      if (!names.ok) return showError(names.error);
      const pwError = checkPassword(fd.get("password"));
      if (pwError) return showError(pwError);
      const result = await DataStore.registerClient({
        firstName: names.first,
        lastName: names.last,
        email: String(fd.get("email") || "").trim(),
        password: fd.get("password"),
        countryCode: DataStore.COUNTRY_CODES.find((c) => c.iso === fd.get("countryIso")).dial,
        phone,
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
      if (!result.ok) return showError(result.error);
      await DataStore.setSession({ role: "cliente", id: result.id });
      goToDashboard();
    });
  });

  forms["negocio-login"].addEventListener("submit", (e) => {
    e.preventDefault();
    withLoading(e.target, async () => {
      const fd = new FormData(e.target);
      const result = await DataStore.login("negocio", fd.get("email"), fd.get("password"));
      if (!result.ok) return showError(result.error);
      await DataStore.setSession({ role: "negocio", id: result.id });
      goToDashboard();
    });
  });

  // ── Recuperar contraseña ────────────────────────────────────────────────
  const forgotForm = document.getElementById("forgotPasswordForm");
  const roleToggleEl = document.querySelector(".role-toggle");
  const modeToggleEl = document.querySelector(".mode-toggle");

  function showForgotPassword() {
    Object.values(forms).forEach((f) => f.classList.remove("active"));
    forgotForm.classList.add("active");
    roleToggleEl.hidden = true;
    modeToggleEl.hidden = true;
    authTitle.textContent = "Recuperar contraseña";
    authSub.textContent = "Te mandamos un link para que elijas una contraseña nueva.";
    errorMsg.classList.remove("show");
    errorMsg.textContent = "";
  }

  function hideForgotPassword() {
    forgotForm.classList.remove("active");
    roleToggleEl.hidden = false;
    modeToggleEl.hidden = false;
    render();
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
      authSub.textContent = "Listo — si existe una cuenta con ese correo, te llegará un link (revisa spam también). Puede tardar un par de minutos.";
      e.target.reset();
    });
  });

  render();
})();
