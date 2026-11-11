-- Macalin — tutoring marketplace for Djibouti (CEPE, BEF, Bac, université)
-- Tables are prefixed mac_ so the schema can share a Supabase project with other apps.

create table if not exists public.mac_profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text not null default '',
  role text not null default 'parent' check (role in ('parent','tutor')),
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.mac_is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.mac_profiles where id = auth.uid()), false);
$$;

create or replace function public.mac_profile_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not public.mac_is_admin() then
    if tg_op = 'INSERT' then new.is_admin := false; else new.is_admin := old.is_admin; end if;
  end if;
  return new;
end $$;
drop trigger if exists mac_profile_guard on public.mac_profiles;
create trigger mac_profile_guard before insert or update on public.mac_profiles
for each row execute function public.mac_profile_guard();

-- ---------- Tutors ----------
create table if not exists public.mac_tutors (
  id uuid primary key references public.mac_profiles(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  headline text not null default '' check (char_length(headline) <= 140),
  bio text not null default '' check (char_length(bio) <= 2000),
  subjects text[] not null default '{}',
  levels text[] not null default '{}',
  districts text[] not null default '{}',
  languages text[] not null default '{}',
  teach_mode text not null default 'home' check (teach_mode in ('home','online','both')),
  hourly_rate_djf int not null check (hourly_rate_djf between 500 and 50000),
  experience_years int not null default 0,
  whatsapp text not null default '',
  photo_url text not null default '',
  status text not null default 'pending' check (status in ('pending','active','suspended')),
  verified boolean not null default false,
  subscribed_until date,
  featured_until timestamptz,
  rating_avg numeric(2,1) not null default 0,
  rating_count int not null default 0,
  created_at timestamptz not null default now()
);

create or replace function public.mac_tutor_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('mac.bypass', true) = 'on' then return new; end if;
  if not public.mac_is_admin() then
    if tg_op = 'INSERT' then
      new.status := 'pending'; new.verified := false; new.subscribed_until := null;
      new.featured_until := null; new.rating_avg := 0; new.rating_count := 0;
    else
      new.status := old.status; new.verified := old.verified; new.subscribed_until := old.subscribed_until;
      new.featured_until := old.featured_until; new.rating_avg := old.rating_avg; new.rating_count := old.rating_count;
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'active' and old.status = 'pending' and new.subscribed_until is null then
    -- first approval: 30-day free trial
    new.subscribed_until := current_date + 30;
  end if;
  return new;
end $$;
drop trigger if exists mac_tutor_guard on public.mac_tutors;
create trigger mac_tutor_guard before insert or update on public.mac_tutors
for each row execute function public.mac_tutor_guard();

-- Public directory: approved tutors with a live subscription. Featured first.
create or replace view public.mac_directory with (security_invoker = true) as
  select t.*, (t.featured_until is not null and t.featured_until > now()) as featured_now
  from public.mac_tutors t
  where t.status = 'active' and t.subscribed_until >= current_date;

-- ---------- Lesson requests (parent -> tutor) ----------
create table if not exists public.mac_requests (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.mac_tutors(id) on delete cascade,
  parent_name text not null check (char_length(parent_name) between 2 and 80),
  phone text not null check (char_length(phone) between 6 and 20),
  student_level text not null,
  subject text not null,
  district text not null default '',
  message text not null default '' check (char_length(message) <= 1000),
  status text not null default 'new' check (status in ('new','contacted','started','declined')),
  created_at timestamptz not null default now()
);

-- ---------- Reviews (logged-in parents, one per tutor) ----------
create table if not exists public.mac_reviews (
  id uuid primary key default gen_random_uuid(),
  tutor_id uuid not null references public.mac_tutors(id) on delete cascade,
  author_id uuid not null references public.mac_profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text not null default '' check (char_length(comment) <= 600),
  created_at timestamptz not null default now(),
  unique (tutor_id, author_id)
);

create or replace function public.mac_refresh_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare tid uuid := coalesce(new.tutor_id, old.tutor_id);
begin
  perform set_config('mac.bypass', 'on', true);
  update public.mac_tutors t set
    rating_avg = coalesce((select round(avg(rating)::numeric, 1) from public.mac_reviews r where r.tutor_id = tid), 0),
    rating_count = (select count(*) from public.mac_reviews r where r.tutor_id = tid)
  where t.id = tid;
  perform set_config('mac.bypass', 'off', true);
  return null;
end $$;
drop trigger if exists mac_refresh_rating on public.mac_reviews;
create trigger mac_refresh_rating after insert or update or delete on public.mac_reviews
for each row execute function public.mac_refresh_rating();

-- ---------- Payments ----------
create table if not exists public.mac_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.mac_profiles(id) on delete cascade,
  product text not null check (product in ('sub_month','sub_quarter','featured_30d')),
  amount_djf int not null,
  method text not null check (method in ('dmoney','waafi','cac_pay','cash')),
  reference text not null check (char_length(reference) between 3 and 60),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  created_at timestamptz not null default now()
);

