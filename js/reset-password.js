(async function () {
  const form = document.getElementById("resetPasswordForm");
  const invalidLinkPanel = document.getElementById("invalidLinkPanel");
  const errorMsg = document.getElementById("errorMsg");
  const pageSub = document.getElementById("pageSub");

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.classList.add("show");
  }

  // supabase-js arma sola la sesión temporal de recuperación leyendo el
  // hash del link que llegó por correo (detectSessionInUrl, por default).
  // Si no hay sesión es que el link ya se usó, expiró, o alguien llegó
  // aquí directo sin pasar por "Olvidé mi contraseña".
  let session;
  try {
    session = await DataStore.getSession();
  } catch (err) {
    session = null;
  }
  if (!session) {
    form.hidden = true;
    invalidLinkPanel.hidden = false;
    pageSub.textContent = "Este link ya no es válido o expiró.";
    return;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorMsg.classList.remove("show");
    const fd = new FormData(e.target);
    const password = fd.get("password");
    const password2 = fd.get("password2");
    if (password !== password2) return showError("Las contraseñas no coinciden.");

    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.textContent = "Guardando...";
    const result = await DataStore.updatePassword(password);
    btn.disabled = false;
    btn.textContent = "Guardar contraseña";
    if (!result.ok) return showError(result.error);

    form.hidden = true;
    pageSub.textContent = "¡Listo! Ya puedes iniciar sesión con tu nueva contraseña.";
    const goLogin = document.createElement("a");
    goLogin.href = "auth.html?mode=login&role=" + (session.role === "negocio" ? "negocio" : "cliente");
    goLogin.className = "btn btn-primary btn-block";
    goLogin.style.marginTop = "8px";
    goLogin.textContent = "Iniciar sesión";
    form.insertAdjacentElement("afterend", goLogin);
  });
})();
