-- SLV employee shift auto-close: 9:00 PM Asia/Kolkata.
-- The Supabase migration has already been applied to project fvjtbefsuzhrjimpmdop.
-- pg_cron runs on UTC by default; 15:30 UTC is 21:00 IST.
alter table public.drawer_sessions
  add column if not exists close_reason text not null default 'manual';

alter table public.drawer_sessions
  drop constraint if exists drawer_sessions_close_reason_check;
alter table public.drawer_sessions
  add constraint drawer_sessions_close_reason_check
  check (close_reason in ('manual','auto_9pm'));

create or replace function private.auto_close_employee_shifts_9pm()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session record;
  v_profile uuid;
  v_sales numeric(14,2);
  v_expenses numeric(14,2);
  v_expected numeric(14,2);
  v_closed integer := 0;
  v_now timestamptz := now();
  v_work_date date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if (v_now at time zone 'Asia/Kolkata')::time < time '21:00' then
    return 0;
  end if;

  for v_session in
    select ds.* from public.drawer_sessions ds
    where ds.status = 'open'
      and (ds.opened_at at time zone 'Asia/Kolkata')::date <= v_work_date
    for update
  loop
    select e.profile_id into v_profile
    from public.employees e where e.id = v_session.employee_id;

    select coalesce(sum(t.cash_received - t.change_returned),0) into v_sales
    from public.billing_transactions t
    where t.created_by = v_profile and t.created_at >= v_session.opened_at
      and t.created_at <= v_now
      and (t.drawer_id = v_session.drawer_id or t.drawer_id is null);

    select coalesce(sum(e.amount),0) into v_expenses
    from public.expenses e
    where e.drawer_id = v_session.drawer_id and e.created_by = v_profile
      and e.payment_mode = 'cash' and e.created_at >= v_session.opened_at
      and e.created_at <= v_now;

    v_expected := coalesce(v_session.opening_cash,0) + coalesce(v_sales,0) - coalesce(v_expenses,0);

    update public.drawer_sessions
      set expected_cash = v_expected, counted_cash = null, difference = null,
          closed_by = null, closed_at = v_now, status = 'closed', close_reason = 'auto_9pm'
      where id = v_session.id and status = 'open';

    update public.attendance
      set check_out = coalesce(check_out,v_now),
          lunch_end = case when lunch_start is not null and lunch_end is null then v_now else lunch_end end,
          lunch_review_status = case when lunch_start is not null and lunch_end is null then 'recorded' else lunch_review_status end,
          notes = concat_ws(E'\n', nullif(notes,''), 'Auto-closed at 9:00 PM IST by system. Cash denomination count was not recorded.')
      where employee_id = v_session.employee_id
        and work_date = (v_session.opened_at at time zone 'Asia/Kolkata')::date;

    if found then v_closed := v_closed + 1; end if;
  end loop;
  return v_closed;
end;
$$;

revoke all on function private.auto_close_employee_shifts_9pm() from public, anon, authenticated;

select cron.schedule(
  'slv-employee-shift-auto-close-9pm-ist',
  '30 15 * * *',
  'select private.auto_close_employee_shifts_9pm();'
);
