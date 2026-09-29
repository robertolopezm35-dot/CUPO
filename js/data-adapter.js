// Punto único que el resto de la app usa para hablar con "la base de
// datos", sin importar cuál sea. Elige Supabase en cuanto
// js/supabase-config.js tenga URL + anonKey; si no, sigue usando
// localStorage (CupoStore) exactamente como hasta ahora.
const DataStore = (window.SUPABASE_CONFIG && window.SUPABASE_CONFIG.url && window.SUPABASE_CONFIG.anonKey)
  ? SupabaseStore
  : CupoStore;
