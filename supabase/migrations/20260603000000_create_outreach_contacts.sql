-- Companies we've emailed for outreach tracking and deduplication.

create type public.outreach_status as enum ('contacted', 'replied', 'closed');

create table public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  emailed_at timestamptz not null default now(),

  email text not null,
  email_normalized text not null,

  place_resource_name text,
  company_name text not null,
  phone text,
  website_url text,
  address text,
  email_source text,

  profession text,
  search_corridor text,
  radius_miles integer,

  email_subject text not null,
  email_body text not null,

  status public.outreach_status not null default 'contacted',
  notes text,

  constraint outreach_contacts_email_normalized_key unique (email_normalized)
);

create index outreach_contacts_emailed_at_idx
  on public.outreach_contacts (emailed_at desc);

create index outreach_contacts_company_name_idx
  on public.outreach_contacts (company_name);

create index outreach_contacts_status_idx
  on public.outreach_contacts (status);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger outreach_contacts_updated_at
  before update on public.outreach_contacts
  for each row
  execute function public.set_updated_at();

alter table public.outreach_contacts enable row level security;

comment on table public.outreach_contacts is
  'Outreach log for SiteSearch — one row per unique email contacted.';
