-- Run in the Supabase SQL editor
-- Each province can have several professionals, so rows are keyed by id.
create table public.people (
  id uuid primary key default gen_random_uuid(),
  location_id text not null,      -- e.g. "province:Torino"
  location_name text,
  name text not null,
  summary text,                   -- shown as "Riepilogo" above the description
  description text,
  phone text,                     -- shown as "Indirizzo" (address)
  services text,                  -- shown as "Servizi", one per line
  socials text,                   -- shown as "Contatti", one per line
  photo_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index people_location_idx on public.people (location_id);

alter table public.people enable row level security;

-- Everyone can read. No insert/update/delete policies exist, so only the
-- Edge Function (service role) can write.
create policy "public read" on public.people for select using (true);

-- Public bucket for photos (reads are public, uploads only via the function)
insert into storage.buckets (id, name, public) values ('photos', 'photos', true)
on conflict (id) do nothing;

-- MIGRATION: if the old table (location_id as primary key) already exists,
-- run only this block instead of the create statements above.
-- alter table public.people drop constraint people_pkey;
-- alter table public.people add column id uuid not null default gen_random_uuid();
-- alter table public.people add primary key (id);
-- alter table public.people add column created_at timestamptz default now();
-- create index people_location_idx on public.people (location_id);

-- MIGRATION: add the "Servizi" column to an existing table
-- alter table public.people add column if not exists services text;

-- MIGRATION: add the "Riepilogo" column to an existing table
-- alter table public.people add column if not exists summary text;

-- Comments and reviews on professionals. Anyone can post one through the
-- Edge Function (rate limited there); the admin resolves or deletes them.
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete cascade,
  author text not null,
  rating smallint check (rating between 1 and 5),  -- optional star review
  body text not null,
  resolved boolean not null default false,
  created_at timestamptz default now()
);
create index reviews_person_idx on public.reviews (person_id);

alter table public.reviews enable row level security;
create policy "public read" on public.reviews for select using (true);
