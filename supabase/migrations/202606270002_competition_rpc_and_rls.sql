create extension if not exists pgcrypto;

create or replace function public.refresh_competition_result_metrics(target_competition_id uuid)
returns void
language plpgsql
as $$
begin
    update competition_results
    set
        adjusted_profit = calc.adjusted_profit,
        growth_percentage = calc.growth_percentage
    from (
        select
            id,
            case
                when coalesce(starting_balance, 0) <= 0 then 0::numeric
                else round(
                    (coalesce(current_balance, 0)
                     - coalesce(starting_balance, 0)
                     - coalesce(deposits, 0)
                     + coalesce(withdrawals, 0))::numeric,
                    2
                )
            end as adjusted_profit,
            case
                when coalesce(starting_balance, 0) <= 0 then 0::numeric
                else round(
                    ((coalesce(current_balance, 0)
                      - coalesce(starting_balance, 0)
                      - coalesce(deposits, 0)
                      + coalesce(withdrawals, 0)) / starting_balance * 100)::numeric,
                    6
                )
            end as growth_percentage
        from competition_results
        where competition_id = target_competition_id
    ) calc
    where competition_results.id = calc.id;

    with ranked as (
        select
            id,
            row_number() over (
                order by
                    growth_percentage desc nulls last,
                    adjusted_profit desc nulls last,
                    last_balance_update_at asc nulls last,
                    id asc
            ) as next_rank
        from competition_results
        where competition_id = target_competition_id
    )
    update competition_results
    set
        previous_rank = competition_results.current_rank,
        current_rank = ranked.next_rank
    from ranked
    where competition_results.id = ranked.id;
end;
$$;

create or replace function public.on_competition_results_change()
returns trigger
language plpgsql
as $$
begin
    if pg_trigger_depth() > 1 then
        return coalesce(new, old);
    end if;

    perform public.refresh_competition_result_metrics(coalesce(new.competition_id, old.competition_id));
    return coalesce(new, old);
end;
$$;

drop trigger if exists competition_results_rank_refresh on competition_results;
create trigger competition_results_rank_refresh
after insert or update on competition_results
for each row
execute function public.on_competition_results_change();

alter table competitions enable row level security;
alter table competition_participants enable row level security;
alter table competition_results enable row level security;
alter table competition_admin_actions enable row level security;

grant select on public_competitions to anon, authenticated, service_role;
grant select on public_competition_leaderboard to anon, authenticated, service_role;

