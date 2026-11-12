-- CUPO — migración "Horario semanal + calendario"
--
-- Para una base de Supabase que YA tenía corrido db/schema.sql de antes.
-- (Una instalación nueva no la necesita: db/schema.sql ya trae todo esto.)
--
-- Cómo usarla: Supabase → SQL Editor → New query → pega TODO este archivo →
-- Run. Es seguro volver a correrla: no borra ni cambia ningún dato existente.

-- ── Guarda: no correr esta migración si la base ya es más nueva ────────────
-- Esta migración (la más vieja) redefine funciones como book_slot/cancel_reservation. Si
-- tu base ya corrió db/migracion-ventas-agenda.sql, volver a correr ESTA revertiría esas
-- funciones (se perdería la hora de la cita, el teléfono y el límite de cancelación).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'sales' and column_name = 'attendance') then
    raise exception 'Esta migración ya fue superada: tu base ya tiene db/migracion-ventas-agenda.sql. No hace falta correrla otra vez (revertiría funciones). Para ponerla al día corre, en este orden, db/migracion-ventas-agenda.sql y db/migracion-endurecimiento.sql.';
  end if;
end $$;

-- ── Puesta al día de la ronda "Dashboard de Ventas" ────────────────────────
-- book_slot() (más abajo) guarda en cada venta el descuento y la persona. Si
-- tu base nunca corrió el SQL de esa ronda, estas 3 columnas no existen y NO
-- se podría reservar nada. Es seguro correrlo aunque ya existan.
alter table public.sales
  add column if not exists original_price numeric(10, 2),
  add column if not exists discount_pct int not null default 0,
  add column if not exists staff_name text;

-- ── Columnas nuevas ────────────────────────────────────────────────────────
alter table public.businesses
  add column if not exists schedule jsonb not null default '{}'::jsonb;

alter table public.staff
  add column if not exists services jsonb not null default '[]'::jsonb;

alter table public.slots
  add column if not exists schedule_key text,
  add column if not exists flexible boolean not null default false;

-- Quien agenda el negocio a mano (una llamada, alguien que llegó sin reservar)
-- no tiene cuenta: su nombre va en una reserva SIN cliente. Antes se guardaba
-- en slots.walkin_name, pero la tabla slots es pública (se navega sin sesión)
-- y cualquiera podía leer ese nombre; reservations solo la ve el negocio dueño.
alter table public.reservations alter column client_id drop not null;
alter table public.reservations add column if not exists walkin_name text;
alter table public.reservations drop constraint if exists reservations_who_check;
alter table public.reservations
  add constraint reservations_who_check check (client_id is not null or walkin_name is not null);

do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'slots' and column_name = 'walkin_name') then
    insert into public.reservations (slot_id, client_id, walkin_name, folio)
    select s.id, null, s.walkin_name,
           (select sa.folio from public.sales sa
            where sa.slot_id = s.id and sa.status = 'completada'
            order by sa.created_at desc limit 1)
    from public.slots s
    where s.walkin_name is not null and s.status = 'booked'
      and not exists (select 1 from public.reservations r where r.slot_id = s.id);
    alter table public.slots drop column walkin_name;
  end if;
end $$;

create unique index if not exists slots_business_schedule_key_idx
  on public.slots (business_id, schedule_key);

-- ── Funciones ──────────────────────────────────────────────────────────────
-- book_slot gana un parámetro (el servicio elegido); la versión vieja de un
-- solo parámetro se quita para que no queden dos con el mismo nombre.
drop function if exists public.book_slot(uuid);
-- Sobra desde que add_review acepta foto (quedó duplicada, no se usa).
drop function if exists public.add_review(uuid, int, text);

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

create or replace function public.book_slot(p_slot_id uuid, p_service text default null)
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
  v_staff_name text;
begin
  select first_name || ' ' || last_name into v_client_name
  from public.clients where id = auth.uid();

  if v_client_name is null then
    raise exception 'Solo un cliente puede reservar un cupo.';
  end if;

  v_folio := public.generate_folio();

  update public.slots
  set status = 'booked'
  where id = p_slot_id and status = 'available' and starts_at > now()
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

  insert into public.reservations (slot_id, client_id, folio)
  values (p_slot_id, auth.uid(), v_folio)
  returning * into v_reservation;

  insert into public.sales (business_id, slot_id, service, price, client_name, client_id, folio, status, original_price, discount_pct, staff_name)
  values (v_slot.business_id, v_slot.id, v_slot.service, v_slot.price, v_client_name, auth.uid(), v_folio, 'completada', v_slot.original_price, v_slot.discount_pct, v_staff_name);

  return v_reservation;
end;
$$;

create or replace function public.book_slot_manual(p_slot_id uuid, p_client_name text, p_service text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := trim(coalesce(p_client_name, ''));
  v_slot public.slots;
  v_folio text;
  v_staff_name text;
begin
  if v_name = '' then
    raise exception 'Escribe el nombre del cliente.';
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

  insert into public.sales (business_id, slot_id, service, price, client_name, client_id, folio, status, original_price, discount_pct, staff_name)
  values (v_slot.business_id, v_slot.id, v_slot.service, v_slot.price, v_name, null, v_folio, 'completada', v_slot.original_price, v_slot.discount_pct, v_staff_name);

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
begin
  select slot_id into v_slot_id
  from public.reservations
  where id = p_reservation_id and client_id = auth.uid();

  if v_slot_id is null then
    raise exception 'No se encontró esa reserva.';
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
