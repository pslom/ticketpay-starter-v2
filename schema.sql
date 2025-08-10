-- Postgres schema for TicketPay

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists tickets (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  ticket_no text unique not null,
  balance_cents integer not null default 0,
  status text not null default 'open', -- open, paid, void
  due_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete cascade,
  processor text not null, -- mock, stripe, etc
  amount_cents integer not null,
  status text not null, -- succeeded, failed
  external_id text,
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references tickets(id) on delete set null,
  channel text not null, -- sms or email
  to_addr text not null,
  body text not null,
  status text not null,
  provider_id text,
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor text not null default 'system',
  action text not null,
  target_type text not null,
  target_id uuid,
  meta_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Trigger to update tickets.updated_at automatically
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_tickets_updated_at on tickets;
create trigger trg_tickets_updated_at
before update on tickets
for each row execute procedure set_updated_at();