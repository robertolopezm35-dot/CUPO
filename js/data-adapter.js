// Punto único que el resto de la app usa para hablar con "la base de
// datos", sin importar cuál sea. Elige Supabase en cuanto
// js/supabase-config.js tenga URL + anonKey; si no, sigue usando
// localStorage (CupoStore) exactamente como hasta ahora.
const DataStore = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.anonKey)
  ? SupabaseStore
  : CupoStore;

// Sembrar los negocios de demostración solo cuando de verdad se usa localStorage: en el sitio
// conectado a Supabase no sirven para nada y llenaban el navegador de cada visitante.
if (DataStore === CupoStore) CupoStore.init();

// Si la sesión cambia en OTRA pestaña (cerrar sesión, entrar con otro rol), esta pestaña
// recarga en vez de seguir mostrando —y usando— una sesión que ya no existe. Se llama desde
// los paneles (cliente, negocio, ventas); no desde auth.html (ahí es donde se inicia sesión).
DataStore.watchSessionChange = function () {
  window.addEventListener("storage", (e) => {
    if (e.key === "cupo_session" || /^sb-.*-auth-token$/.test(e.key || "")) window.location.reload();
  });
  // Al volver con el botón Atrás el navegador puede restaurar la página tal como estaba
  // (con datos privados) aunque ya se haya cerrado la sesión: se recarga.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) window.location.reload();
  });
};