create or replace function public.mac_payment_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if not public.mac_is_admin() then new.status := 'pending'; new.user_id := auth.uid(); end if;
    new.amount_djf := case new.product when 'sub_month' then 3000 when 'sub_quarter' then 7500 when 'featured_30d' then 5000 end;
    return new;
  end if;
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if new.product in ('sub_month','sub_quarter') then
      update public.mac_tutors set subscribed_until =
        greatest(coalesce(subscribed_until, current_date), current_date) + case new.product when 'sub_month' then 30 else 90 end
        where id = new.user_id;
    elsif new.product = 'featured_30d' then
      update public.mac_tutors set featured_until = greatest(coalesce(featured_until, now()), now()) + interval '30 days'
        where id = new.user_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists mac_payment_guard on public.mac_payments;
create trigger mac_payment_guard before insert or update on public.mac_payments
for each row execute function public.mac_payment_guard();

-- ---------- RLS ----------
alter table public.mac_profiles enable row level security;
alter table public.mac_tutors enable row level security;
alter table public.mac_requests enable row level security;
alter table public.mac_reviews enable row level security;
alter table public.mac_payments enable row level security;

drop policy if exists mac_profiles_read on public.mac_profiles;
create policy mac_profiles_read on public.mac_profiles for select using (id = (select auth.uid()) or public.mac_is_admin());
drop policy if exists mac_profiles_insert on public.mac_profiles;
create policy mac_profiles_insert on public.mac_profiles for insert with check (id = (select auth.uid()));
drop policy if exists mac_profiles_update on public.mac_profiles;
create policy mac_profiles_update on public.mac_profiles for update using (id = (select auth.uid()) or public.mac_is_admin());

drop policy if exists mac_tutors_read on public.mac_tutors;
create policy mac_tutors_read on public.mac_tutors for select using (
  (status = 'active' and subscribed_until >= current_date) or id = (select auth.uid()) or public.mac_is_admin()
);
drop policy if exists mac_tutors_insert on public.mac_tutors;
create policy mac_tutors_insert on public.mac_tutors for insert with check (id = (select auth.uid()));
drop policy if exists mac_tutors_update on public.mac_tutors;
create policy mac_tutors_update on public.mac_tutors for update using (id = (select auth.uid()) or public.mac_is_admin());

drop policy if exists mac_requests_insert on public.mac_requests;
create policy mac_requests_insert on public.mac_requests for insert with check (
  status = 'new' and exists (select 1 from public.mac_tutors t where t.id = tutor_id and t.status = 'active' and t.subscribed_until >= current_date)
);
drop policy if exists mac_requests_read on public.mac_requests;
create policy mac_requests_read on public.mac_requests for select using (tutor_id = (select auth.uid()) or public.mac_is_admin());
drop policy if exists mac_requests_update on public.mac_requests;
create policy mac_requests_update on public.mac_requests for update using (tutor_id = (select auth.uid()) or public.mac_is_admin());

drop policy if exists mac_reviews_read on public.mac_reviews;
create policy mac_reviews_read on public.mac_reviews for select using (true);
drop policy if exists mac_reviews_insert on public.mac_reviews;
create policy mac_reviews_insert on public.mac_reviews for insert with check (author_id = (select auth.uid()) and author_id <> tutor_id);
drop policy if exists mac_reviews_delete on public.mac_reviews;
create policy mac_reviews_delete on public.mac_reviews for delete using (author_id = (select auth.uid()) or public.mac_is_admin());

drop policy if exists mac_payments_read on public.mac_payments;
create policy mac_payments_read on public.mac_payments for select using (user_id = (select auth.uid()) or public.mac_is_admin());
drop policy if exists mac_payments_insert on public.mac_payments;
create policy mac_payments_insert on public.mac_payments for insert with check ((select auth.uid()) is not null);
drop policy if exists mac_payments_update on public.mac_payments;
create policy mac_payments_update on public.mac_payments for update using (public.mac_is_admin());

grant select on public.mac_directory to anon, authenticated;

-- ---------- Storage for tutor photos ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('mac-photos', 'mac-photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists mac_photos_upload on storage.objects;
create policy mac_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'mac-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists mac_photos_update on storage.objects;
create policy mac_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'mac-photos' and (storage.foldername(name))[1] = (select auth.uid())::text);