create or replace function public.get_competition_by_slug(target_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    competition_payload jsonb;
begin
    select to_jsonb(pc)
    into competition_payload
    from public_competitions pc
    where pc.slug = target_slug
    limit 1;

    if competition_payload is null then
        raise exception 'Competition not found.' using errcode = 'P0001';
    end if;

    return competition_payload;
end;
$$;

create or replace function public.get_competition_leaderboard(target_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    competition_record competitions%rowtype;
    entries_payload jsonb;
begin
    select *
    into competition_record
    from competitions
    where slug = target_slug
    limit 1;

    if not found then
        raise exception 'Competition not found.' using errcode = 'P0001';
    end if;

    select coalesce(
        jsonb_agg(to_jsonb(pcl) order by pcl.current_rank asc nulls last),
        '[]'::jsonb
    )
    into entries_payload
    from public_competition_leaderboard pcl
    where pcl.competition_id = competition_record.id;

    return jsonb_build_object(
        'competition_id', competition_record.id,
        'entries', entries_payload
    );
end;
$$;

create or replace function public.get_competition_participant_snapshot(target_participant_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    participant_record competition_participants%rowtype;
    result_record competition_results%rowtype;
begin
    select *
    into participant_record
    from competition_participants
    where id = target_participant_id
    limit 1;

    if not found then
        raise exception 'Participant not found.' using errcode = 'P0001';
    end if;

    select *
    into result_record
    from competition_results
    where participant_id = target_participant_id
    limit 1;

    return jsonb_build_object(
        'participant', to_jsonb(participant_record),
        'result', case when result_record is null then null else to_jsonb(result_record) end
    );
end;
$$;

create or replace function public.join_competition_profile(target_slug text, target_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    competition_record competitions%rowtype;
    participant_record competition_participants%rowtype;
    result_record competition_results%rowtype;
    normalized_username text := lower(trim(coalesce(target_username, '')));
begin
    if normalized_username !~ '^[a-z0-9_]{3,20}$' then
        raise exception 'Username must be 3-20 characters using a-z, 0-9, or underscores.' using errcode = 'P0001';
    end if;

    select *
    into competition_record
    from competitions
    where slug = target_slug
    for update;

    if not found then
        raise exception 'Competition not found.' using errcode = 'P0001';
    end if;

    if competition_record.status <> 'registration' then
        raise exception 'Competition registration is not open right now.' using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from competition_participants
        where competition_id = competition_record.id
          and username_normalized = normalized_username
    ) then
        raise exception 'That username has already been taken in this competition.' using errcode = 'P0001';
    end if;

    insert into competition_participants (
        competition_id,
        username,
        username_normalized,
        registration_status
    )
    values (
        competition_record.id,
        normalized_username,
        normalized_username,
        'pending'
    )
    returning *
    into participant_record;

    insert into competition_results (
        competition_id,
        participant_id,
        current_balance,
        deposits,
        withdrawals,
        adjusted_profit,
        growth_percentage
    )
    values (
        competition_record.id,
        participant_record.id,
        0,
        0,
        0,
        0,
        0
    )
    returning *
    into result_record;

    return jsonb_build_object(
        'participant', to_jsonb(participant_record),
        'result', to_jsonb(result_record)
    );
end;
$$;

create or replace function public.connect_competition_account(
    target_slug text,
    target_participant_id uuid,
    target_account_hash text,
    target_masked_account_id text,
    target_account_currency text,
    target_current_balance numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    competition_record competitions%rowtype;
    participant_record competition_participants%rowtype;
    updated_participant competition_participants%rowtype;
    updated_result competition_results%rowtype;
begin
    if target_account_hash is null or target_account_hash = '' or target_current_balance is null then
        raise exception 'Account ID and current balance are required.' using errcode = 'P0001';
    end if;

    select *
    into competition_record
    from competitions
    where slug = target_slug
    for update;

    if not found then
        raise exception 'Competition not found.' using errcode = 'P0001';
    end if;

    if competition_record.status <> 'registration' then
        raise exception 'Account verification is only available during registration.' using errcode = 'P0001';
    end if;

    select *
    into participant_record
    from competition_participants
    where id = target_participant_id
    for update;

    if not found then
        raise exception 'Participant not found.' using errcode = 'P0001';
    end if;

    if exists (
        select 1
        from competition_participants
        where competition_id = competition_record.id
          and deriv_account_hash = target_account_hash
          and id <> target_participant_id
    ) then
        raise exception 'That Deriv account is already registered in this competition.' using errcode = 'P0001';
    end if;

    update competition_participants
    set
        deriv_account_hash = target_account_hash,
        masked_account_id = target_masked_account_id,
        account_currency = coalesce(target_account_currency, participant_record.account_currency, competition_record.currency, 'USD'),
        is_real_account = true,
        is_account_verified = true,
        registration_status = 'verified'
    where id = target_participant_id
    returning *
    into updated_participant;

    update competition_results
    set
        current_balance = round(target_current_balance::numeric, 2),
        adjusted_profit = case
            when coalesce(starting_balance, 0) <= 0 then 0::numeric
            else round((target_current_balance - coalesce(starting_balance, 0))::numeric, 2)
        end,
        growth_percentage = case
            when coalesce(starting_balance, 0) <= 0 then 0::numeric
            else round((((target_current_balance - coalesce(starting_balance, 0)) / starting_balance) * 100)::numeric, 6)
        end,
        last_balance_update_at = now()
    where participant_id = target_participant_id
    returning *
    into updated_result;

    perform public.refresh_competition_result_metrics(competition_record.id);

    select *
    into updated_result
    from competition_results
    where participant_id = target_participant_id;

    return jsonb_build_object(
        'participant', to_jsonb(updated_participant),
        'result', to_jsonb(updated_result)
    );
end;
$$;

create or replace function public.refresh_competition_balance(
    target_participant_id uuid,
    target_account_hash text,
    target_current_balance numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    participant_record competition_participants%rowtype;
    updated_result competition_results%rowtype;
begin
    if target_account_hash is null or target_account_hash = '' or target_current_balance is null then
        raise exception 'Account ID and current balance are required.' using errcode = 'P0001';
    end if;

    select *
    into participant_record
    from competition_participants
    where id = target_participant_id
    for update;

    if not found then
        raise exception 'Participant not found.' using errcode = 'P0001';
    end if;

    if participant_record.deriv_account_hash is not null
       and participant_record.deriv_account_hash <> target_account_hash then
        raise exception 'That account does not match this participant.' using errcode = 'P0001';
    end if;

    update competition_results
    set
        current_balance = round(target_current_balance::numeric, 2),
        adjusted_profit = case
            when coalesce(starting_balance, 0) <= 0 then 0::numeric
            else round(
                (target_current_balance
                 - coalesce(starting_balance, 0)
                 - coalesce(deposits, 0)
                 + coalesce(withdrawals, 0))::numeric,
                2
            )
        end,
        growth_percentage = case
            when coalesce(starting_balance, 0) <= 0 then 0::numeric
            else round(
                (((target_current_balance
                    - coalesce(starting_balance, 0)
                    - coalesce(deposits, 0)
                    + coalesce(withdrawals, 0)) / starting_balance) * 100)::numeric,
                6
            )
        end,
        last_balance_update_at = now()
    where participant_id = target_participant_id
    returning *
    into updated_result;

    perform public.refresh_competition_result_metrics(participant_record.competition_id);

    select *
    into updated_result
    from competition_results
    where participant_id = target_participant_id;

    return jsonb_build_object(
        'participant', to_jsonb(participant_record),
        'result', to_jsonb(updated_result)
    );
end;
$$;

create or replace function public.run_competition_admin_action(
    target_competition_id uuid,
    requested_action text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    competition_record competitions%rowtype;
    updated_competition competitions%rowtype;
    participant_row record;
begin
    select *
    into competition_record
    from competitions
    where id = target_competition_id
    for update;

    if not found then
        raise exception 'Competition not found.' using errcode = 'P0001';
    end if;

    if requested_action = 'open_registration' then
        update competitions
        set status = 'registration'
        where id = target_competition_id
        returning *
        into updated_competition;
    elsif requested_action = 'lock' then
        update competitions
        set status = 'locked'
        where id = target_competition_id
        returning *
        into updated_competition;
    elsif requested_action = 'pause' then
        update competitions
        set status = 'paused', actual_paused_at = now()
        where id = target_competition_id
        returning *
        into updated_competition;
    elsif requested_action = 'end' then
        update competitions
        set status = 'completed', actual_ended_at = now()
        where id = target_competition_id
        returning *
        into updated_competition;
    elsif requested_action = 'start' then
        update competitions
        set status = 'locked'
        where id = target_competition_id;

        for participant_row in
            select cr.id, cr.current_balance
            from competition_participants cp
            join competition_results cr on cr.participant_id = cp.id
            where cp.competition_id = target_competition_id
              and cp.registration_status = 'verified'
              and cp.is_real_account = true
        loop
            update competition_results
            set
                starting_balance = round(coalesce(participant_row.current_balance, 0)::numeric, 2),
                last_balance_update_at = now()
            where id = participant_row.id;
        end loop;

        update competitions
        set status = 'live', actual_started_at = now()
        where id = target_competition_id
        returning *
        into updated_competition;
    else
        raise exception 'Unknown admin action.' using errcode = 'P0001';
    end if;

    insert into competition_admin_actions (competition_id, action, actor, metadata)
    values (
        target_competition_id,
        requested_action,
        'competition-admin-ui',
        jsonb_build_object('executed_at', now())
    );

    perform public.refresh_competition_result_metrics(target_competition_id);

    return jsonb_build_object('competition', to_jsonb(updated_competition));
end;
$$;

grant execute on function public.get_competition_by_slug(text) to anon, authenticated, service_role;
grant execute on function public.get_competition_leaderboard(text) to anon, authenticated, service_role;
grant execute on function public.get_competition_participant_snapshot(uuid) to service_role;
grant execute on function public.join_competition_profile(text, text) to service_role;
grant execute on function public.connect_competition_account(text, uuid, text, text, text, numeric) to service_role;
grant execute on function public.refresh_competition_balance(uuid, text, numeric) to service_role;
grant execute on function public.run_competition_admin_action(uuid, text) to service_role;
