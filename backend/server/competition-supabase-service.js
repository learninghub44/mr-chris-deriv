const crypto = require('crypto');

const COMPETITION_ACCOUNT_HASH_SALT = process.env.COMPETITION_ACCOUNT_HASH_SALT || 'risk-managers-competition-salt';

class CompetitionServiceError extends Error {
    constructor(status, message) {
        super(message);
        this.name = 'CompetitionServiceError';
        this.status = status;
    }
}

const getSupabaseConfig = () => {
    const url = process.env.SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceRoleKey) {
        throw new CompetitionServiceError(
            503,
            'Competition Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'
        );
    }

    return { url, serviceRoleKey };
};

const mapSupabaseError = error => {
    if (error instanceof CompetitionServiceError) {
        return error;
    }

    const message = error instanceof Error ? error.message : 'Competition service failed.';

    if (message.includes('Competition not found.')) {
        return new CompetitionServiceError(404, 'Competition not found.');
    }

    if (message.includes('Participant not found.')) {
        return new CompetitionServiceError(404, 'Participant not found.');
    }

    if (message.includes('Could not find the function public.') || message.includes('function public.')) {
        return new CompetitionServiceError(
            503,
            'Competition Supabase functions are not deployed yet. Apply the Supabase competition migrations and try again.'
        );
    }

    if (message.includes('Username must be 3-20 characters')) {
        return new CompetitionServiceError(400, 'Username must be 3-20 characters using a-z, 0-9, or underscores.');
    }

    if (message.includes('Demo accounts cannot join')) {
        return new CompetitionServiceError(400, 'Demo accounts cannot join the competition.');
    }

    if (message.includes('Unknown admin action.')) {
        return new CompetitionServiceError(400, 'Unknown admin action.');
    }

    if (message.includes('does not match this participant')) {
        return new CompetitionServiceError(403, 'That account does not match this participant.');
    }

    if (
        message.includes('already been taken') ||
        message.includes('already registered') ||
        message.includes('registration is not open') ||
        message.includes('only available during registration')
    ) {
        return new CompetitionServiceError(409, message);
    }

    return new CompetitionServiceError(500, message);
};

const supabaseRequest = async (path, { method = 'GET', body } = {}) => {
    const { url, serviceRoleKey } = getSupabaseConfig();
    const response = await fetch(`${url}${path}`, {
        method,
        headers: {
            apikey: serviceRoleKey,
            Authorization: `Bearer ${serviceRoleKey}`,
            'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
        let message = `Competition Supabase request failed with status ${response.status}.`;

        try {
            const payload = await response.json();
            message = payload.message || payload.error || payload.hint || message;
        } catch {
            const text = await response.text().catch(() => '');
            if (text) {
                message = text;
            }
        }

        throw new CompetitionServiceError(response.status, message);
    }

    if (response.status === 204) {
        return null;
    }

    const text = await response.text();
    if (!text) {
        return null;
    }

    return JSON.parse(text);
};

const invokeRpc = async (name, args = {}) => {
    try {
        return await supabaseRequest(`/rest/v1/rpc/${name}`, {
            method: 'POST',
            body: args,
        });
    } catch (error) {
        throw mapSupabaseError(error);
    }
};

const normalizeUsername = username => String(username || '').trim().toLowerCase();

const maskAccountId = accountId => {
    const value = String(accountId || '');
    const mask = '****';

    if (value.length <= 6) {
        return `${value.slice(0, 2)}${mask}`;
    }

    return `${value.slice(0, 2)}${mask}${value.slice(-4)}`;
};

const hashAccountId = accountId =>
    crypto.createHash('sha256').update(`${accountId}${COMPETITION_ACCOUNT_HASH_SALT}`).digest('hex');

const sortLeaderboardEntries = entries =>
    [...entries].sort((left, right) => {
        const leftRank = left.current_rank ?? Number.MAX_SAFE_INTEGER;
        const rightRank = right.current_rank ?? Number.MAX_SAFE_INTEGER;

        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        return Number(right.growth_percentage || 0) - Number(left.growth_percentage || 0);
    });

const getCompetitionBySlug = async slug => {
    return await invokeRpc('get_competition_by_slug', {
        target_slug: slug,
    });
};

const getLeaderboardByCompetitionSlug = async slug => {
    const payload = await invokeRpc('get_competition_leaderboard', {
        target_slug: slug,
    });

    return {
        competition_id: payload.competition_id,
        entries: sortLeaderboardEntries(payload.entries || []),
    };
};

const getParticipantSnapshot = async participantId => {
    return await invokeRpc('get_competition_participant_snapshot', {
        target_participant_id: participantId,
    });
};

const joinCompetition = async (slug, username) => {
    return await invokeRpc('join_competition_profile', {
        target_slug: slug,
        target_username: normalizeUsername(username),
    });
};

const connectCompetitionAccount = async ({ slug, participantId, accountId, accountCurrency, currentBalance }) => {
    return await invokeRpc('connect_competition_account', {
        target_slug: slug,
        target_participant_id: participantId,
        target_account_hash: hashAccountId(accountId),
        target_masked_account_id: maskAccountId(accountId),
        target_account_currency: accountCurrency,
        target_current_balance: Number(currentBalance.toFixed(2)),
    });
};

const refreshCompetitionBalance = async ({ participantId, accountId, currentBalance }) => {
    return await invokeRpc('refresh_competition_balance', {
        target_participant_id: participantId,
        target_account_hash: hashAccountId(accountId),
        target_current_balance: Number(currentBalance.toFixed(2)),
    });
};

const runCompetitionAdminAction = async (competitionId, action) => {
    return await invokeRpc('run_competition_admin_action', {
        target_competition_id: competitionId,
        requested_action: action,
    });
};

const resetCompetitionEntry = async ({ slug, participantId }) => {
    return await invokeRpc('reset_competition_entry', {
        target_slug: slug,
        target_participant_id: participantId,
    });
};

module.exports = {
    CompetitionServiceError,
    connectCompetitionAccount,
    getCompetitionBySlug,
    getLeaderboardByCompetitionSlug,
    getParticipantSnapshot,
    joinCompetition,
    resetCompetitionEntry,
    refreshCompetitionBalance,
    runCompetitionAdminAction,
};
