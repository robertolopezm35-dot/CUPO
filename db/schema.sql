-- CUPO — esquema de Supabase (Postgres)
--
-- Cómo usarlo:
--   1. Crea un proyecto gratis en https://supabase.com
--   2. Ve a Authentication → Providers → Email y APAGA "Confirm email"
--      (si no, un registro nuevo no queda logueado de inmediato, como sí
--      pasa hoy con localStorage).
--   3. Ve a SQL Editor → New query, pega este archivo completo y dale Run.
--   4. Copia Project Settings → API → "Project URL" y "anon public" key
--      y pégalas en js/supabase-config.js.
--
-- Diseño: cada usuario (cliente o negocio) es una fila de auth.users de
-- Supabase (maneja el password de forma segura, cosa que localStorage no
-- hacía). Un trigger crea automáticamente su fila en clients o businesses
-- apenas se registra, usando los datos extra que manda el signUp.

-- ── Perfiles: qué rol tiene cada usuario autenticado ──────────────────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('cliente', 'negocio')),
  created_at timestamptz not null default now()
);

-- ── Clientes ───────────────────────────────────────────────────────────
create table public.clients (
  id uuid primary key references public.profiles (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  country_code text not null,
  phone text not null check (phone ~ '^\d{10}$'),
  -- Marca de tiempo del último "visto" de avisos de favoritos (HU-11):
  -- un cupo cuenta como "nuevo" si se publicó/reabrió después de esto.
  last_favorites_check timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- ── Negocios ───────────────────────────────────────────────────────────
create table public.businesses (
  id uuid primary key references public.profiles (id) on delete cascade,
  name text not null,
  category text not null,
  address text not null,
  lat double precision not null default 25.6714,
  lng double precision not null default -100.3095,
  rating numeric(2, 1) not null default 5.0,
  -- URLs de fotos subidas por el propio negocio (no se fabrican fotos de
  -- negocios reales — ver CLAUDE.md "Fotos de negocio"). Vacío por defecto.
  photos jsonb not null default '[]'::jsonb,
  -- Catálogo de servicios y precios que el negocio publica en su perfil
  -- (HU-02). Forma: [{ "name": "Corte clásico", "price": 180 }, ...].
  services_catalog jsonb not null default '[]'::jsonb,
  -- Horario semanal (ver js/schedule.js): los turnos que se repiten cada
  -- semana, los días cerrados y los cupos del horario quitados a mano.
  -- Forma: { "rules": [...], "closures": [...], "skips": [...] }.
  schedule jsonb not null default '{}'::jsonb,
  -- Teléfono/WhatsApp del negocio (10 dígitos, público): el cliente lo usa
  -- desde "Mis reservas" para avisar o preguntar algo.
  phone text check (phone is null or phone ~ '^\d{10}$'),
  -- Hasta cuántas horas antes de la cita puede cancelar el cliente sin costo.
  cancel_hours int not null default 1 check (cancel_hours between 0 and 72),
  created_at timestamptz not null default now()
);

-- ── Personal / estilistas de un negocio (HU-17) ───────────────────────────
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
  -- Servicios del catálogo que hace esta persona (por nombre). Vacío = todos.
  services jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index staff_business_id_idx on public.staff (business_id);

-- ── Cupos (horarios) que un negocio publica ───────────────────────────────
create table public.slots (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  starts_at timestamptz not null,
  duration_minutes int not null default 45,
  price numeric(10, 2) not null,
  -- Si el cupo se publicó con descuento (HU-16): precio original antes del
  -- descuento (null si no hubo descuento) y el % aplicado.
  original_price numeric(10, 2),
  discount_pct int not null default 0,
  staff_id uuid references public.staff (id) on delete set null,
  service text,
  status text not null default 'available' check (status in ('available', 'booked')),
  -- De qué turno/día/hora del horario semanal salió este cupo (null si se
  -- publicó a mano). Único por negocio: evita publicar dos veces el mismo.
  schedule_key text,
  -- Cupo flexible: no trae servicio fijo, el cliente lo elige al reservar
  -- entre los que hace la persona asignada (ver slot_service_price()).
  flexible boolean not null default false,
  created_at timestamptz not null default now()
);

create index slots_business_id_idx on public.slots (business_id);
create index slots_status_idx on public.slots (status);
create unique index slots_business_schedule_key_idx on public.slots (business_id, schedule_key);

-- ── Reservas: qué cliente ocupó qué cupo ──────────────────────────────────
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.slots (id) on delete cascade,
  -- null cuando lo agendó el propio negocio a mano (una llamada, alguien que
  -- llegó sin reservar): entonces el nombre va en walkin_name. Va aquí y no en
  -- slots porque slots es pública y reservations solo la ve el negocio dueño.
  client_id uuid references public.clients (id) on delete cascade,
  walkin_name text,
  -- Folio de confirmación (HU-05), generado por book_slot() al reservar.
  folio text,
  created_at timestamptz not null default now(),
  constraint reservations_who_check check (client_id is not null or walkin_name is not null)
);

create index reservations_client_id_idx on public.reservations (client_id);

-- ── Ventas: historial de cupos reservados, para el dashboard del negocio ──
-- No se borra cuando se cancela un cupo (a diferencia de reservations) —
-- se marca status = 'cancelada' para que el negocio pueda ver su historial
-- completo y sus tasas de cancelación, igual que en localStorage.
create table public.sales (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  slot_id uuid references public.slots (id) on delete set null,
  -- Quién hizo la compra: se usa para "¿este cliente ya reservó aquí?"
  -- (requisito para dejar reseña, HU-06) sin exponerle a nadie más las
  -- ventas ajenas — ver RPC has_reservation_at / get_my_sales.
  client_id uuid references public.clients (id) on delete set null,
  service text,
  price numeric(10, 2) not null,
  -- Copiados del cupo al momento de reservar (no se leen por join) para que
  -- el dashboard de Ventas pueda reportar "ventas con descuento" (HU-16) y
  -- "ventas por colaborador" (HU-17) aunque el cupo luego cambie o se borre.
  original_price numeric(10, 2),
  discount_pct int not null default 0,
  staff_name text,
  client_name text,
  folio text,
  -- La hora de la CITA (no la de la reserva): el dashboard de Ventas agrupa
  -- por cuándo se atiende, no por cuándo se reservó. created_at sigue siendo
  -- el momento en que se hizo la reserva.
  starts_at timestamptz,
  duration_minutes int,
  -- Lo marca el negocio: 'pendiente' (aún no se sabe), 'asistio' o 'no_asistio'.
  attendance text not null default 'pendiente' check (attendance in ('pendiente', 'asistio', 'no_asistio')),
  -- Teléfono de quien reservó (para que el negocio lo contacte). Esta tabla
  -- solo la ve el negocio dueño (y cada cliente sus propias filas).
  client_phone text,
  client_country text, -- código de marcación tal cual lo guarda clients.country_code (ej. +52)
  status text not null default 'completada' check (status in ('completada', 'cancelada')),
  created_at timestamptz not null default now()
);

create index sales_business_id_idx on public.sales (business_id);
create index sales_slot_id_idx on public.sales (slot_id);
create index sales_client_id_idx on public.sales (client_id);
create index sales_starts_at_idx on public.sales (business_id, starts_at);

-- ── Reseñas 1-5 estrellas (HU-06) ──────────────────────────────────────────
-- Un cliente solo puede tener una reseña por negocio (se actualiza si deja
-- otra). Solo se puede insertar/editar vía la función add_review() de abajo
-- — por eso no hay políticas de insert/update directas sobre esta tabla.
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  -- Guardado aparte (no se lee con un join a clients) porque la política
  -- RLS de clients solo deja a cada quien ver su propia fila: un join en
  -- tiempo de lectura mostraría "null" en la reseña de cualquier otro
  -- cliente. add_review() lo llena una vez, igual que sales.client_name.
  client_name text not null,
  rating int not null check (rating between 1 and 5),
  comment text not null default '',
  -- Foto opcional que el cliente sube al dejar su reseña (bucket "photos",
  -- carpeta reviews/<su-uid>/...) — ver "Fotos: Supabase Storage" abajo.
  photo_url text,
  created_at timestamptz not null default now(),
  unique (business_id, client_id)
);

