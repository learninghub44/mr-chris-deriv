const {
    CompetitionServiceError,
    connectCompetitionAccount,
    getCompetitionBySlug,
    getLeaderboardByCompetitionSlug,
    getParticipantSnapshot,
    joinCompetition,
    refreshCompetitionBalance,
    runCompetitionAdminAction,
} = require('../../backend/server/competition-supabase-service');

const FUNCTION_PREFIX = '/.netlify/functions/competitions';
const API_PREFIX = '/api/competitions';

const json = (statusCode, body) => ({
    statusCode,
    headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
    },
    body: JSON.stringify(body),
});

const parsePath = rawPath => {
    const path = rawPath.startsWith(FUNCTION_PREFIX)
        ? rawPath.slice(FUNCTION_PREFIX.length)
        : rawPath.startsWith(API_PREFIX)
          ? rawPath.slice(API_PREFIX.length)
          : rawPath;

    return path.replace(/^\/+/, '').split('/').filter(Boolean);
};

const getRequestBody = event => {
    if (!event.body) {
        return {};
    }

    try {
        return JSON.parse(event.body);
    } catch {
        return {};
    }
};

exports.handler = async event => {
    try {
        const segments = parsePath(event.path || '');
        const method = event.httpMethod;
        const body = getRequestBody(event);

        if (method === 'GET' && segments.length === 1) {
            return json(200, await getCompetitionBySlug(segments[0]));
        }

        if (method === 'GET' && segments.length === 2 && segments[1] === 'leaderboard') {
            return json(200, await getLeaderboardByCompetitionSlug(segments[0]));
        }

        if (method === 'POST' && segments.length === 2 && segments[1] === 'join') {
            return json(201, await joinCompetition(segments[0], body.username));
        }

        if (segments.length === 3 && segments[1] === 'participants' && method === 'GET') {
            return json(200, await getParticipantSnapshot(segments[2]));
        }

        if (segments.length === 4 && segments[1] === 'participants' && segments[3] === 'connect-account' && method === 'POST') {
            return json(
                200,
                await connectCompetitionAccount({
                    slug: segments[0],
                    participantId: segments[2],
                    accountId: body.accountId,
                    accountCurrency: body.accountCurrency,
                    currentBalance: body.currentBalance,
                })
            );
        }

        if (segments.length === 4 && segments[1] === 'participants' && segments[3] === 'balance' && method === 'POST') {
            return json(
                200,
                await refreshCompetitionBalance({
                    participantId: segments[2],
                    accountId: body.accountId,
                    currentBalance: body.currentBalance,
                })
            );
        }

        if (segments.length === 3 && segments[1] === 'admin' && segments[2] === 'action' && method === 'POST') {
            return json(200, await runCompetitionAdminAction(segments[0], body.action));
        }

        return json(404, { error: 'Competition route not found.' });
    } catch (error) {
        const status = error instanceof CompetitionServiceError ? error.status : error.status || 500;
        const message = error instanceof Error ? error.message : 'Internal Server Error';

        console.error('[netlify-functions][competitions]', error);
        return json(status, { error: message });
    }
};
