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

  const copy = {
    "cliente-register": { title: "Crear cuenta", sub: "Encuentra citas de último momento cerca de ti.", toggleText: "¿Ya tienes cuenta?", toggleBtn: "Inicia sesión" },
    "negocio-register": { title: "Registra tu negocio", sub: "Publica tus cupos disponibles y llena tu agenda.", toggleText: "¿Ya tienes cuenta?", toggleBtn: "Inicia sesión" },
    "cliente-login": { title: "Inicia sesión", sub: "Entra para ver los cupos disponibles cerca de ti.", toggleText: "¿No tienes cuenta?", toggleBtn: "Regístrate" },
    "negocio-login": { title: "Inicia sesión", sub: "Entra para gestionar la agenda de tu negocio.", toggleText: "¿No tienes cuenta?", toggleBtn: "Regístrate" },
  };

  function key() {
    return role + "-" + mode;
  }

  function render() {
    roleClienteBtn.classList.toggle("active", role === "cliente");
    roleNegocioBtn.classList.toggle("active", role === "negocio");

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
    window.location.href = role === "cliente" ? "cliente.html" : "negocio.html";
  }

  forms["cliente-register"].addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const result = CupoStore.registerClient({
      name: fd.get("name"),
      email: fd.get("email"),
      password: fd.get("password"),
      phone: fd.get("phone"),
    });
    if (!result.ok) return showError(result.error);
    CupoStore.setSession({ role: "cliente", id: result.client.id });
    goToDashboard();
  });

  forms["negocio-register"].addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const result = CupoStore.registerBusiness({
      name: fd.get("name"),
      category: fd.get("category"),
      address: fd.get("address"),
      email: fd.get("email"),
      password: fd.get("password"),
    });
    if (!result.ok) return showError(result.error);
    CupoStore.setSession({ role: "negocio", id: result.business.id });
    goToDashboard();
  });

  forms["cliente-login"].addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const client = CupoStore.findClientByEmail(fd.get("email"));
    if (!client || client.password !== fd.get("password")) {
      return showError("Correo o contraseña incorrectos.");
    }
    CupoStore.setSession({ role: "cliente", id: client.id });
    goToDashboard();
  });

  forms["negocio-login"].addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const business = CupoStore.findBusinessByEmail(fd.get("email"));
    if (!business || business.password !== fd.get("password")) {
      return showError("Correo o contraseña incorrectos.");
    }
    CupoStore.setSession({ role: "negocio", id: business.id });
    goToDashboard();
  });

  render();
})();
