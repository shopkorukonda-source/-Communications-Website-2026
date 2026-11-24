-- SLV Shop Manager V2 data retention and permanent monthly summaries
-- Applied to Supabase project fvjtbefsuzhrjimpmdop on 2026-11-24.
create extension if not exists pg_cron;

create table if not exists public.monthly_financial_summaries (
  month_start date primary key,
  month_label text not null,
  income_total numeric(14,2) not null default 0,
  expense_total numeric(14,2) not null default 0,
  net_profit numeric(14,2) not null default 0,
  bill_count bigint not null default 0,
  customer_collections numeric(14,2) not null default 0,
  processing_cost numeric(14,2) not null default 0,
  archived_at timestamptz not null default now()
);
create table if not exists public.monthly_employee_attendance_summaries (
  employee_id uuid not null references public.employees(id) on delete restrict,
  month_start date not null,
  month_label text not null,
  employee_name text not null,
  employee_code text,
  present_days integer not null default 0,
  absent_days integer not null default 0,
  absent_dates date[] not null default '{}',
  archived_at timestamptz not null default now(),
  primary key (employee_id, month_start)
);
create table if not exists public.retention_run_log (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  deleted_billing_transactions bigint not null default 0,
  deleted_attendance_rows bigint not null default 0,
  deleted_expense_rows bigint not null default 0,
  status text not null default 'completed',
  details jsonb not null default '{}'::jsonb
);
alter table public.monthly_financial_summaries enable row level security;
alter table public.monthly_employee_attendance_summaries enable row level security;
alter table public.retention_run_log enable row level security;
drop policy if exists monthly_financial_summaries_admin_read on public.monthly_financial_summaries;
create policy monthly_financial_summaries_admin_read on public.monthly_financial_summaries for select to authenticated using (private.is_admin());
drop policy if exists monthly_attendance_summaries_admin_read on public.monthly_employee_attendance_summaries;
create policy monthly_attendance_summaries_admin_read on public.monthly_employee_attendance_summaries for select to authenticated using (private.is_admin());
drop policy if exists retention_run_log_admin_read on public.retention_run_log;
create policy retention_run_log_admin_read on public.retention_run_log for select to authenticated using (private.is_admin());
grant select on public.monthly_financial_summaries, public.monthly_employee_attendance_summaries, public.retention_run_log to authenticated;

alter table public.wallet_ledger drop constraint if exists wallet_ledger_transaction_id_fkey;
alter table public.wallet_ledger add constraint wallet_ledger_transaction_id_fkey
  foreign key (transaction_id) references public.billing_transactions(id) on delete set null;

create or replace function private.run_slv_data_retention()
returns jsonb language plpgsql set search_path = ''
as $function$
declare
  v_deleted_bills bigint := 0;
  v_deleted_attendance bigint := 0;
  v_deleted_expenses bigint := 0;
  v_deleted_leaves bigint := 0;
  v_deleted_drawer_sessions bigint := 0;
  v_deleted_payroll bigint := 0;
  v_deleted_incentives bigint := 0;
  v_deleted_settlements bigint := 0;
  v_deleted_announcements bigint := 0;
  v_absent_marked bigint := 0;
  v_run_id bigint;
  v_work_date date := (timezone('Asia/Kolkata', now())::date - 1);
  v_weekly_off jsonb := '[0]'::jsonb;
