-- Fix refresh_competition_result_metrics:
-- The original used UPDATE competition_results cr ... FROM function(cr.col)
-- which is invalid in PostgreSQL (cannot reference the update target's alias in FROM).
-- Replaced with a subquery that computes values first, then joins by id.
CREATE OR REPLACE FUNCTION public.refresh_competition_result_metrics(target_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
begin
    -- Step 1: recalculate adjusted_profit and growth_percentage
    update competition_results
    set
        adjusted_profit   = calc.adjusted_profit,
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
                    (
                        (coalesce(current_balance, 0)
                         - coalesce(starting_balance, 0)
                         - coalesce(deposits, 0)
                         + coalesce(withdrawals, 0)) / starting_balance * 100
                    )::numeric,
                    6
                )
            end as growth_percentage
        from competition_results
        where competition_id = target_competition_id
    ) calc
    where competition_results.id = calc.id;

    -- Step 2: re-rank by growth_percentage DESC
    with ranked as (
        select
            id,
            row_number() over (
                order by
                    growth_percentage       desc nulls last,
                    adjusted_profit         desc nulls last,
                    last_balance_update_at  asc  nulls last,
                    id                      asc
            ) as next_rank
        from competition_results
        where competition_id = target_competition_id
    )
    update competition_results
    set
        previous_rank = competition_results.current_rank,
        current_rank  = ranked.next_rank
    from ranked
    where competition_results.id = ranked.id;
end;
$$;

-- Fix on_competition_results_change:
-- The original had no recursion guard. refresh_competition_result_metrics
-- UPDATEs competition_results, which re-fires this trigger endlessly.
-- pg_trigger_depth() > 1 detects we are already inside the trigger stack.
CREATE OR REPLACE FUNCTION public.on_competition_results_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
begin
    if pg_trigger_depth() > 1 then
        return coalesce(new, old);
    end if;
    perform public.refresh_competition_result_metrics(coalesce(new.competition_id, old.competition_id));
    return coalesce(new, old);
end;
$$;
