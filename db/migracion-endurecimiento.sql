-- CUPO — migración "Endurecimiento" (ronda de cacería de bugs, 11 nov 2026)
--
-- Para una base de Supabase que YA corrió db/schema.sql + db/migracion-horario-semanal.sql
-- + db/migracion-ventas-agenda.sql. Una instalación nueva no la necesita: db/schema.sql
-- ya trae todo esto. Idempotente: se puede volver a correr; no borra datos.
--
-- Qué arregla (todo salió de bots que probaron la plataforma):
--   · Un negocio ya no puede guardar "basura" en su perfil: fotos y catálogo deben ser
--     listas con la forma correcta (antes un valor de otro tipo rompía la lista de negocios
--     para TODOS y un precio con HTML ejecutaba código en el navegador de los visitantes),
--     textos con tope de tamaño, y su calificación ya no se puede editar a mano.
--   · Los cupos validan precio, duración, descuento y que la persona asignada sea del
--     mismo negocio. Un negocio ya no puede borrar un cupo reservado (la cita del cliente
--     desaparecía sin aviso).
--   · Solo puede reseñar quien ya fue atendido (antes bastaba reservar y cancelar).
--   · Tope de 3 citas próximas por cliente y no se permiten citas encimadas.
--   · book_slot recibe el precio que el cliente vio y rechaza si cambió; reopen_slot recibe
--     el folio de la cita que el negocio veía y rechaza si ya es otra (el negocio podía
--     cancelar la cita de OTRA persona con una pantalla vieja).
--   · El aviso de favoritos ya no cuenta cupos pasados; teléfonos con +52 se normalizan.
--   · El bucket de fotos solo acepta imágenes de hasta 5 MB.

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

-- ── 3. Un negocio ya no puede borrar un cupo reservado ─────────────────────
drop policy if exists "El negocio borra solo sus propios cupos" on public.slots;
create policy "El negocio borra solo sus propios cupos"
  on public.slots for delete using (auth.uid() = business_id and status = 'available');

-- ── 4. Funciones ───────────────────────────────────────────────────────────
-- Las firmas cambian (parámetros nuevos con valor por defecto): se quitan las viejas
-- para que no queden dos con el mismo nombre.
drop function if exists public.book_slot(uuid, text);
drop function if exists public.reopen_slot(uuid);

-- Solo reseña quien ya fue atendido: una venta completada, cuya cita ya pasó y a la que
-- el negocio no marcó "No llegó".
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

-- El aviso de "cupos nuevos en tus favoritos" ya no cuenta cupos que ya pasaron.
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

-- book_slot: tope de citas próximas por cliente, sin citas encimadas y con el precio que
-- el cliente vio (p_expected_price): si el negocio lo cambió mientras decidía, se rechaza
-- y se le pide confirmar de nuevo.
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

-- book_slot_manual: el teléfono se normaliza (quita "+52"/"52" al inicio si pegaron el
-- número completo).
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

-- reopen_slot: el negocio manda el folio de la cita que veía en pantalla. Si esa cita ya
-- no está (la cancelaron, o otra persona reservó ese cupo), se rechaza en vez de cancelar
-- la cita equivocada.
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
