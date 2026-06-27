const express = require('express');
const {
    CompetitionServiceError,
    connectCompetitionAccount,
    getCompetitionBySlug,
    getLeaderboardByCompetitionSlug,
    getParticipantSnapshot,
    joinCompetition,
    resetCompetitionEntry,
    refreshCompetitionBalance,
    runCompetitionAdminAction,
} = require('../competition-supabase-service');

const router = express.Router();

router.get('/:slug', async (req, res, next) => {
    try {
        res.json(await getCompetitionBySlug(req.params.slug));
    } catch (error) {
        next(error);
    }
});

router.get('/:slug/leaderboard', async (req, res, next) => {
    try {
        res.json(await getLeaderboardByCompetitionSlug(req.params.slug));
    } catch (error) {
        next(error);
    }
});

router.post('/:slug/join', async (req, res, next) => {
    try {
        res.status(201).json(await joinCompetition(req.params.slug, req.body?.username));
    } catch (error) {
        next(error);
    }
});

router.get('/:slug/participants/:participantId', async (req, res, next) => {
    try {
        res.json(await getParticipantSnapshot(req.params.participantId));
    } catch (error) {
        next(error);
    }
});

router.post('/:slug/participants/:participantId/connect-account', async (req, res, next) => {
    try {
        res.json(
            await connectCompetitionAccount({
                slug: req.params.slug,
                participantId: req.params.participantId,
                accountId: req.body?.accountId,
                accountCurrency: req.body?.accountCurrency,
                currentBalance: req.body?.currentBalance,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.post('/:slug/participants/:participantId/balance', async (req, res, next) => {
    try {
        res.json(
            await refreshCompetitionBalance({
                participantId: req.params.participantId,
                accountId: req.body?.accountId,
                currentBalance: req.body?.currentBalance,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.post('/:slug/participants/:participantId/reset', async (req, res, next) => {
    try {
        res.json(
            await resetCompetitionEntry({
                slug: req.params.slug,
                participantId: req.params.participantId,
            })
        );
    } catch (error) {
        next(error);
    }
});

router.post('/:competitionId/admin/action', async (req, res, next) => {
    try {
        res.json(await runCompetitionAdminAction(req.params.competitionId, req.body?.action));
    } catch (error) {
        next(error);
    }
});

router.use((error, req, res, next) => {
    const status = error instanceof CompetitionServiceError ? error.status : error.status || 500;
    const message = error instanceof Error ? error.message : 'Internal Server Error';
    res.status(status).json({ error: message });
});

module.exports = router;
