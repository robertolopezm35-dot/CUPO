-- CUPO — migración "Ventas por hora de la cita + asistencia + contacto"
--
-- Para una base de Supabase que YA tenía corrido db/schema.sql (y
-- db/migracion-horario-semanal.sql) de antes. Una instalación nueva no la
-- necesita: db/schema.sql ya trae todo esto.
--
-- Cómo usarla: Supabase → SQL Editor → New query → pega TODO este archivo →
-- Run. Es seguro volver a correrla: no borra ni cambia ningún dato existente
-- (solo rellena columnas nuevas con lo que ya se sabe).
--
-- Qué agrega:
--   · sales.starts_at / duration_minutes — la hora de la CITA (antes el
--     dashboard de Ventas usaba la hora en que se hizo la reserva).
--   · sales.attendance — 'pendiente' | 'asistio' | 'no_asistio' (lo marca el
--     negocio con set_attendance).
--   · sales.client_phone / client_country — para que el negocio pueda llamar o
--     escribir por WhatsApp a quien reservó (solo lo ve el negocio dueño).
--   · businesses.phone — el teléfono/WhatsApp del negocio (público, para que
--     el cliente lo contacte desde "Mis reservas").
--   · businesses.cancel_hours — hasta cuántas horas antes puede cancelar el
--     cliente sin costo (antes era solo un texto; ahora lo exige la base).

-- ── Columnas nuevas ────────────────────────────────────────────────────────
alter table public.sales
  add column if not exists starts_at timestamptz,
  add column if not exists duration_minutes int,
  add column if not exists attendance text not null default 'pendiente',
  add column if not exists client_phone text,
  add column if not exists client_country text;

alter table public.sales drop constraint if exists sales_attendance_check;
alter table public.sales
  add constraint sales_attendance_check check (attendance in ('pendiente', 'asistio', 'no_asistio'));

-- Ventas que ya existían: la hora de la cita es la de su cupo (si el cupo
-- sigue ahí); si no, lo más cercano que se sabe es cuándo se reservó.
update public.sales s
set starts_at = sl.starts_at,
    duration_minutes = sl.duration_minutes
from public.slots sl
where s.slot_id = sl.id and s.starts_at is null;

update public.sales set starts_at = created_at where starts_at is null;

create index if not exists sales_starts_at_idx on public.sales (business_id, starts_at);

alter table public.businesses
  add column if not exists phone text,
  add column if not exists cancel_hours int not null default 1;

alter table public.businesses drop constraint if exists businesses_phone_check;
alter table public.businesses
  add constraint businesses_phone_check check (phone is null or phone ~ '^\d{10}$');

alter table public.businesses drop constraint if exists businesses_cancel_hours_check;
alter table public.businesses
  add constraint businesses_cancel_hours_check check (cancel_hours between 0 and 72);

-- ── Funciones ──────────────────────────────────────────────────────────────
-- book_slot_manual gana un parámetro (el teléfono de quien llamó); la versión
-- vieja de 3 parámetros se quita para que no queden dos con el mismo nombre.
drop function if exists public.book_slot_manual(uuid, text, text);

create or replace function public.book_slot(p_slot_id uuid, p_service text default null)
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
begin
  select first_name || ' ' || last_name, phone, country_code
  into v_client_name, v_client_phone, v_client_country
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

  insert into public.sales (business_id, slot_id, service, price, client_name, client_id, folio, status,
                            original_price, discount_pct, staff_name,
                            starts_at, duration_minutes, client_phone, client_country)
  values (v_slot.business_id, v_slot.id, v_slot.service, v_slot.price, v_client_name, auth.uid(), v_folio, 'completada',
          v_slot.original_price, v_slot.discount_pct, v_staff_name,
          v_slot.starts_at, v_slot.duration_minutes, v_client_phone, v_client_country);

  return v_reservation;
end;
$$;

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

-- El cliente solo puede cancelar con la anticipación que el negocio define
-- (businesses.cancel_hours, 1 h por defecto). Pasado ese límite, el botón de
-- la app se oculta y aquí también se rechaza. El negocio, en cambio, siempre
-- puede cancelar desde su agenda (reopen_slot no tiene esta regla).
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

-- El negocio marca si el cliente llegó o no a su cita. Solo sobre sus propias
-- ventas (el RLS de sales solo deja leer, nunca escribir directo).
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