create index reviews_business_id_idx on public.reviews (business_id);

-- ── Favoritos (HU-11) ──────────────────────────────────────────────────────
create table public.favorites (
  client_id uuid not null references public.clients (id) on delete cascade,
  business_id uuid not null references public.businesses (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, business_id)
);

-- ── Trigger: al registrarse un usuario, crear su perfil + fila específica ─
-- signUp() manda first_name/last_name/... (cliente) o name/category/...
-- (negocio) dentro de options.data, que Supabase guarda en
-- raw_user_meta_data. Este trigger lee esos datos y llena las tablas.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, new.raw_user_meta_data ->> 'role');

  if (new.raw_user_meta_data ->> 'role') = 'cliente' then
    insert into public.clients (id, first_name, last_name, country_code, phone)
    values (
      new.id,
      new.raw_user_meta_data ->> 'first_name',
      new.raw_user_meta_data ->> 'last_name',
      new.raw_user_meta_data ->> 'country_code',
      new.raw_user_meta_data ->> 'phone'
    );
  elsif (new.raw_user_meta_data ->> 'role') = 'negocio' then
    insert into public.businesses (id, name, category, address, lat, lng)
    values (
      new.id,
      new.raw_user_meta_data ->> 'name',
      new.raw_user_meta_data ->> 'category',
      new.raw_user_meta_data ->> 'address',
      coalesce((new.raw_user_meta_data ->> 'lat')::double precision, 25.6714),
      coalesce((new.raw_user_meta_data ->> 'lng')::double precision, -100.3095)
    );
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── Row Level Security ────────────────────────────────────────────────────
-- Sin esto, cualquiera con la anon key podría leer/editar todo. Las
-- políticas de abajo reproducen las reglas de negocio de la app.

