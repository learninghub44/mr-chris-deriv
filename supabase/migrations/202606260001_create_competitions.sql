create extension if not exists pgcrypto;

create table if not exists competitions (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    slug text unique not null default 'giftbaris-2026-july',
    status text not null default 'draft' check (status in ('draft','registration','locked','live','paused','completed','cancelled')),
    registration_opens_at timestamptz,
    registration_closes_at timestamptz,
    starts_at timestamptz,
    ends_at timestamptz,
    actual_started_at timestamptz,
    actual_ended_at timestamptz,
    actual_paused_at timestamptz,
    prize_info text default 'Winner takes the headline prize pool and featured placement on Risk Managers.',
    rules text default 'Real accounts only. One account per competition. Rankings use adjusted growth percentage.',
    currency text default 'USD',
    created_at timestamptz default now()
);

create table if not exists competition_participants (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid references competitions(id) on delete cascade,
    username text not null,
    username_normalized text not null,
    deriv_account_hash text,
    masked_account_id text,
    account_currency text,
    is_real_account boolean default false,
    is_account_verified boolean default false,
    registration_status text default 'pending' check (registration_status in ('pending','verified','rejected','disqualified')),
    joined_at timestamptz default now(),
    unique (competition_id, username_normalized),
    unique (competition_id, deriv_account_hash)
);

create table if not exists competition_results (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid references competitions(id) on delete cascade,
    participant_id uuid references competition_participants(id) on delete cascade,
    starting_balance numeric(18,2),
    current_balance numeric(18,2),
    deposits numeric(18,2) default 0,
    withdrawals numeric(18,2) default 0,
    adjusted_profit numeric(18,2) default 0,
    growth_percentage numeric(18,6) default 0,
    current_rank integer,
    previous_rank integer,
    last_balance_update_at timestamptz,
    unique (competition_id, participant_id)
);

create table if not exists competition_admin_actions (
    id uuid primary key default gen_random_uuid(),
    competition_id uuid references competitions(id) on delete cascade,
    action text not null,
    actor text,
    metadata jsonb default '{}'::jsonb,
    created_at timestamptz default now()
);

create or replace function public.calculate_competition_growth(
    starting_balance numeric,
    current_balance numeric,
    deposits numeric default 0,
    withdrawals numeric default 0
)
returns table(adjusted_profit numeric, growth_percentage numeric)
language sql
as $$
    select
        case
            when coalesce(starting_balance, 0) <= 0 then 0::numeric
            else round(coalesce(current_balance, 0) - coalesce(starting_balance, 0) - coalesce(deposits, 0) + coalesce(withdrawals, 0), 2)
        end as adjusted_profit,
        case
            when coalesce(starting_balance, 0) <= 0 then 0::numeric
            else round(((coalesce(current_balance, 0) - coalesce(starting_balance, 0) - coalesce(deposits, 0) + coalesce(withdrawals, 0)) / starting_balance) * 100, 6)
        end as growth_percentage;
$$;

create or replace function public.refresh_competition_result_metrics(target_competition_id uuid)
returns void
language plpgsql
as $$
begin
    update competition_results cr
    set
        adjusted_profit = calc.adjusted_profit,
        growth_percentage = calc.growth_percentage
    from public.calculate_competition_growth(cr.starting_balance, cr.current_balance, cr.deposits, cr.withdrawals) calc
    where cr.competition_id = target_competition_id;

    with ranked as (
        select
            id,
            row_number() over (
                order by growth_percentage desc nulls last, adjusted_profit desc nulls last, last_balance_update_at asc nulls last, id asc
            ) as next_rank
        from competition_results
        where competition_id = target_competition_id
    )
    update competition_results cr
    set
        previous_rank = cr.current_rank,
        current_rank = ranked.next_rank
    from ranked
    where cr.id = ranked.id;
end;
$$;

create or replace function public.on_competition_results_change()
returns trigger
language plpgsql
as $$
begin
    perform public.refresh_competition_result_metrics(coalesce(new.competition_id, old.competition_id));
    return coalesce(new, old);
end;
$$;

drop trigger if exists competition_results_rank_refresh on competition_results;
create trigger competition_results_rank_refresh
after insert or update on competition_results
for each row
execute function public.on_competition_results_change();

create or replace view public_competitions as
select
    c.id,
    c.name,
    c.slug,
    c.status,
    c.registration_opens_at,
    c.registration_closes_at,
    c.starts_at,
    c.ends_at,
    c.actual_started_at,
    c.actual_ended_at,
    c.actual_paused_at,
    c.prize_info,
    c.rules,
    c.currency,
    c.created_at,
    coalesce(count(cp.id) filter (where cp.registration_status in ('pending', 'verified')), 0) as participants_count,
    coalesce(count(cp.id) filter (where cp.registration_status = 'verified' and cp.is_real_account = true), 0) as verified_participants_count
from competitions c
left join competition_participants cp on cp.competition_id = c.id
group by c.id;

create or replace view public_competition_leaderboard as
select
    cp.competition_id,
    cp.id as participant_id,
    cp.username,
    cp.masked_account_id,
    cp.account_currency,
    cr.starting_balance,
    cr.current_balance,
    cr.adjusted_profit,
    cr.growth_percentage,
    cr.current_rank,
    cr.previous_rank,
    cr.last_balance_update_at
from competition_participants cp
join competition_results cr on cr.participant_id = cp.id
where cp.registration_status = 'verified' and cp.is_real_account = true;

insert into competitions (
    name,
    slug,
    status,
    registration_opens_at,
    registration_closes_at,
    starts_at,
    ends_at,
    prize_info,
    rules,
    currency
)
values (
    'Giftbaris Competition July 2026',
    'giftbaris-2026-july',
    'registration',
    '2026-06-26T00:00:00Z',
    '2026-07-01T04:59:59Z',
    '2026-07-01T05:00:00Z',
    '2026-07-31T20:59:59Z',
    'Top performers earn prize payouts, community recognition, and leaderboard placement.',
    'Use one real Deriv account only. Deposits and withdrawals are adjusted out of the final ranking.',
    'USD'
)
on conflict (slug) do nothing;
