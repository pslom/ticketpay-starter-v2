-- Seed customers
insert into customers(name,email,phone) values ('Alex Johnson','alex@example.com','+12025550101');
insert into customers(name,email,phone) values ('Brianna Lee','brianna@example.com','+12025550102');
insert into customers(name,email,phone) values ('Carlos Ruiz','carlos@example.com','+12025550103');
insert into customers(name,email,phone) values ('Dana Patel','dana@example.com','+12025550104');
insert into customers(name,email,phone) values ('Evan Smith','evan@example.com','+12025550105');

-- Seed tickets
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1001',5000,'open','2025-09-03'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1002',12500,'open','2025-07-27'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1003',2500,'open','2025-08-01'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1004',10000,'paid','2025-07-27'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1005',2500,'open','2025-08-16'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1006',5000,'open','2025-09-08'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1007',12500,'paid','2025-08-01'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1008',12500,'open','2025-09-08'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1009',10000,'open','2025-08-24'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1010',7500,'open','2025-08-15'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1011',5000,'open','2025-09-07'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1012',10000,'open','2025-07-26'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1013',5000,'open','2025-08-01'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1014',7500,'open','2025-09-05'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1015',10000,'open','2025-08-24'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1016',12500,'paid','2025-08-23'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1017',2500,'open','2025-08-26'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1018',7500,'open','2025-08-03'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1019',5000,'open','2025-08-11'::date from customers order by random() limit 1;
insert into tickets(customer_id,ticket_no,balance_cents,status,due_at)
select id,'TKT-1020',7500,'open','2025-08-19'::date from customers order by random() limit 1;

-- If a ticket is paid, insert a payment row

insert into payments(ticket_id, processor, amount_cents, status, external_id)
select t.id, 'mock', t.balance_cents, 'succeeded', 'seed-payment-'||t.ticket_no
from tickets t
where t.status = 'paid';