alter table public.profiles enable row level security;
alter table public.clients enable row level security;
alter table public.businesses enable row level security;
alter table public.staff enable row level security;
alter table public.slots enable row level security;
alter table public.reservations enable row level security;
alter table public.sales enable row level security;
alter table public.reviews enable row level security;
alter table public.favorites enable row level security;

create policy "Cada quien ve su propio perfil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "El cliente ve y edita solo su propia fila"
  on public.clients for select using (auth.uid() = id);
create policy "El cliente edita solo su propia fila"
  on public.clients for update using (auth.uid() = id);
-- Políticas RLS múltiples se combinan con OR: esta añade que un negocio
-- también pueda ver el nombre de quien le reservó un cupo (si no, el join
-- de negocio.js a clients saldría null y se vería "Reservado" sin nombre).
create policy "El negocio ve el nombre de quien le reservó"
  on public.clients for select
  using (
    exists (
      select 1 from public.reservations r
      join public.slots s on s.id = r.slot_id
      where r.client_id = clients.id and s.business_id = auth.uid()
    )
  );

create policy "Los negocios son públicos (se navegan sin sesión)"
  on public.businesses for select using (true);
create policy "El negocio edita solo su propio perfil"
  on public.businesses for update using (auth.uid() = id);

create policy "El personal de un negocio es público (se navega sin sesión)"
  on public.staff for select using (true);
create policy "El negocio administra solo su propio personal"
  on public.staff for all
  using (auth.uid() = business_id)
  with check (auth.uid() = business_id);

create policy "Los cupos son públicos (se navegan sin sesión)"
  on public.slots for select using (true);
create policy "El negocio administra solo sus propios cupos"
  on public.slots for insert with check (auth.uid() = business_id);
create policy "El negocio borra solo sus propios cupos"
  on public.slots for delete using (auth.uid() = business_id and status = 'available');
create policy "El negocio edita solo sus propios cupos disponibles"
  on public.slots for update
  using (auth.uid() = business_id and status = 'available')
  with check (auth.uid() = business_id);

create policy "El cliente ve sus reservas, el negocio ve quién le reservó"
  on public.reservations for select
  using (
    auth.uid() = client_id
    or auth.uid() = (select business_id from public.slots where id = slot_id)
  );

create policy "El negocio ve solo sus propias ventas"
  on public.sales for select using (auth.uid() = business_id);

