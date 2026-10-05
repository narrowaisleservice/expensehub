-- FlexiExpenseHub 05: record-keeping / compliance layer (UK: HMRC 6-year retention, VAT evidence, tamper evidence)
alter table exp_workspaces
  add column if not exists retention_years int not null default 6 check (retention_years >= 6),
  add column if not exists vat_number text;
alter table exp_expenses
  add column if not exists receipt_hash text,
  add column if not exists receipt_uploaded_at timestamptz,
  add column if not exists receipt_uploaded_by uuid,
  add column if not exists receipt_check text,
  add column if not exists supplier_vat_no text;

-- Is this expense still inside its retention period?
create or replace function exp_in_retention(d date, yrs int) returns boolean language sql stable set search_path = public as $$
  select (d + make_interval(years => yrs))::date > current_date $$;

-- Compliance guard: receipt provenance, post-submission integrity, mileage log, VAT evidence flags
create or replace function exp_expense_compliance() returns trigger language plpgsql security definer set search_path = public as $$
declare rs text; f text[]; locked boolean := false; ch text[] := '{}';
begin
  if tg_op = 'UPDATE' and old.report_id is not null then
    select status into rs from exp_reports where id = old.report_id;
    locked := rs in ('submitted','approved','reimbursed');
  end if;

  -- provenance: server stamps who/when; clients cannot set or alter these
  if tg_op = 'INSERT' then
    if new.receipt_path is not null then new.receipt_uploaded_at := now(); new.receipt_uploaded_by := auth.uid();
    else new.receipt_hash := null; new.receipt_uploaded_at := null; new.receipt_uploaded_by := null; end if;
  else
    if new.receipt_path is distinct from old.receipt_path then
      if locked then raise exception 'The receipt cannot be changed or removed after the report is submitted'; end if;
      if new.receipt_path is null then new.receipt_hash := null; new.receipt_uploaded_at := null; new.receipt_uploaded_by := null;
      else new.receipt_uploaded_at := now(); new.receipt_uploaded_by := auth.uid(); end if;
    else
      new.receipt_hash := old.receipt_hash; new.receipt_uploaded_at := old.receipt_uploaded_at; new.receipt_uploaded_by := old.receipt_uploaded_by;
    end if;
  end if;

  if new.kind = 'mileage' and (coalesce(trim(new.from_loc),'') = '' or coalesce(trim(new.to_loc),'') = '') then
    raise exception 'Mileage claims need a start and end location';
  end if;

  -- changes made to locked expenses (by finance) are written to the audit log
  if locked then
    if new.amount is distinct from old.amount then ch := ch || ('amount ' || old.amount || ' → ' || new.amount); end if;
    if new.expense_date is distinct from old.expense_date then ch := ch || ('date ' || old.expense_date || ' → ' || new.expense_date); end if;
    if new.vat_amount is distinct from old.vat_amount then ch := ch || ('VAT ' || coalesce(old.vat_amount::text,'none') || ' → ' || coalesce(new.vat_amount::text,'none')); end if;
    if new.merchant is distinct from old.merchant then ch := ch || ('merchant "' || coalesce(old.merchant,'') || '" → "' || coalesce(new.merchant,'') || '"'); end if;
    if new.category_id is distinct from old.category_id then ch := ch || 'category changed'; end if;
    if array_length(ch,1) > 0 then
      insert into exp_audit(workspace_id,user_id,entity,entity_id,action,label)
      values (new.workspace_id, auth.uid(), 'exp_expenses', new.id, 'edited after submission', coalesce(new.merchant,'Expense') || ': ' || array_to_string(ch,'; '));
    end if;
  end if;

  -- VAT evidence flags (HMRC: VAT can only be reclaimed with a valid VAT receipt/invoice; full invoice over £250)
  f := coalesce(new.flags, '{}');
  if coalesce(new.vat_amount,0) > 0 and new.receipt_path is null then f := array_append(f, 'vat_no_receipt'); end if;
  if coalesce(new.vat_amount,0) > 0 and new.amount_base > 250 and coalesce(trim(new.supplier_vat_no),'') = '' then f := array_append(f, 'vat_invoice_needed'); end if;
  if new.receipt_path is not null and new.receipt_check is not null and new.receipt_check <> 'ok' then f := array_append(f, 'receipt_unclear'); end if;
  new.flags := f;
  return new;