begin
  select coalesce(attendance_payroll_policy->'weekly_off_days','[0]'::jsonb)
    into v_weekly_off from public.shop_settings where id=true;

  insert into public.attendance(employee_id,work_date,status,notes)
  select e.id,v_work_date,'absent','Auto-marked: no shift check-in recorded'
  from public.employees e
  where e.is_active=true
    and coalesce(e.joined_on,e.created_at::date)<=v_work_date
    and not exists(select 1 from public.attendance a where a.employee_id=e.id and a.work_date=v_work_date)
    and not exists(select 1 from public.leave_requests l where l.employee_id=e.id and l.status='approved' and v_work_date between l.start_date and l.end_date)
    and not exists(select 1 from jsonb_array_elements_text(coalesce(v_weekly_off,'[0]'::jsonb)) d where d.value::integer=extract(dow from v_work_date)::integer);
  get diagnostics v_absent_marked=row_count;

  with months as (
    select date_trunc('month',t.created_at)::date as month_start from public.billing_transactions t
    where t.status='completed' and t.created_at<date_trunc('month',now()) group by 1
    union
    select date_trunc('month',e.expense_date)::date from public.expenses e
    where e.expense_date<date_trunc('month',current_date)::date group by 1
  ),
  bill_totals as (
    select date_trunc('month',t.created_at)::date as month_start,
      coalesce(sum(t.profit_total),0)::numeric(14,2) as income_total,
      count(*)::bigint as bill_count,
      coalesce(sum(t.customer_total),0)::numeric(14,2) as customer_collections,
      coalesce(sum(t.processing_total),0)::numeric(14,2) as processing_cost
    from public.billing_transactions t where t.status='completed' and t.created_at<date_trunc('month',now()) group by 1
  ),
  expense_totals as (
    select date_trunc('month',e.expense_date)::date as month_start,
      coalesce(sum(e.amount),0)::numeric(14,2) as expense_total
    from public.expenses e where e.expense_date<date_trunc('month',current_date)::date group by 1
  )
  insert into public.monthly_financial_summaries
    (month_start,month_label,income_total,expense_total,net_profit,bill_count,customer_collections,processing_cost,archived_at)
  select m.month_start,to_char(m.month_start,'FMMonth')||' '||to_char(m.month_start,'YYYY'),
    coalesce(b.income_total,0),coalesce(x.expense_total,0),coalesce(b.income_total,0)-coalesce(x.expense_total,0),
    coalesce(b.bill_count,0),coalesce(b.customer_collections,0),coalesce(b.processing_cost,0),now()
  from months m left join bill_totals b using(month_start) left join expense_totals x using(month_start)
  on conflict(month_start) do update set
    month_label=excluded.month_label,
    income_total=case when exists(select 1 from public.billing_transactions t where date_trunc('month',t.created_at)::date=excluded.month_start and t.status='completed') then excluded.income_total else public.monthly_financial_summaries.income_total end,
    bill_count=case when exists(select 1 from public.billing_transactions t where date_trunc('month',t.created_at)::date=excluded.month_start and t.status='completed') then excluded.bill_count else public.monthly_financial_summaries.bill_count end,
    customer_collections=case when exists(select 1 from public.billing_transactions t where date_trunc('month',t.created_at)::date=excluded.month_start and t.status='completed') then excluded.customer_collections else public.monthly_financial_summaries.customer_collections end,
    processing_cost=case when exists(select 1 from public.billing_transactions t where date_trunc('month',t.created_at)::date=excluded.month_start and t.status='completed') then excluded.processing_cost else public.monthly_financial_summaries.processing_cost end,
    expense_total=case when exists(select 1 from public.expenses e where date_trunc('month',e.expense_date)::date=excluded.month_start) then excluded.expense_total else public.monthly_financial_summaries.expense_total end,
    net_profit=(case when exists(select 1 from public.billing_transactions t where date_trunc('month',t.created_at)::date=excluded.month_start and t.status='completed') then excluded.income_total else public.monthly_financial_summaries.income_total end)
      -(case when exists(select 1 from public.expenses e where date_trunc('month',e.expense_date)::date=excluded.month_start) then excluded.expense_total else public.monthly_financial_summaries.expense_total end),
    archived_at=now();

  insert into public.monthly_employee_attendance_summaries
    (employee_id,month_start,month_label,employee_name,employee_code,present_days,absent_days,absent_dates,archived_at)
  select a.employee_id,date_trunc('month',a.work_date)::date,
    to_char(date_trunc('month',a.work_date)::date,'FMMonth')||' '||to_char(date_trunc('month',a.work_date)::date,'YYYY'),
    coalesce(e.full_name,'Employee'),e.employee_code,
    count(*) filter(where lower(coalesce(a.status,''))='present')::integer,
    count(*) filter(where lower(coalesce(a.status,''))='absent')::integer,
    coalesce(array_agg(a.work_date order by a.work_date) filter(where lower(coalesce(a.status,''))='absent'),'{}'::date[]),
    now()
  from public.attendance a join public.employees e on e.id=a.employee_id
  where a.work_date<date_trunc('month',current_date)::date
  group by a.employee_id,date_trunc('month',a.work_date)::date,e.full_name,e.employee_code
  on conflict(employee_id,month_start) do update set
    month_label=excluded.month_label,employee_name=excluded.employee_name,employee_code=excluded.employee_code,
    present_days=excluded.present_days,absent_days=excluded.absent_days,absent_dates=excluded.absent_dates,archived_at=now();

  update public.wallet_ledger wl set transaction_id=null
  where wl.transaction_id in(select t.id from public.billing_transactions t where t.created_at<now()-interval '4 months');
  delete from public.billing_edit_requests r using public.billing_transactions t
    where r.transaction_id=t.id and t.created_at<now()-interval '4 months';
  delete from public.billing_audit_log a using public.billing_transactions t
    where a.transaction_id=t.id and t.created_at<now()-interval '4 months';
  delete from public.billing_transactions where created_at<now()-interval '4 months';
  get diagnostics v_deleted_bills=row_count;

  delete from public.attendance where work_date<current_date-interval '1 year';
  get diagnostics v_deleted_attendance=row_count;
  delete from public.expenses where expense_date<current_date-interval '1 year';
  get diagnostics v_deleted_expenses=row_count;

  -- Other operational history is retained for one year; master/configuration data is untouched.
  delete from public.leave_requests where end_date<current_date-interval '1 year';
  get diagnostics v_deleted_leaves=row_count;
  delete from public.drawer_sessions where status='closed' and closed_at<now()-interval '1 year';
  get diagnostics v_deleted_drawer_sessions=row_count;
  delete from public.payroll_entries where pay_month<date_trunc('month',current_date-interval '1 year')::date;
  get diagnostics v_deleted_payroll=row_count;
  delete from public.employee_incentives where incentive_date<current_date-interval '1 year';
  get diagnostics v_deleted_incentives=row_count;
  delete from public.night_settlements where settlement_date<current_date-interval '1 year';
  get diagnostics v_deleted_settlements=row_count;
  delete from public.shop_announcements
    where created_at<now()-interval '1 year' and (expires_on is null or expires_on<current_date);
  get diagnostics v_deleted_announcements=row_count;

  insert into public.retention_run_log(deleted_billing_transactions,deleted_attendance_rows,deleted_expense_rows,status,details)
  values(v_deleted_bills,v_deleted_attendance,v_deleted_expenses,'completed',
    jsonb_build_object('billing_retention_months',4,'attendance_retention_years',1,'expense_retention_years',1,
      'leave_requests_retention_years',1,'drawer_sessions_retention_years',1,'payroll_retention_years',1,
      'incentives_retention_years',1,'night_settlements_retention_years',1,'announcements_retention_years',1,
      'auto_absent_marked',v_absent_marked,'deleted_leave_requests',v_deleted_leaves,
      'deleted_drawer_sessions',v_deleted_drawer_sessions,'deleted_payroll_entries',v_deleted_payroll,
      'deleted_employee_incentives',v_deleted_incentives,'deleted_night_settlements',v_deleted_settlements,
      'deleted_announcements',v_deleted_announcements))
  returning id into v_run_id;
  return jsonb_build_object('run_id',v_run_id,'auto_absent_marked',v_absent_marked,
    'deleted_billing_transactions',v_deleted_bills,'deleted_attendance_rows',v_deleted_attendance,
    'deleted_expense_rows',v_deleted_expenses);
end
$function$;
revoke all on function private.run_slv_data_retention() from public,anon,authenticated;

do $$
declare r record;
begin
  for r in select jobid from cron.job where jobname='slv-data-retention-daily' loop
    perform cron.unschedule(r.jobid);
  end loop;
  perform cron.schedule('slv-data-retention-daily','0 21 * * *','select private.run_slv_data_retention();');
end $$;