create policy "Las reseñas son públicas (se navegan sin sesión)"
  on public.reviews for select using (true);
-- Sin política de insert/update: solo se puede escribir a través de
-- add_review() (security definer), que valida que el cliente ya reservó
-- en ese negocio antes de dejar su reseña.

create policy "El cliente administra solo sus propios favoritos"
  on public.favorites for all
  using (auth.uid() = client_id)
  with check (auth.uid() = client_id);

-- ── Funciones RPC: operaciones que deben ser atómicas ─────────────────────
-- Reservar/cancelar involucra tocar dos tablas (slots + reservations) a la
-- vez; hacerlo como función evita que dos clientes reserven el mismo cupo
-- al mismo tiempo (algo que no importaba con localStorage de un solo
-- usuario, pero sí con varios usuarios reales conectados a la vez).

-- Folio corto de confirmación (HU-05), mismo formato que el modo
-- localStorage (store.js generateFolio): "CUPO-" + 6 caracteres.
create or replace function public.generate_folio()
returns text
language sql
as $$
  select 'CUPO-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
$$;

-- Servicio y precio con los que se reserva un cupo. Uno normal ya trae los
-- suyos; uno flexible (horario semanal) los toma del catálogo del negocio,
-- limitado a lo que hace la persona asignada, con el descuento del cupo.
create or replace function public.slot_service_price(p_slot_id uuid, p_service text)
returns table (service text, price numeric, original_price numeric)
language plpgsql
stable
set search_path = public
as $$
declare
  v_slot public.slots;
  v_allowed jsonb;
  v_count int;
  v_name text;
  v_base numeric;
begin
  select * into v_slot from public.slots where id = p_slot_id;
  if not found then
    raise exception 'Ese cupo ya no existe.';
  end if;

  if not v_slot.flexible then
    return query select v_slot.service, v_slot.price, v_slot.original_price;
    return;
  end if;

  if v_slot.staff_id is not null then
    select st.services into v_allowed from public.staff st where st.id = v_slot.staff_id;
  end if;

  with options as (
    select distinct on (c.elem ->> 'name')
      c.elem ->> 'name' as name,
      case when (c.elem ->> 'price') ~ '^\d+(\.\d+)?$' then trunc((c.elem ->> 'price')::numeric) else 0 end as base,
      c.ord
    from public.businesses b,
         jsonb_array_elements(b.services_catalog) with ordinality as c(elem, ord)
    where b.id = v_slot.business_id
      and coalesce(c.elem ->> 'name', '') <> ''
      and (v_allowed is null or jsonb_array_length(v_allowed) = 0 or v_allowed ? (c.elem ->> 'name'))
    order by c.elem ->> 'name', c.ord
  )
  select count(*) over (), o.name, o.base into v_count, v_name, v_base
  from options o
  where p_service is null or o.name = p_service
  order by o.ord
  limit 1;

  if v_name is null or (p_service is null and v_count <> 1) then
    raise exception 'Elige un servicio para reservar este cupo.';
  end if;

  if v_slot.discount_pct > 0 then
    return query select v_name, round((v_base * (100 - v_slot.discount_pct)) / 500.0) * 5, v_base;
  else
    return query select v_name, v_base, null::numeric;
  end if;
end;
$$;

create or replace function public.book_slot(p_slot_id uuid, p_service text default null, p_expected_price numeric default null)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.reservations;
  v_client_name text;
  v_client_phone text;
  v_client_country text;
  v_slot public.slots;
  v_folio text;
  v_staff_name text;
  v_active int;
  c_max_active constant int := 3;