end $$;
drop trigger if exists exp_expense_zcompliance_t on exp_expenses;
create trigger exp_expense_zcompliance_t before insert or update on exp_expenses for each row execute function exp_expense_compliance();

-- Retention: submitted/approved/paid records cannot be deleted inside the retention period
create or replace function exp_retention_delete_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare rs text; yrs int;
begin
  select retention_years into yrs from exp_workspaces where id = old.workspace_id;
  if yrs is null then return old; end if;   -- workspace already gone
  if tg_table_name = 'exp_expenses' then
    if old.report_id is not null then
      select status into rs from exp_reports where id = old.report_id;
      if rs in ('submitted','approved','reimbursed') and exp_in_retention(old.expense_date, yrs) then
        raise exception 'Record retention: this expense is part of a % report and must be kept for % years (until %)', rs, yrs, (old.expense_date + make_interval(years => yrs))::date;
      end if;
    end if;
  elsif tg_table_name = 'exp_reports' then
    if old.status in ('submitted','approved','reimbursed') and exp_in_retention(old.created_at::date, yrs) then
      raise exception 'Record retention: a % report must be kept for % years', old.status, yrs;
    end if;
  elsif tg_table_name = 'exp_bills' then
    if old.status in ('approved','paid') and exp_in_retention(old.created_at::date, yrs) then
      raise exception 'Record retention: an % bill must be kept for % years', old.status, yrs;
    end if;
  elsif tg_table_name = 'exp_invoices' then
    if old.status in ('sent','paid') and exp_in_retention(old.issue_date, yrs) then
      raise exception 'Record retention: a % invoice must be kept for % years (void it instead)', old.status, yrs;
    end if;
  end if;
  return old;
end $$;
drop trigger if exists exp_ret_expenses on exp_expenses; create trigger exp_ret_expenses before delete on exp_expenses for each row execute function exp_retention_delete_guard();
drop trigger if exists exp_ret_reports on exp_reports;   create trigger exp_ret_reports   before delete on exp_reports   for each row execute function exp_retention_delete_guard();
drop trigger if exists exp_ret_bills on exp_bills;       create trigger exp_ret_bills       before delete on exp_bills       for each row execute function exp_retention_delete_guard();
drop trigger if exists exp_ret_invoices on exp_invoices; create trigger exp_ret_invoices   before delete on exp_invoices   for each row execute function exp_retention_delete_guard();

-- A workspace holding records still inside retention cannot be deleted
create or replace function exp_ws_delete_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from exp_expenses e join exp_reports r on r.id = e.report_id
             where e.workspace_id = old.id and r.status in ('submitted','approved','reimbursed') and exp_in_retention(e.expense_date, old.retention_years))
     or exists (select 1 from exp_bills where workspace_id = old.id and status in ('approved','paid') and exp_in_retention(created_at::date, old.retention_years))
     or exists (select 1 from exp_invoices where workspace_id = old.id and status in ('sent','paid') and exp_in_retention(issue_date, old.retention_years)) then
    raise exception 'Record retention: this workspace still holds submitted or paid records that must be kept for % years. Export them first and contact support to remove.', old.retention_years;
  end if;
  return old;
end $$;
drop trigger if exists exp_ws_delete_guard_t on exp_workspaces;
create trigger exp_ws_delete_guard_t before delete on exp_workspaces for each row execute function exp_ws_delete_guard();

-- Receipts: files in storage cannot be deleted while a locked expense or approved/paid bill points at them (and objects can never be overwritten: no UPDATE policy)
drop policy if exists exp_rcpt_delete on storage.objects;
create policy exp_rcpt_delete on storage.objects for delete to authenticated using (
  bucket_id = 'exp-receipts' and split_part(name,'/',2) = auth.uid()::text
  and not exists (select 1 from public.exp_expenses e join public.exp_reports r on r.id = e.report_id where e.receipt_path = storage.objects.name and r.status in ('submitted','approved','reimbursed'))
  and not exists (select 1 from public.exp_bills b where b.file_path = storage.objects.name and b.status in ('approved','paid')));
