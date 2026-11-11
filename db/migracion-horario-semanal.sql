-- CUPO — migración "Horario semanal + calendario"
--
-- Para una base de Supabase que YA tenía corrido db/schema.sql de antes.
-- (Una instalación nueva no la necesita: db/schema.sql ya trae todo esto.)
--
-- Cómo usarla: Supabase → SQL Editor → New query → pega TODO este archivo →
-- Run. Es seguro volver a correrla: no borra ni cambia ningún dato existente.

-- ── Columnas nuevas ────────────────────────────────────────────────────────
alter table public.businesses
  add column if not exists schedule jsonb not null default '{}'::jsonb;

alter table public.staff
  add column if not exists services jsonb not null default '[]'::jsonb;

alter table public.slots
  add column if not exists schedule_key text,
  add column if not exists flexible boolean not null default false,
  add column if not exists walkin_name text;

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
  set status = 'booked', walkin_name = v_name
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
      walkin_name = null,
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