begin
  select first_name || ' ' || last_name, phone, country_code
  into v_client_name, v_client_phone, v_client_country
  from public.clients where id = auth.uid();

  if v_client_name is null then
    raise exception 'Solo un cliente puede reservar un cupo.';
  end if;

  select * into v_slot from public.slots
  where id = p_slot_id and status = 'available' and starts_at > now()
  for update;

  if not found then
    raise exception 'Ese cupo ya no está disponible.';
  end if;

  select count(*) into v_active
  from public.reservations r join public.slots s on s.id = r.slot_id
  where r.client_id = auth.uid() and s.starts_at > now();
  if v_active >= c_max_active then
    raise exception 'Ya tienes % citas próximas. Cancela una o espera a que pase para reservar otra.', c_max_active;
  end if;

  if exists (
    select 1 from public.reservations r join public.slots s on s.id = r.slot_id
    where r.client_id = auth.uid()
      and s.starts_at < v_slot.starts_at + make_interval(mins => v_slot.duration_minutes)
      and s.starts_at + make_interval(mins => s.duration_minutes) > v_slot.starts_at
  ) then
    raise exception 'Ya tienes otra cita en ese horario.';
  end if;

  v_folio := public.generate_folio();

  update public.slots set status = 'booked' where id = p_slot_id;

  if v_slot.flexible then
    select r.service, r.price, r.original_price
    into v_slot.service, v_slot.price, v_slot.original_price
    from public.slot_service_price(p_slot_id, p_service) r;

    update public.slots
    set service = v_slot.service, price = v_slot.price, original_price = v_slot.original_price
    where id = p_slot_id;
  end if;

  if p_expected_price is not null and round(v_slot.price) <> round(p_expected_price) then
    raise exception 'El precio cambió a $%. Revisa y confirma de nuevo.', round(v_slot.price);
  end if;

  if v_slot.staff_id is not null then
    select name into v_staff_name from public.staff where id = v_slot.staff_id;
  end if;

  insert into public.reservations (slot_id, client_id, folio)
  values (p_slot_id, auth.uid(), v_folio)
  returning * into v_reservation;

  insert into public.sales (business_id, slot_id, service, price, client_name, client_id, folio, status,
                            original_price, discount_pct, staff_name,
                            starts_at, duration_minutes, client_phone, client_country)
  values (v_slot.business_id, v_slot.id, v_slot.service, v_slot.price, v_client_name, auth.uid(), v_folio, 'completada',
          v_slot.original_price, v_slot.discount_pct, v_staff_name,
          v_slot.starts_at, v_slot.duration_minutes, v_client_phone, v_client_country);

  return v_reservation;
end;
$$;

-- El negocio agenda él mismo a alguien que llamó o llegó sin reservar por
-- la app: ocupa el cupo a su nombre y cuenta como venta (sin client_id).
create or replace function public.book_slot_manual(p_slot_id uuid, p_client_name text, p_service text default null, p_phone text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_client_name, ''));
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '');
  v_slot public.slots;
  v_folio text;
  v_staff_name text;
begin
  if v_name = '' then
    raise exception 'Escribe el nombre del cliente.';
  end if;
  if char_length(v_name) > 60 then
    raise exception 'El nombre del cliente es demasiado largo (máximo 60 caracteres).';
  end if;
  if v_phone is not null and length(v_phone) = 12 and left(v_phone, 2) = '52' then
    v_phone := substr(v_phone, 3);
  elsif v_phone is not null and length(v_phone) = 13 and left(v_phone, 3) = '521' then
    v_phone := substr(v_phone, 4);
  end if;
  if v_phone is not null and v_phone !~ '^\d{10}$' then
    raise exception 'El teléfono debe tener 10 dígitos.';
  end if;

  update public.slots
  set status = 'booked'
  where id = p_slot_id and status = 'available' and business_id = auth.uid()
  returning * into v_slot;

  if not found then
    raise exception 'Ese cupo ya no está disponible.';
  end if;

  if v_slot.flexible then
    select r.service, r.price, r.original_price
    into v_slot.service, v_slot.price, v_slot.original_price
    from public.slot_service_price(p_slot_id, p_service) r;

    update public.slots
    set service = v_slot.service, price = v_slot.price, original_price = v_slot.original_price
    where id = p_slot_id;
  end if;

  if v_slot.staff_id is not null then
    select name into v_staff_name from public.staff where id = v_slot.staff_id;
  end if;

  v_folio := public.generate_folio();

  insert into public.reservations (slot_id, client_id, walkin_name, folio)
  values (p_slot_id, null, v_name, v_folio);

  insert into public.sales (business_id, slot_id, service, price, client_name, client_id, folio, status,
                            original_price, discount_pct, staff_name,
                            starts_at, duration_minutes, client_phone, client_country)
  values (v_slot.business_id, v_slot.id, v_slot.service, v_slot.price, v_name, null, v_folio, 'completada',
          v_slot.original_price, v_slot.discount_pct, v_staff_name,
          v_slot.starts_at, v_slot.duration_minutes, v_phone, case when v_phone is null then null else '+52' end);

  return v_folio;
