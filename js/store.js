const CupoStore = (() => {
  const KEYS = {
    businesses: "cupo_businesses",
    clients: "cupo_clients",
    session: "cupo_session",
  };

  const AREAS = [
    {
      id: "estetica",
      name: "Estética",
      icon: "✨",
      comingSoon: false,
      categories: ["Barbería", "Salón", "Spa", "Uñas", "Maquillaje", "Estética facial"],
    },
    {
      id: "doctores",
      name: "Doctores",
      icon: "🩺",
      comingSoon: true,
      categories: [],
    },
  ];

  const CATEGORIES = AREAS.find((a) => a.id === "estetica").categories;

  const CATEGORY_VISUALS = {
    "Barbería": { emoji: "💈", hue: 35 },
    "Salón": { emoji: "💇", hue: 340 },
    "Spa": { emoji: "🧖", hue: 175 },
    "Uñas": { emoji: "💅", hue: 10 },
    "Maquillaje": { emoji: "💄", hue: 280 },
    "Estética facial": { emoji: "🧴", hue: 200 },
  };

  const SERVICES_BY_CATEGORY = {
    "Barbería": ["Corte clásico", "Corte + barba", "Arreglo de barba", "Diseño/fade", "Afeitado tradicional"],
    "Salón": ["Corte", "Tinte", "Mechas/balayage", "Peinado", "Tratamiento capilar"],
    "Spa": ["Masaje relajante", "Masaje terapéutico", "Facial", "Circuito spa", "Exfoliación corporal"],
    "Uñas": ["Manicure", "Pedicure", "Manicure + pedicure", "Uñas acrílicas/gel", "Nail art"],
    "Maquillaje": ["Maquillaje social", "Maquillaje de novia", "Maquillaje express", "Clase de automaquillaje"],
    "Estética facial": ["Limpieza facial", "Hidrafacial", "Peeling", "Tratamiento anti-edad", "Consulta estética"],
  };

  function flagEmoji(iso) {
    return iso.toUpperCase().replace(/./g, (ch) => String.fromCodePoint(127397 + ch.charCodeAt(0)));
  }

  const COUNTRY_CODES = [
    { iso: "AF", name: "Afganistán", dial: "+93" },
    { iso: "AL", name: "Albania", dial: "+355" },
    { iso: "DE", name: "Alemania", dial: "+49" },
    { iso: "AD", name: "Andorra", dial: "+376" },
    { iso: "AO", name: "Angola", dial: "+244" },
    { iso: "AI", name: "Anguila", dial: "+1264" },
    { iso: "AG", name: "Antigua y Barbuda", dial: "+1268" },
    { iso: "SA", name: "Arabia Saudita", dial: "+966" },
    { iso: "DZ", name: "Argelia", dial: "+213" },
    { iso: "AR", name: "Argentina", dial: "+54" },
    { iso: "AM", name: "Armenia", dial: "+374" },
    { iso: "AW", name: "Aruba", dial: "+297" },
    { iso: "AU", name: "Australia", dial: "+61" },
    { iso: "AT", name: "Austria", dial: "+43" },
    { iso: "AZ", name: "Azerbaiyán", dial: "+994" },
    { iso: "BS", name: "Bahamas", dial: "+1242" },
    { iso: "BH", name: "Baréin", dial: "+973" },
    { iso: "BD", name: "Bangladés", dial: "+880" },
    { iso: "BB", name: "Barbados", dial: "+1246" },
    { iso: "BE", name: "Bélgica", dial: "+32" },
    { iso: "BZ", name: "Belice", dial: "+501" },
    { iso: "BJ", name: "Benín", dial: "+229" },
    { iso: "BM", name: "Bermudas", dial: "+1441" },
    { iso: "BY", name: "Bielorrusia", dial: "+375" },
    { iso: "BO", name: "Bolivia", dial: "+591" },
    { iso: "BA", name: "Bosnia y Herzegovina", dial: "+387" },
    { iso: "BW", name: "Botsuana", dial: "+267" },
    { iso: "BR", name: "Brasil", dial: "+55" },
    { iso: "BN", name: "Brunéi", dial: "+673" },
    { iso: "BG", name: "Bulgaria", dial: "+359" },
    { iso: "BF", name: "Burkina Faso", dial: "+226" },
    { iso: "BI", name: "Burundi", dial: "+257" },
    { iso: "BT", name: "Bután", dial: "+975" },
    { iso: "CV", name: "Cabo Verde", dial: "+238" },
    { iso: "KH", name: "Camboya", dial: "+855" },
    { iso: "CM", name: "Camerún", dial: "+237" },
    { iso: "CA", name: "Canadá", dial: "+1" },
    { iso: "QA", name: "Catar", dial: "+974" },
    { iso: "KZ", name: "Kazajistán", dial: "+7" },
    { iso: "TD", name: "Chad", dial: "+235" },
    { iso: "CZ", name: "Chequia", dial: "+420" },
    { iso: "CL", name: "Chile", dial: "+56" },
    { iso: "CN", name: "China", dial: "+86" },
    { iso: "CY", name: "Chipre", dial: "+357" },
    { iso: "VA", name: "Ciudad del Vaticano", dial: "+379" },
    { iso: "CO", name: "Colombia", dial: "+57" },
    { iso: "KM", name: "Comoras", dial: "+269" },
    { iso: "KP", name: "Corea del Norte", dial: "+850" },
    { iso: "KR", name: "Corea del Sur", dial: "+82" },
    { iso: "CI", name: "Costa de Marfil", dial: "+225" },
    { iso: "CR", name: "Costa Rica", dial: "+506" },
    { iso: "HR", name: "Croacia", dial: "+385" },
    { iso: "CU", name: "Cuba", dial: "+53" },
    { iso: "DK", name: "Dinamarca", dial: "+45" },
    { iso: "DM", name: "Dominica", dial: "+1767" },
    { iso: "EC", name: "Ecuador", dial: "+593" },
    { iso: "EG", name: "Egipto", dial: "+20" },
    { iso: "SV", name: "El Salvador", dial: "+503" },
    { iso: "AE", name: "Emiratos Árabes Unidos", dial: "+971" },
    { iso: "ER", name: "Eritrea", dial: "+291" },
    { iso: "SK", name: "Eslovaquia", dial: "+421" },
    { iso: "SI", name: "Eslovenia", dial: "+386" },
    { iso: "ES", name: "España", dial: "+34" },
    { iso: "US", name: "Estados Unidos", dial: "+1" },
    { iso: "EE", name: "Estonia", dial: "+372" },
    { iso: "SZ", name: "Esuatini", dial: "+268" },
    { iso: "ET", name: "Etiopía", dial: "+251" },
    { iso: "PH", name: "Filipinas", dial: "+63" },
    { iso: "FI", name: "Finlandia", dial: "+358" },
    { iso: "FJ", name: "Fiyi", dial: "+679" },
    { iso: "FR", name: "Francia", dial: "+33" },
    { iso: "GA", name: "Gabón", dial: "+241" },
    { iso: "GM", name: "Gambia", dial: "+220" },
    { iso: "GE", name: "Georgia", dial: "+995" },
    { iso: "GH", name: "Ghana", dial: "+233" },
    { iso: "GI", name: "Gibraltar", dial: "+350" },
    { iso: "GD", name: "Granada", dial: "+1473" },
    { iso: "GR", name: "Grecia", dial: "+30" },
    { iso: "GL", name: "Groenlandia", dial: "+299" },
    { iso: "GP", name: "Guadalupe", dial: "+590" },
    { iso: "GU", name: "Guam", dial: "+1671" },
    { iso: "GT", name: "Guatemala", dial: "+502" },
    { iso: "GY", name: "Guyana", dial: "+592" },
    { iso: "GF", name: "Guayana Francesa", dial: "+594" },
    { iso: "GN", name: "Guinea", dial: "+224" },
    { iso: "GQ", name: "Guinea Ecuatorial", dial: "+240" },
    { iso: "GW", name: "Guinea-Bisáu", dial: "+245" },
    { iso: "HT", name: "Haití", dial: "+509" },
    { iso: "HN", name: "Honduras", dial: "+504" },
    { iso: "HK", name: "Hong Kong", dial: "+852" },
    { iso: "HU", name: "Hungría", dial: "+36" },
    { iso: "IN", name: "India", dial: "+91" },
    { iso: "ID", name: "Indonesia", dial: "+62" },
    { iso: "IQ", name: "Irak", dial: "+964" },
    { iso: "IR", name: "Irán", dial: "+98" },
    { iso: "IE", name: "Irlanda", dial: "+353" },
    { iso: "IS", name: "Islandia", dial: "+354" },
    { iso: "KY", name: "Islas Caimán", dial: "+1345" },
    { iso: "CK", name: "Islas Cook", dial: "+682" },
    { iso: "MH", name: "Islas Marshall", dial: "+692" },
    { iso: "SB", name: "Islas Salomón", dial: "+677" },
    { iso: "IL", name: "Israel", dial: "+972" },
    { iso: "IT", name: "Italia", dial: "+39" },
    { iso: "JM", name: "Jamaica", dial: "+1876" },
    { iso: "JP", name: "Japón", dial: "+81" },
    { iso: "JO", name: "Jordania", dial: "+962" },
    { iso: "KE", name: "Kenia", dial: "+254" },
    { iso: "KG", name: "Kirguistán", dial: "+996" },
    { iso: "KI", name: "Kiribati", dial: "+686" },
    { iso: "KW", name: "Kuwait", dial: "+965" },
    { iso: "LA", name: "Laos", dial: "+856" },
    { iso: "LS", name: "Lesoto", dial: "+266" },
    { iso: "LV", name: "Letonia", dial: "+371" },
    { iso: "LB", name: "Líbano", dial: "+961" },
    { iso: "LR", name: "Liberia", dial: "+231" },
    { iso: "LY", name: "Libia", dial: "+218" },
    { iso: "LI", name: "Liechtenstein", dial: "+423" },
    { iso: "LT", name: "Lituania", dial: "+370" },
    { iso: "LU", name: "Luxemburgo", dial: "+352" },
    { iso: "MO", name: "Macao", dial: "+853" },
    { iso: "MK", name: "Macedonia del Norte", dial: "+389" },
    { iso: "MG", name: "Madagascar", dial: "+261" },
    { iso: "MY", name: "Malasia", dial: "+60" },
    { iso: "MW", name: "Malaui", dial: "+265" },
    { iso: "MV", name: "Maldivas", dial: "+960" },
    { iso: "ML", name: "Malí", dial: "+223" },
    { iso: "MT", name: "Malta", dial: "+356" },
    { iso: "MA", name: "Marruecos", dial: "+212" },
    { iso: "MQ", name: "Martinica", dial: "+596" },
    { iso: "MU", name: "Mauricio", dial: "+230" },
    { iso: "MR", name: "Mauritania", dial: "+222" },
    { iso: "MX", name: "México", dial: "+52" },
    { iso: "FM", name: "Micronesia", dial: "+691" },
    { iso: "MD", name: "Moldavia", dial: "+373" },
    { iso: "MC", name: "Mónaco", dial: "+377" },
    { iso: "MN", name: "Mongolia", dial: "+976" },
    { iso: "ME", name: "Montenegro", dial: "+382" },
    { iso: "MZ", name: "Mozambique", dial: "+258" },
    { iso: "MM", name: "Myanmar", dial: "+95" },
    { iso: "NA", name: "Namibia", dial: "+264" },
    { iso: "NR", name: "Nauru", dial: "+674" },
    { iso: "NP", name: "Nepal", dial: "+977" },
    { iso: "NI", name: "Nicaragua", dial: "+505" },
    { iso: "NE", name: "Níger", dial: "+227" },
    { iso: "NG", name: "Nigeria", dial: "+234" },
    { iso: "NO", name: "Noruega", dial: "+47" },
    { iso: "NZ", name: "Nueva Zelanda", dial: "+64" },
    { iso: "NL", name: "Países Bajos", dial: "+31" },
    { iso: "PK", name: "Pakistán", dial: "+92" },
    { iso: "PW", name: "Palaos", dial: "+680" },
    { iso: "PA", name: "Panamá", dial: "+507" },
    { iso: "PG", name: "Papúa Nueva Guinea", dial: "+675" },
    { iso: "PY", name: "Paraguay", dial: "+595" },
    { iso: "PE", name: "Perú", dial: "+51" },
    { iso: "PF", name: "Polinesia Francesa", dial: "+689" },
    { iso: "PL", name: "Polonia", dial: "+48" },
    { iso: "PT", name: "Portugal", dial: "+351" },
    { iso: "PR", name: "Puerto Rico", dial: "+1787" },
    { iso: "GB", name: "Reino Unido", dial: "+44" },
    { iso: "CF", name: "República Centroafricana", dial: "+236" },
    { iso: "CD", name: "República Democrática del Congo", dial: "+243" },
    { iso: "DO", name: "República Dominicana", dial: "+1809" },
    { iso: "RW", name: "Ruanda", dial: "+250" },
    { iso: "RO", name: "Rumanía", dial: "+40" },
    { iso: "RU", name: "Rusia", dial: "+7" },
    { iso: "WS", name: "Samoa", dial: "+685" },
    { iso: "AS", name: "Samoa Americana", dial: "+1684" },
    { iso: "KN", name: "San Cristóbal y Nieves", dial: "+1869" },
    { iso: "SM", name: "San Marino", dial: "+378" },
    { iso: "VC", name: "San Vicente y las Granadinas", dial: "+1784" },
    { iso: "LC", name: "Santa Lucía", dial: "+1758" },
    { iso: "ST", name: "Santo Tomé y Príncipe", dial: "+239" },
    { iso: "SN", name: "Senegal", dial: "+221" },
    { iso: "RS", name: "Serbia", dial: "+381" },
    { iso: "SC", name: "Seychelles", dial: "+248" },
    { iso: "SL", name: "Sierra Leona", dial: "+232" },
    { iso: "SG", name: "Singapur", dial: "+65" },
    { iso: "SY", name: "Siria", dial: "+963" },
    { iso: "SO", name: "Somalia", dial: "+252" },
    { iso: "LK", name: "Sri Lanka", dial: "+94" },
    { iso: "ZA", name: "Sudáfrica", dial: "+27" },
    { iso: "SD", name: "Sudán", dial: "+249" },
    { iso: "SS", name: "Sudán del Sur", dial: "+211" },
    { iso: "SE", name: "Suecia", dial: "+46" },
    { iso: "CH", name: "Suiza", dial: "+41" },
    { iso: "SR", name: "Surinam", dial: "+597" },
    { iso: "TH", name: "Tailandia", dial: "+66" },
    { iso: "TW", name: "Taiwán", dial: "+886" },
    { iso: "TZ", name: "Tanzania", dial: "+255" },
    { iso: "TJ", name: "Tayikistán", dial: "+992" },
    { iso: "TL", name: "Timor Oriental", dial: "+670" },
    { iso: "TG", name: "Togo", dial: "+228" },
    { iso: "TO", name: "Tonga", dial: "+676" },
    { iso: "TT", name: "Trinidad y Tobago", dial: "+1868" },
    { iso: "TN", name: "Túnez", dial: "+216" },
    { iso: "TM", name: "Turkmenistán", dial: "+993" },
    { iso: "TR", name: "Turquía", dial: "+90" },
    { iso: "TV", name: "Tuvalu", dial: "+688" },
    { iso: "UA", name: "Ucrania", dial: "+380" },
    { iso: "UG", name: "Uganda", dial: "+256" },
    { iso: "UY", name: "Uruguay", dial: "+598" },
    { iso: "UZ", name: "Uzbekistán", dial: "+998" },
    { iso: "VU", name: "Vanuatu", dial: "+678" },
    { iso: "VE", name: "Venezuela", dial: "+58" },
    { iso: "VN", name: "Vietnam", dial: "+84" },
    { iso: "YE", name: "Yemen", dial: "+967" },
    { iso: "DJ", name: "Yibuti", dial: "+253" },
    { iso: "ZM", name: "Zambia", dial: "+260" },
    { iso: "ZW", name: "Zimbabue", dial: "+263" },
  ].map((c) => ({ ...c, flag: flagEmoji(c.iso) }));

  function todayAt(hour, minute) {
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  }

  function seedSlots(baseHour, count, price, services) {
    const slots = [];
    for (let i = 0; i < count; i++) {
      const h = baseHour + i;
      slots.push({
        id: "s" + Math.random().toString(36).slice(2, 9),
        time: todayAt(h, 0),
        label: (h > 12 ? h - 12 : h) + ":00 " + (h >= 12 ? "PM" : "AM"),
        duration: 45,
        price: price,
        service: services ? services[i % services.length] : null,
        status: "available",
        clientId: null,
        clientName: null,
      });
    }
    return slots;
  }

  const DEMO_CLIENT_NAMES = [
    "Ana García", "Luis Hernández", "María Rodríguez", "Carlos Martínez", "Sofía López",
    "Jorge Pérez", "Daniela Sánchez", "Miguel Torres", "Fernanda Ramírez", "Diego Flores",
    "Valeria Castro", "Andrés Morales", "Camila Vázquez", "Ricardo Jiménez", "Paola Reyes",
    "Javier Cruz", "Renata Gómez", "Emilio Ortiz", "Ximena Mendoza", "Pablo Romero",
  ];

  function randomPastTimestamp(daysBack) {
    const dayOffset = Math.floor(Math.random() * daysBack);
    const hour = 9 + Math.floor(Math.random() * 11);
    const minute = Math.random() < 0.5 ? 0 : 30;
    const d = new Date(Date.now() - dayOffset * 86400000);
    d.setHours(hour, minute, 0, 0);
    return d.getTime();
  }

  // Genera historial de ventas de demostración (últimos 30 días) para que
  // el dashboard de Ventas no se vea vacío con los negocios semilla.
  function seedSales(services, basePrice) {
    const count = 18 + Math.floor(Math.random() * 20);
    const sales = [];
    for (let i = 0; i < count; i++) {
      const cancelled = Math.random() < 0.08;
      const jitter = 0.85 + Math.random() * 0.3;
      sales.push({
        id: "v" + Math.random().toString(36).slice(2, 9),
        date: randomPastTimestamp(30),
        service: services[Math.floor(Math.random() * services.length)],
        price: Math.round((basePrice * jitter) / 10) * 10,
        clientName: DEMO_CLIENT_NAMES[Math.floor(Math.random() * DEMO_CLIENT_NAMES.length)],
        slotId: null,
        status: cancelled ? "cancelada" : "completada",
      });
    }
    sales.sort((a, b) => b.date - a.date);
    return sales;
  }

  function bizSeed(category, baseHour, count, price) {
    const services = SERVICES_BY_CATEGORY[category];
    return {
      slots: seedSlots(baseHour, count, price, services),
      sales: seedSales(services, price),
    };
  }

  function seedBusinesses() {
    return [
      // Barberías
      { id: "b1", name: "Bravos Barbería", category: "Barbería", address: "Barrio Antiguo, Monterrey", lat: 25.6693, lng: -100.3099, email: "bravos@cupo.mx", password: "1234", rating: 4.8, ...bizSeed("Barbería", 15, 4, 180) },
      { id: "b2", name: "Alpha Barberías", category: "Barbería", address: "Col. Contry, Monterrey", lat: 25.6392, lng: -100.2788, email: "alpha@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Barbería", 14, 4, 190) },
      { id: "b3", name: "La Barbería Nacional", category: "Barbería", address: "Cumbres, Monterrey", lat: 25.7532, lng: -100.3625, email: "nacional@cupo.mx", password: "1234", rating: 4.9, ...bizSeed("Barbería", 16, 3, 200) },
      { id: "b4", name: "BarbaNegra", category: "Barbería", address: "Col. Del Valle, San Pedro Garza García", lat: 25.6521, lng: -100.3644, email: "barbanegra@cupo.mx", password: "1234", rating: 4.6, ...bizSeed("Barbería", 13, 4, 170) },
      { id: "b5", name: "MTM Barber Club", category: "Barbería", address: "Col. Mitras, Monterrey", lat: 25.6889, lng: -100.3517, email: "mtm@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Barbería", 17, 3, 210) },

      // Salones
      { id: "b6", name: "D'Anna Estilistas", category: "Salón", address: "Monterrey", lat: 25.6714, lng: -100.3095, email: "danna@cupo.mx", password: "1234", rating: 4.5, ...bizSeed("Salón", 14, 3, 300) },
      { id: "b7", name: "Yuv & Co. Style", category: "Salón", address: "Monterrey", lat: 25.6750, lng: -100.3150, email: "yuv@cupo.mx", password: "1234", rating: 4.6, ...bizSeed("Salón", 12, 4, 280) },
      { id: "b8", name: "La Luna Saloon & Boutik", category: "Salón", address: "Monterrey", lat: 25.6680, lng: -100.3050, email: "laluna@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Salón", 15, 3, 320) },
      { id: "b9", name: "El Alessa Beauty Salon", category: "Salón", address: "Monterrey", lat: 25.6620, lng: -100.3200, email: "alessa@cupo.mx", password: "1234", rating: 4.6, ...bizSeed("Salón", 11, 4, 260) },
      { id: "b10", name: "Women's Hair Estética Unisex", category: "Salón", address: "Monterrey", lat: 25.6800, lng: -100.3000, email: "womenshair@cupo.mx", password: "1234", rating: 4.5, ...bizSeed("Salón", 16, 3, 270) },

      // Spas
      { id: "b11", name: "Mantra Mind & Body Spa", category: "Spa", address: "Río Moctezuma 303, Col. Del Valle, San Pedro Garza García", lat: 25.6500, lng: -100.3650, email: "mantra@cupo.mx", password: "1234", rating: 4.9, ...bizSeed("Spa", 10, 3, 1250) },
      { id: "b12", name: "Azuleno Spa", category: "Spa", address: "Río Amazonas 60 Ote, San Pedro Garza García", lat: 25.6550, lng: -100.3700, email: "azuleno@cupo.mx", password: "1234", rating: 4.8, ...bizSeed("Spa", 11, 3, 1100) },
      { id: "b13", name: "Facial Co Spa", category: "Spa", address: "Av. Lázaro Cárdenas 2510, Local 12A, San Pedro Garza García", lat: 25.6430, lng: -100.3780, email: "facialco@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Spa", 9, 4, 950) },
      { id: "b14", name: "O. Spa Salón (O. Sierra Madre)", category: "Spa", address: "Av. Manuel Gómez Morín 1105, San Pedro Garza García", lat: 25.6330, lng: -100.3650, email: "osierramadre@cupo.mx", password: "1234", rating: 4.6, ...bizSeed("Spa", 12, 3, 1050) },
      { id: "b15", name: "Thann Sanctuary", category: "Spa", address: "San Pedro Garza García", lat: 25.6506, lng: -100.4022, email: "thann@cupo.mx", password: "1234", rating: 4.8, ...bizSeed("Spa", 13, 3, 1300) },

      // Uñas
      { id: "b16", name: "HG Nails", category: "Uñas", address: "Roque González Garza 140, San Pedro Garza García", lat: 25.6480, lng: -100.3800, email: "hgnails@cupo.mx", password: "1234", rating: 4.9, ...bizSeed("Uñas", 11, 4, 280) },
      { id: "b17", name: "Only Nails Del Valle", category: "Uñas", address: "Río Missouri 555, Col. Del Valle, San Pedro Garza García", lat: 25.6470, lng: -100.3660, email: "onlynailsdelvalle@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Uñas", 10, 4, 260) },
      { id: "b18", name: "Only Nails San Agustín", category: "Uñas", address: "Av. Real San Agustín, San Pedro Garza García", lat: 25.6480, lng: -100.3550, email: "onlynailssa@cupo.mx", password: "1234", rating: 4.6, ...bizSeed("Uñas", 14, 4, 250) },
      { id: "b19", name: "The New Black Beauty Lab", category: "Uñas", address: "Barrio Antiguo, Monterrey", lat: 25.6700, lng: -100.3110, email: "newblack@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Uñas", 12, 3, 300) },
      { id: "b20", name: "Only Nails Cumbres", category: "Uñas", address: "Paseo de los Leones 3433, Cumbres, Monterrey", lat: 25.7280, lng: -100.3550, email: "onlynailscumbres@cupo.mx", password: "1234", rating: 4.6, ...bizSeed("Uñas", 15, 3, 255) },

      // Maquillaje
      { id: "b21", name: "Be Glamour Studio", category: "Maquillaje", address: "Monterrey", lat: 25.6690, lng: -100.3180, email: "beglamour@cupo.mx", password: "1234", rating: 4.0, ...bizSeed("Maquillaje", 10, 3, 600) },
      { id: "b22", name: "Glo Makeup Studio Mty", category: "Maquillaje", address: "Monterrey", lat: 25.6730, lng: -100.3120, email: "glomakeup@cupo.mx", password: "1234", rating: 4.5, ...bizSeed("Maquillaje", 16, 3, 650) },
      { id: "b23", name: "Fernanda Montelongo Makeup Artist", category: "Maquillaje", address: "Monterrey", lat: 25.6650, lng: -100.3250, email: "fernandamtg@cupo.mx", password: "1234", rating: 4.8, ...bizSeed("Maquillaje", 11, 3, 700) },
      { id: "b24", name: "Artemis Vázquez Makeup Artist", category: "Maquillaje", address: "Monterrey", lat: 25.6600, lng: -100.3300, email: "artemisv@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Maquillaje", 9, 3, 680) },
      { id: "b25", name: "A'M Hair & Makeup Artist", category: "Maquillaje", address: "Monterrey", lat: 25.6780, lng: -100.3050, email: "amhair@cupo.mx", password: "1234", rating: 4.6, ...bizSeed("Maquillaje", 14, 3, 720) },

      // Estética facial
      { id: "b26", name: "Skinklinik Med Spa", category: "Estética facial", address: "Terranova 329, Col. Vista Hermosa, Monterrey", lat: 25.6725, lng: -100.3448, email: "skinklinik@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Estética facial", 10, 3, 900) },
      { id: "b27", name: "Nubody", category: "Estética facial", address: "Monterrey", lat: 25.6600, lng: -100.3600, email: "nubody@cupo.mx", password: "1234", rating: 4.6, ...bizSeed("Estética facial", 12, 3, 1100) },
      { id: "b28", name: "Dra. Gina González Beyou", category: "Estética facial", address: "Monterrey", lat: 25.6550, lng: -100.3550, email: "drginagonzalez@cupo.mx", password: "1234", rating: 4.8, ...bizSeed("Estética facial", 9, 3, 1200) },
      { id: "b29", name: "Dra. Sindy Sánchez", category: "Estética facial", address: "Plaza Mirador, Guadalupe", lat: 25.6773, lng: -100.2597, email: "drasindysanchez@cupo.mx", password: "1234", rating: 4.7, ...bizSeed("Estética facial", 13, 3, 1150) },
      { id: "b30", name: "JOSSCLAUDE & BeLLVeR", category: "Estética facial", address: "Monterrey", lat: 25.6700, lng: -100.3200, email: "jossclaude@cupo.mx", password: "1234", rating: 4.8, ...bizSeed("Estética facial", 15, 3, 850) },
    ];
  }

  const MTY_CENTER = { lat: 25.6714, lng: -100.3095 };

  function distanceKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function init() {
    if (!localStorage.getItem(KEYS.businesses)) {
      localStorage.setItem(KEYS.businesses, JSON.stringify(seedBusinesses()));
    }
    if (!localStorage.getItem(KEYS.clients)) {
      localStorage.setItem(KEYS.clients, JSON.stringify([]));
    }
  }

  function getBusinesses() {
    return JSON.parse(localStorage.getItem(KEYS.businesses) || "[]");
  }

  function saveBusinesses(list) {
    localStorage.setItem(KEYS.businesses, JSON.stringify(list));
  }

  function getClients() {
    return JSON.parse(localStorage.getItem(KEYS.clients) || "[]");
  }

  function saveClients(list) {
    localStorage.setItem(KEYS.clients, JSON.stringify(list));
  }

  function getSession() {
    return JSON.parse(localStorage.getItem(KEYS.session) || "null");
  }

  function setSession(session) {
    localStorage.setItem(KEYS.session, JSON.stringify(session));
  }

  function clearSession() {
    localStorage.removeItem(KEYS.session);
  }

  function findBusinessByEmail(email) {
    return getBusinesses().find((b) => b.email.toLowerCase() === email.toLowerCase());
  }

  function findClientByEmail(email) {
    return getClients().find((c) => c.email.toLowerCase() === email.toLowerCase());
  }

  function getClientById(id) {
    return getClients().find((c) => c.id === id) || null;
  }

  function getBusinessById(id) {
    return getBusinesses().find((b) => b.id === id) || null;
  }

  function login(role, email, password) {
    const record = role === "cliente" ? findClientByEmail(email) : findBusinessByEmail(email);
    if (!record || record.password !== password) {
      return { ok: false, error: "Correo o contraseña incorrectos." };
    }
    return { ok: true, id: record.id };
  }

  function registerClient({ firstName, lastName, email, password, countryCode, phone }) {
    const clients = getClients();
    if (clients.some((c) => c.email.toLowerCase() === email.toLowerCase())) {
      return { ok: false, error: "Ya existe una cuenta con ese correo." };
    }
    if (!/^\d{10}$/.test(phone)) {
      return { ok: false, error: "El teléfono debe tener 10 dígitos." };
    }
    const client = {
      id: "c" + Math.random().toString(36).slice(2, 9),
      firstName,
      lastName,
      name: firstName + " " + lastName,
      email,
      password,
      countryCode,
      phone,
      reservations: [],
    };
    clients.push(client);
    saveClients(clients);
    return { ok: true, client };
  }

  function registerBusiness({ name, category, address, email, password }) {
    const businesses = getBusinesses();
    if (businesses.some((b) => b.email.toLowerCase() === email.toLowerCase())) {
      return { ok: false, error: "Ya existe un negocio registrado con ese correo." };
    }
    const business = {
      id: "b" + Math.random().toString(36).slice(2, 9),
      name,
      category,
      address,
      lat: MTY_CENTER.lat,
      lng: MTY_CENTER.lng,
      email,
      password,
      rating: 5.0,
      slots: [],
      sales: [],
    };
    businesses.push(business);
    saveBusinesses(businesses);
    return { ok: true, business };
  }

  function bookSlot(businessId, slotId, client) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false, error: "Negocio no encontrado." };
    const slot = business.slots.find((s) => s.id === slotId);
    if (!slot || slot.status !== "available") {
      return { ok: false, error: "Ese cupo ya no está disponible." };
    }
    slot.status = "booked";
    slot.clientId = client.id;
    slot.clientName = client.name;
    if (!Array.isArray(business.sales)) business.sales = [];
    business.sales.push({
      id: "v" + Math.random().toString(36).slice(2, 9),
      date: Date.now(),
      service: slot.service || null,
      price: slot.price,
      clientName: client.name,
      slotId,
      status: "completada",
    });
    saveBusinesses(businesses);

    const clients = getClients();
    const c = clients.find((c) => c.id === client.id);
    if (c) {
      c.reservations.push({
        businessId,
        businessName: business.name,
        slotId,
        label: slot.label,
        price: slot.price,
      });
      saveClients(clients);
    }
    return { ok: true };
  }

  function addSlot(businessId, { hour, minute, duration, price, service }) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false };
    const h = parseInt(hour, 10);
    const m = parseInt(minute, 10) || 0;
    const displayH = h % 12 === 0 ? 12 : h % 12;
    const ampm = h >= 12 ? "PM" : "AM";
    const label = displayH + ":" + String(m).padStart(2, "0") + " " + ampm;
    business.slots.push({
      id: "s" + Math.random().toString(36).slice(2, 9),
      time: todayAt(h, m),
      label,
      duration: parseInt(duration, 10) || 45,
      price: parseInt(price, 10) || 0,
      service: service || null,
      status: "available",
      clientId: null,
      clientName: null,
    });
    business.slots.sort((a, b) => a.time - b.time);
    saveBusinesses(businesses);
    return { ok: true };
  }

  function reopenSlot(businessId, slotId) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false };
    const slot = business.slots.find((s) => s.id === slotId);
    if (!slot) return { ok: false };
    slot.status = "available";
    slot.clientId = null;
    slot.clientName = null;
    saveBusinesses(businesses);
    return { ok: true };
  }

  function removeSlot(businessId, slotId) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false };
    business.slots = business.slots.filter((s) => s.id !== slotId);
    saveBusinesses(businesses);
    return { ok: true };
  }

  function cancelReservation(clientId, businessId, slotId) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (business) {
      const slot = business.slots.find((s) => s.id === slotId);
      if (slot) {
        slot.status = "available";
        slot.clientId = null;
        slot.clientName = null;
      }
      const sale = (business.sales || [])
        .filter((v) => v.slotId === slotId && v.status === "completada")
        .sort((a, b) => b.date - a.date)[0];
      if (sale) sale.status = "cancelada";
      saveBusinesses(businesses);
    }

    const clients = getClients();
    const client = clients.find((c) => c.id === clientId);
    if (client) {
      client.reservations = client.reservations.filter((r) => r.slotId !== slotId);
      saveClients(clients);
    }
    return { ok: true };
  }

  function updateBusiness(businessId, { name, category, address }) {
    const businesses = getBusinesses();
    const business = businesses.find((b) => b.id === businessId);
    if (!business) return { ok: false };
    business.name = name;
    business.category = category;
    business.address = address;
    saveBusinesses(businesses);
    return { ok: true, business };
  }

  function getSales(businessId) {
    const business = getBusinessById(businessId);
    if (!business) return [];
    return (business.sales || []).slice().sort((a, b) => b.date - a.date);
  }

  return {
    AREAS,
    CATEGORIES,
    CATEGORY_VISUALS,
    SERVICES_BY_CATEGORY,
    COUNTRY_CODES,
    MTY_CENTER,
    distanceKm,
    init,
    getBusinesses,
    saveBusinesses,
    getClients,
    getSession,
    setSession,
    clearSession,
    findBusinessByEmail,
    findClientByEmail,
    getClientById,
    getBusinessById,
    login,
    registerClient,
    registerBusiness,
    bookSlot,
    addSlot,
    reopenSlot,
    removeSlot,
    cancelReservation,
    updateBusiness,
    getSales,
  };
})();

CupoStore.init();
