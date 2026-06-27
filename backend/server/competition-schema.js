const competitionMigrations = [
    {
        name: '202606260001_create_competitions.sql',
        sql: `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS competitions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text UNIQUE NOT NULL DEFAULT 'giftbaris-2026-july',
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','registration','locked','live','paused','completed','cancelled')),
    registration_opens_at timestamptz,
    registration_closes_at timestamptz,
    starts_at timestamptz,
    ends_at timestamptz,
    actual_started_at timestamptz,
    actual_ended_at timestamptz,
    actual_paused_at timestamptz,
    prize_info text DEFAULT 'Winner takes the headline prize pool and featured placement on Risk Managers.',
    rules text DEFAULT 'Real accounts only. One account per competition. Rankings use adjusted growth percentage.',
    currency text DEFAULT 'USD',
    created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS competition_participants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid REFERENCES competitions(id) ON DELETE CASCADE,
    username text NOT NULL,
    username_normalized text NOT NULL,
    deriv_account_hash text,
    masked_account_id text,
    account_currency text,
    is_real_account boolean DEFAULT false,
    is_account_verified boolean DEFAULT false,
    registration_status text DEFAULT 'pending' CHECK (registration_status IN ('pending','verified','rejected','disqualified')),
    joined_at timestamptz DEFAULT now(),
    UNIQUE (competition_id, username_normalized),
    UNIQUE (competition_id, deriv_account_hash)
);

CREATE TABLE IF NOT EXISTS competition_results (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid REFERENCES competitions(id) ON DELETE CASCADE,
    participant_id uuid REFERENCES competition_participants(id) ON DELETE CASCADE,
    starting_balance numeric(18,2),
    current_balance numeric(18,2),
    deposits numeric(18,2) DEFAULT 0,
    withdrawals numeric(18,2) DEFAULT 0,
    adjusted_profit numeric(18,2) DEFAULT 0,
    growth_percentage numeric(18,6) DEFAULT 0,
    current_rank integer,
    previous_rank integer,
    last_balance_update_at timestamptz,
    UNIQUE (competition_id, participant_id)
);

CREATE TABLE IF NOT EXISTS competition_admin_actions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    competition_id uuid REFERENCES competitions(id) ON DELETE CASCADE,
    action text NOT NULL,
    actor text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.calculate_competition_growth(
    starting_balance numeric,
    current_balance numeric,
    deposits numeric DEFAULT 0,
    withdrawals numeric DEFAULT 0
)
RETURNS TABLE(adjusted_profit numeric, growth_percentage numeric)
LANGUAGE sql
AS $$
    SELECT
        CASE
            WHEN COALESCE(starting_balance, 0) <= 0 THEN 0::numeric
            ELSE ROUND(COALESCE(current_balance, 0) - COALESCE(starting_balance, 0) - COALESCE(deposits, 0) + COALESCE(withdrawals, 0), 2)
        END AS adjusted_profit,
        CASE
            WHEN COALESCE(starting_balance, 0) <= 0 THEN 0::numeric
            ELSE ROUND(((COALESCE(current_balance, 0) - COALESCE(starting_balance, 0) - COALESCE(deposits, 0) + COALESCE(withdrawals, 0)) / starting_balance) * 100, 6)
        END AS growth_percentage;
$$;

CREATE OR REPLACE FUNCTION public.refresh_competition_result_metrics(target_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE competition_results
    SET
        adjusted_profit = calc.adjusted_profit,
        growth_percentage = calc.growth_percentage
    FROM (
        SELECT
            id,
            CASE
                WHEN COALESCE(starting_balance, 0) <= 0 THEN 0::numeric
                ELSE ROUND(
                    (COALESCE(current_balance, 0) - COALESCE(starting_balance, 0) - COALESCE(deposits, 0) + COALESCE(withdrawals, 0))::numeric,
                    2
                )
            END AS adjusted_profit,
            CASE
                WHEN COALESCE(starting_balance, 0) <= 0 THEN 0::numeric
                ELSE ROUND(
                    ((COALESCE(current_balance, 0) - COALESCE(starting_balance, 0) - COALESCE(deposits, 0) + COALESCE(withdrawals, 0)) / starting_balance * 100)::numeric,
                    6
                )
            END AS growth_percentage
        FROM competition_results
        WHERE competition_id = target_competition_id
    ) calc
    WHERE competition_results.id = calc.id;

    WITH ranked AS (
        SELECT
            id,
            ROW_NUMBER() OVER (
                ORDER BY growth_percentage DESC NULLS LAST, adjusted_profit DESC NULLS LAST, last_balance_update_at ASC NULLS LAST, id ASC
            ) AS next_rank
        FROM competition_results
        WHERE competition_id = target_competition_id
    )
    UPDATE competition_results
    SET
        previous_rank = competition_results.current_rank,
        current_rank = ranked.next_rank
    FROM ranked
    WHERE competition_results.id = ranked.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_competition_results_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    PERFORM public.refresh_competition_result_metrics(COALESCE(NEW.competition_id, OLD.competition_id));
    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS competition_results_rank_refresh ON competition_results;
CREATE TRIGGER competition_results_rank_refresh
AFTER INSERT OR UPDATE ON competition_results
FOR EACH ROW
EXECUTE FUNCTION public.on_competition_results_change();

CREATE OR REPLACE VIEW public_competitions AS
SELECT
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
    COALESCE(COUNT(cp.id) FILTER (WHERE cp.registration_status IN ('pending', 'verified')), 0) AS participants_count,
    COALESCE(COUNT(cp.id) FILTER (WHERE cp.registration_status = 'verified' AND cp.is_real_account = true), 0) AS verified_participants_count
FROM competitions c
LEFT JOIN competition_participants cp ON cp.competition_id = c.id
GROUP BY c.id;

CREATE OR REPLACE VIEW public_competition_leaderboard AS
SELECT
    cp.competition_id,
    cp.id AS participant_id,
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
FROM competition_participants cp
JOIN competition_results cr ON cr.participant_id = cp.id
WHERE cp.registration_status = 'verified' AND cp.is_real_account = true;

INSERT INTO competitions (
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
VALUES (
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
ON CONFLICT (slug) DO NOTHING;
        `.trim(),
    },
    {
        name: '202606270001_fix_competition_trigger_functions.sql',
        sql: `
CREATE OR REPLACE FUNCTION public.refresh_competition_result_metrics(target_competition_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
    UPDATE competition_results
    SET
        adjusted_profit = calc.adjusted_profit,
        growth_percentage = calc.growth_percentage
    FROM (
        SELECT
            id,
            CASE
                WHEN COALESCE(starting_balance, 0) <= 0 THEN 0::numeric
                ELSE ROUND(
                    (COALESCE(current_balance, 0) - COALESCE(starting_balance, 0) - COALESCE(deposits, 0) + COALESCE(withdrawals, 0))::numeric,
                    2
                )
            END AS adjusted_profit,
            CASE
                WHEN COALESCE(starting_balance, 0) <= 0 THEN 0::numeric
                ELSE ROUND(
                    ((COALESCE(current_balance, 0) - COALESCE(starting_balance, 0) - COALESCE(deposits, 0) + COALESCE(withdrawals, 0)) / starting_balance * 100)::numeric,
                    6
                )
            END AS growth_percentage
        FROM competition_results
        WHERE competition_id = target_competition_id
    ) calc
    WHERE competition_results.id = calc.id;

    WITH ranked AS (
        SELECT
            id,
            ROW_NUMBER() OVER (
                ORDER BY
                    growth_percentage DESC NULLS LAST,
                    adjusted_profit DESC NULLS LAST,
                    last_balance_update_at ASC NULLS LAST,
                    id ASC
            ) AS next_rank
        FROM competition_results
        WHERE competition_id = target_competition_id
    )
    UPDATE competition_results
    SET
        previous_rank = competition_results.current_rank,
        current_rank = ranked.next_rank
    FROM ranked
    WHERE competition_results.id = ranked.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.on_competition_results_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF pg_trigger_depth() > 1 THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    PERFORM public.refresh_competition_result_metrics(COALESCE(NEW.competition_id, OLD.competition_id));
    RETURN COALESCE(NEW, OLD);
END;
$$;
        `.trim(),
    },
];

let schemaPromise = null;

const isMissingRelationError = error => error && error.code === '42P01';

const applyCompetitionMigrations = async pool => {
    for (const migration of competitionMigrations) {
        await pool.query(migration.sql);
    }
};

const ensureCompetitionSchema = async pool => {
    if (schemaPromise) {
        return schemaPromise;
    }

    schemaPromise = applyCompetitionMigrations(pool).catch(error => {
        schemaPromise = null;
        throw error;
    });

    return schemaPromise;
};

module.exports = {
    applyCompetitionMigrations,
    competitionMigrations,
    ensureCompetitionSchema,
    isMissingRelationError,
};
