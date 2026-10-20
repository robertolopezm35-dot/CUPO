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
  created_at timestamptz not null default now()
);

-- ── Personal / estilistas de un negocio (HU-17) ───────────────────────────
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses (id) on delete cascade,
  name text not null,
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
  created_at timestamptz not null default now()
);

create index slots_business_id_idx on public.slots (business_id);
create index slots_status_idx on public.slots (status);

-- ── Reservas: qué cliente ocupó qué cupo ──────────────────────────────────
create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null unique references public.slots (id) on delete cascade,
  client_id uuid not null references public.clients (id) on delete cascade,
  -- Folio de confirmación (HU-05), generado por book_slot() al reservar.
  folio text,
  created_at timestamptz not null default now()
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
  client_name text,
  folio text,
  status text not null default 'completada' check (status in ('completada', 'cancelada')),
  created_at timestamptz not null default now()
);

create index sales_business_id_idx on public.sales (business_id);
create index sales_slot_id_idx on public.sales (slot_id);
create index sales_client_id_idx on public.sales (client_id);

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
  on public.slots for delete using (auth.uid() = business_id);

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

create or replace function public.book_slot(p_slot_id uuid)
returns public.reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reservation public.reservations;
  v_client_name text;
  v_slot public.slots;
  v_folio text;
begin
  select first_name || ' ' || last_name into v_client_name
  from public.clients where id = auth.uid();

  if v_client_name is null then
    raise exception 'Solo un cliente puede reservar un cupo.';
  end if;

  v_folio := public.generate_folio();

  update public.slots
  set status = 'booked'
  where id = p_slot_id and status = 'available'
  returning * into v_slot;

  if not found then
    raise exception 'Ese cupo ya no está disponible.';
  end if;

  insert into public.reservations (slot_id, client_id, folio)
  values (p_slot_id, auth.uid(), v_folio)
  returning * into v_reservation;

  insert into public.sales (business_id, slot_id, service, price, client_name, client_id, folio, status)
  values (v_slot.business_id, v_slot.id, v_slot.service, v_slot.price, v_client_name, auth.uid(), v_folio, 'completada');

  return v_reservation;
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
begin
  select slot_id into v_slot_id
  from public.reservations
  where id = p_reservation_id and client_id = auth.uid();

  if v_slot_id is null then
    raise exception 'No se encontró esa reserva.';
  end if;

  delete from public.reservations where id = p_reservation_id;
  update public.slots set status = 'available' where id = v_slot_id;

  update public.sales set status = 'cancelada'
  where id = (
    select id from public.sales
    where slot_id = v_slot_id and status = 'completada'
    order by created_at desc limit 1
  );
end;
$$;

create or replace function public.reopen_slot(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.slots where id = p_slot_id and business_id = auth.uid()) then
    raise exception 'Ese cupo no es tuyo.';
  end if;

  delete from public.reservations where slot_id = p_slot_id;
  -- created_at se refresca para que cuente como "oportunidad nueva" en el
  -- aviso local de favoritos (HU-11) — ver get_new_favorite_slots.
  update public.slots set status = 'available', created_at = now() where id = p_slot_id;

  update public.sales set status = 'cancelada'
  where id = (
    select id from public.sales
    where slot_id = p_slot_id and status = 'completada'
    order by created_at desc limit 1
  );
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
    where business_id = p_business_id and client_id = auth.uid()
  );
$$;

create or replace function public.add_review(p_business_id uuid, p_rating int, p_comment text)
returns public.reviews
language plpgsql
security definer
set search_path = public
as $$
declare
  v_review public.reviews;
  v_client_name text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Selecciona una calificación de 1 a 5.';
  end if;

  if not public.has_reservation_at(p_business_id) then
    raise exception 'Solo quienes ya reservaron en este negocio pueden dejar una reseña.';
  end if;

  select first_name || ' ' || last_name into v_client_name
  from public.clients where id = auth.uid();

  insert into public.reviews (business_id, client_id, client_name, rating, comment)
  values (p_business_id, auth.uid(), coalesce(v_client_name, 'Cliente'), p_rating, trim(coalesce(p_comment, '')))
  on conflict (business_id, client_id)
  do update set rating = excluded.rating, comment = excluded.comment, created_at = now()
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
    and s.created_at > c.last_favorites_check;
$$;

-- Nota: no hay datos semilla aquí (los 30 negocios de Monterrey) porque
-- cada negocio necesita una fila real en auth.users, y eso solo se puede
-- crear a través de signUp(), no con un INSERT directo. Usa
-- SupabaseStore.seedDemoBusinesses() desde la consola del navegador una
-- vez que la app ya esté conectada (ver js/supabase-store.js).