end;
$$;

create or replace function public.cancel_reservation(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_id uuid;
  v_starts_at timestamptz;
  v_hours int;
begin
  select r.slot_id, s.starts_at, b.cancel_hours
  into v_slot_id, v_starts_at, v_hours
  from public.reservations r
  join public.slots s on s.id = r.slot_id
  join public.businesses b on b.id = s.business_id
  where r.id = p_reservation_id and r.client_id = auth.uid();

  if v_slot_id is null then
    raise exception 'No se encontró esa reserva.';
  end if;

  if now() > v_starts_at - make_interval(hours => v_hours) then
    raise exception 'Ya no se puede cancelar desde la app (faltan menos de % h para tu cita). Contacta al negocio.', v_hours;
  end if;

  delete from public.reservations where id = p_reservation_id;
  update public.slots
  set status = 'available',
      service = case when flexible then null else service end,
      original_price = case when flexible then null else original_price end
  where id = v_slot_id;

  update public.sales set status = 'cancelada'
  where id = (
    select id from public.sales
    where slot_id = v_slot_id and status = 'completada'
    order by created_at desc limit 1
  );
end;
$$;

create or replace function public.reopen_slot(p_slot_id uuid, p_expected_folio text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.slots where id = p_slot_id and business_id = auth.uid()) then
    raise exception 'Ese cupo no es tuyo.';
  end if;

  if p_expected_folio is not null
     and not exists (select 1 from public.reservations where slot_id = p_slot_id and folio = p_expected_folio) then
    raise exception 'Esa cita ya cambió: actualiza la pantalla para ver lo más reciente.';
  end if;

  delete from public.reservations where slot_id = p_slot_id;
  update public.slots
  set status = 'available',
      created_at = now(),
      service = case when flexible then null else service end,
      original_price = case when flexible then null else original_price end
  where id = p_slot_id;

  update public.sales set status = 'cancelada'
  where id = (
    select id from public.sales
    where slot_id = p_slot_id and status = 'completada'
    order by created_at desc limit 1
  );
end;
$$;

-- El negocio marca si el cliente llegó o no a su cita (solo sobre sus ventas).
create or replace function public.set_attendance(p_sale_id uuid, p_attendance text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_attendance not in ('pendiente', 'asistio', 'no_asistio') then
    raise exception 'Estado de asistencia inválido.';
  end if;

  update public.sales
  set attendance = p_attendance
  where id = p_sale_id and business_id = auth.uid() and status = 'completada';

  if not found then
    raise exception 'No se encontró esa cita.';
  end if;
end;
$$;

-- ── Reseñas (HU-06): solo quien ya reservó en el negocio puede dejar una ──
create or replace function public.has_reservation_at(p_business_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sales
    where business_id = p_business_id
      and client_id = auth.uid()
      and status = 'completada'
      and attendance <> 'no_asistio'
      and coalesce(starts_at, created_at) <= now()
  );
$$;

create or replace function public.add_review(p_business_id uuid, p_rating int, p_comment text, p_photo_url text default null)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
  v_client_name text;
  v_comment text := trim(coalesce(p_comment, ''));
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Selecciona una calificación de 1 a 5.';
  end if;

  if char_length(v_comment) > 1000 then
    raise exception 'La reseña es demasiado larga (máximo 1000 caracteres).';
  end if;

  if p_photo_url is not null and (char_length(p_photo_url) > 500 or p_photo_url !~* '^https?://\S+$') then
    raise exception 'La foto de la reseña no es válida.';
  end if;

  if not public.has_reservation_at(p_business_id) then
    raise exception 'Solo quienes ya fueron atendidos en este negocio pueden dejar una reseña.';
  end if;

  select first_name || ' ' || last_name into v_client_name
  from public.clients where id = auth.uid();

  insert into public.reviews (business_id, client_id, client_name, rating, comment, photo_url)
  values (p_business_id, auth.uid(), coalesce(v_client_name, 'Cliente'), p_rating, v_comment, p_photo_url)
  on conflict (business_id, client_id)
  do update set rating = excluded.rating, comment = excluded.comment, photo_url = excluded.photo_url, created_at = now()
  returning * into v_review;

  return v_review;
end;
$$;

-- Ventas del cliente que llama (nunca las de otro cliente): se usa para
-- saber en qué negocios puede dejar reseña, sin exponerle a nadie el
-- historial de ventas ajeno — ver "El negocio ve solo sus propias ventas".
create or replace function public.get_my_sales()
returns setof public.sales
language sql
security definer
set search_path = public
as $$
  select * from public.sales where client_id = auth.uid();
$$;

-- ── Favoritos (HU-11) ──────────────────────────────────────────────────────
create or replace function public.toggle_favorite(p_business_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_favorited boolean;
begin
  if exists (select 1 from public.favorites where client_id = auth.uid() and business_id = p_business_id) then
    delete from public.favorites where client_id = auth.uid() and business_id = p_business_id;
    v_favorited := false;
  else
    insert into public.favorites (client_id, business_id) values (auth.uid(), p_business_id);
    update public.clients set last_favorites_check = now() where id = auth.uid();
    v_favorited := true;
  end if;
  return v_favorited;
end;
$$;

create or replace function public.touch_favorites_check()
returns void
language sql
security definer
set search_path = public
as $$
  update public.clients set last_favorites_check = now() where id = auth.uid();
$$;

-- Aviso local (no es push real, ver HU-11): cupos disponibles en negocios
-- favoritos publicados o reabiertos desde la última vez que se revisó.
create or replace function public.get_new_favorite_slots()
returns table (business_id uuid, business_name text, slot_id uuid, starts_at timestamptz, service text)
language sql
security definer
set search_path = public
as $$
  select b.id, b.name, s.id, s.starts_at, s.service
  from public.favorites f
  join public.businesses b on b.id = f.business_id
  join public.slots s on s.business_id = b.id
  join public.clients c on c.id = auth.uid()
  where f.client_id = auth.uid()
    and s.status = 'available'
    and s.starts_at > now()
    and s.created_at > c.last_favorites_check;
$$;

-- Nota: no hay datos semilla aquí (los 30 negocios de Monterrey) porque
-- cada negocio necesita una fila real en auth.users, y eso solo se puede
-- crear a través de signUp(), no con un INSERT directo. Usa
-- SupabaseStore.seedDemoBusinesses() desde la consola del navegador una
-- vez que la app ya esté conectada (ver js/supabase-store.js).

-- ── Fotos: Supabase Storage ────────────────────────────────────────────────
-- Un solo bucket público para las dos cosas que suben archivo: fotos de
-- perfil del negocio (antes solo se podía pegar una URL externa) y la foto
-- opcional que un cliente agrega a su reseña. Público = cualquiera puede
-- ver la imagen por su URL sin loguearse (igual que una URL pegada a mano),
-- pero solo el dueño autenticado de cada carpeta puede subir ahí — ver
-- DataStore.uploadPhoto() en supabase-store.js.
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

create policy "Negocios suben fotos solo a su propia carpeta"
on storage.objects for insert
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = 'business'
  and (storage.foldername(name))[2] = auth.uid()::text
);

create policy "Clientes suben fotos de reseña solo a su propia carpeta"
on storage.objects for insert
with check (
  bucket_id = 'photos'
  and (storage.foldername(name))[1] = 'review'
  and (storage.foldername(name))[2] = auth.uid()::text
);

-- El bucket ya es público (las URLs funcionan sin esta política), pero se
-- deja explícita por si alguna vez se cambia a privado.
create policy "Cualquiera puede ver las fotos del bucket"
on storage.objects for select
using (bucket_id = 'photos');

-- ════════════════════════════════════════════════════════════════════════
-- Endurecimiento (ronda de cacería de bugs, 11 nov 2026): validaciones, rangos,
-- triggers y límites del bucket. Ver db/migracion-endurecimiento.sql.
-- ════════════════════════════════════════════════════════════════════════
-- ── 0. Textos con tope y nombres no vacíos ────────────────────────────────
alter table public.reviews drop constraint if exists reviews_comment_len;
alter table public.reviews
  add constraint reviews_comment_len check (char_length(comment) <= 1000) not valid;

alter table public.clients drop constraint if exists clients_names_check;
alter table public.clients
  add constraint clients_names_check check (
    btrim(first_name) <> '' and btrim(last_name) <> ''
    and char_length(first_name) <= 60 and char_length(last_name) <= 60
  ) not valid;

-- ── 1. Rangos válidos en los cupos ─────────────────────────────────────────
alter table public.slots drop constraint if exists slots_price_range;
alter table public.slots
  add constraint slots_price_range check (price >= 0 and price <= 100000) not valid;
alter table public.slots drop constraint if exists slots_duration_range;
alter table public.slots
  add constraint slots_duration_range check (duration_minutes between 5 and 600) not valid;
alter table public.slots drop constraint if exists slots_discount_range;
alter table public.slots
  add constraint slots_discount_range check (discount_pct between 0 and 100) not valid;

create index if not exists slots_business_starts_idx on public.slots (business_id, starts_at);

-- Un negocio no puede asignar a un cupo a alguien de OTRO negocio.
create or replace function public.validate_slot()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.staff_id is not null
     and not exists (select 1 from public.staff where id = new.staff_id and business_id = new.business_id) then
    raise exception 'Esa persona no pertenece a este negocio.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_slot_trg on public.slots;
create trigger validate_slot_trg
  before insert or update on public.slots
  for each row execute function public.validate_slot();

-- ── 2. Un negocio no puede guardar "basura" en su perfil ───────────────────
create or replace function public.validate_business()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  e jsonb;
  v_price numeric;
begin
  if char_length(new.name) > 80 then
    raise exception 'El nombre del negocio es demasiado largo (máximo 80 caracteres).';
  end if;
  if char_length(new.address) > 200 then
    raise exception 'La dirección es demasiado larga (máximo 200 caracteres).';
  end if;

  if jsonb_typeof(new.photos) is distinct from 'array' or jsonb_array_length(new.photos) > 20 then
    raise exception 'Las fotos deben ser una lista de hasta 20 direcciones.';
  end if;
  for e in select * from jsonb_array_elements(new.photos) loop
    if jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > 500 or (e #>> '{}') !~* '^https?://\S+$' then
      raise exception 'Cada foto debe ser una dirección web (http o https).';
    end if;
  end loop;

  if jsonb_typeof(new.services_catalog) is distinct from 'array' or jsonb_array_length(new.services_catalog) > 60 then
    raise exception 'El catálogo debe ser una lista de hasta 60 servicios.';
  end if;
  for e in select * from jsonb_array_elements(new.services_catalog) loop
    if jsonb_typeof(e) <> 'object'
       or jsonb_typeof(e -> 'name') is distinct from 'string'
       or char_length(e ->> 'name') not between 1 and 80
       or jsonb_typeof(e -> 'price') is distinct from 'number' then
      raise exception 'Cada servicio necesita un nombre (hasta 80 caracteres) y un precio numérico.';
    end if;
    v_price := (e ->> 'price')::numeric;
    if v_price < 0 or v_price > 100000 then
      raise exception 'El precio de un servicio debe estar entre 0 y 100,000.';
    end if;
  end loop;

  if jsonb_typeof(new.schedule) is distinct from 'object' or pg_column_size(new.schedule) > 262144 then
    raise exception 'El horario es inválido o demasiado grande.';
  end if;

  -- La calificación inicial no se edita a mano: solo la mueven las reseñas.
  if tg_op = 'UPDATE' and auth.uid() is not null then
    new.rating := old.rating;
  end if;
  return new;
end;
$$;

drop trigger if exists validate_business_trg on public.businesses;
create trigger validate_business_trg
  before insert or update on public.businesses
  for each row execute function public.validate_business();

-- ── 5. Fotos: solo imágenes, hasta 5 MB (el servidor ya no depende del JS del navegador) ─
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    update storage.buckets
    set file_size_limit = 5242880,
        allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
    where id = 'photos';
  end if;
end $$;
