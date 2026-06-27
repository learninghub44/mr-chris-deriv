import { useEffect, useState } from 'react';
import type { CompetitionRecord, ParticipantSnapshot } from '@/features/competition/types/competition.types';

const DEFAULT_COMPETITION_SLUG = 'giftbaris-2026-july';
const storageKey = (slug: string) => `competition:participant:${slug}`;

const apiBaseUrl = '/api';

const buildCompetitionUrl = (path: string) => `${apiBaseUrl}${path}`;

const getHtmlCompetitionErrorMessage = (response: Response, fallbackMessage: string) =>
    response.status === 404
        ? 'Competition API route was not found. Make sure /api/competitions is deployed and reachable.'
        : 'Competition API returned HTML instead of JSON. Make sure the backend route /api/competitions is running and reachable.';

const parseCompetitionError = async (response: Response, fallbackMessage: string) => {
    const contentType = response.headers.get('content-type') || '';

    try {
        if (contentType.includes('application/json')) {
            const payload = (await response.json()) as { error?: string; message?: string };
            return payload.error || payload.message || fallbackMessage;
        }

        const text = await response.text();
        const htmlLike = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');

        if (htmlLike) {
            return getHtmlCompetitionErrorMessage(response, fallbackMessage);
        }

        return text || fallbackMessage;
    } catch {
        return fallbackMessage;
    }
};

const parseCompetitionJson = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        const text = await response.text().catch(() => '');
        const htmlLike = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');

        throw new Error(
            htmlLike
                ? getHtmlCompetitionErrorMessage(response, fallbackMessage)
                : fallbackMessage
        );
    }

    try {
        return (await response.json()) as T;
    } catch {
        throw new Error(fallbackMessage);
    }
};

const toCompetitionErrorMessage = (error: unknown, fallbackMessage: string) => {
    if (error instanceof TypeError) {
        return 'Competition service is unavailable. Start the backend server on port 8000 and try again.';
    }

    if (error instanceof Error) {
        if (error.message) {
            return error.message;
        }
    }

    return fallbackMessage;
};

type UseCompetitionState = {
    competition: CompetitionRecord | null;
    participantSnapshot: ParticipantSnapshot | null;
    isLoading: boolean;
    isJoining: boolean;
    isRefreshingBalance: boolean;
    error: string | null;
};

export const useCompetition = (slug = DEFAULT_COMPETITION_SLUG) => {
    const [state, setState] = useState<UseCompetitionState>({
        competition: null,
        participantSnapshot: null,
        isLoading: true,
        isJoining: false,
        isRefreshingBalance: false,
        error: null,
    });

    const participantId = typeof window !== 'undefined' ? localStorage.getItem(storageKey(slug)) : null;

    const refreshCompetition = async () => {
        setState(prev => ({ ...prev, isLoading: true, error: null }));

        try {
            const competitionResponse = await fetch(buildCompetitionUrl(`/competitions/${slug}`));

            if (!competitionResponse.ok) {
                throw new Error(await parseCompetitionError(competitionResponse, 'Unable to load the competition.'));
            }

            const competitionPayload = await parseCompetitionJson<CompetitionRecord>(
                competitionResponse,
                'Competition response could not be read.'
            );

            let participantSnapshot = state.participantSnapshot;

            if (participantId) {
                const participantResponse = await fetch(
                    buildCompetitionUrl(`/competitions/${slug}/participants/${participantId}`)
                );
                if (participantResponse.ok) {
                    participantSnapshot = await parseCompetitionJson<ParticipantSnapshot>(
                        participantResponse,
                        'Participant snapshot response could not be read.'
                    );
                }
            }

            setState(prev => ({
                ...prev,
                competition: competitionPayload as CompetitionRecord,
                participantSnapshot,
                isLoading: false,
                error: null,
            }));
        } catch (error) {
            setState(prev => ({
                ...prev,
                isLoading: false,
                error: toCompetitionErrorMessage(
                    error,
                    'Unable to load the competition. Check that the competition backend is running.'
                ),
            }));
        }
    };

    useEffect(() => {
        void refreshCompetition();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]);

    const createPendingProfile = async (username: string) => {
        setState(prev => ({ ...prev, isJoining: true, error: null }));

        try {
            const response = await fetch(buildCompetitionUrl(`/competitions/${slug}/join`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username }),
            });

            if (!response.ok) {
                throw new Error(
                    await parseCompetitionError(response, 'Unable to create your competition profile.')
                );
            }

            const payload = await parseCompetitionJson<ParticipantSnapshot>(
                response,
                'Competition profile response could not be read.'
            );

            localStorage.setItem(storageKey(slug), payload.participant.id);
            setState(prev => ({
                ...prev,
                participantSnapshot: payload as ParticipantSnapshot,
                isJoining: false,
            }));
            await refreshCompetition();
            return payload as ParticipantSnapshot;
        } catch (error) {
            const message = toCompetitionErrorMessage(
                error,
                'Unable to create your competition profile. Check that the competition backend is running.'
            );
            setState(prev => ({ ...prev, isJoining: false, error: message }));
            throw error;
        }
    };

    const connectAccount = async ({
        participantId: currentParticipantId,
        accountId,
        accountCurrency,
        currentBalance,
    }: {
        participantId: string;
        accountId: string;
        accountCurrency: string;
        currentBalance: number;
    }) => {
        setState(prev => ({ ...prev, isJoining: true, error: null }));

        try {
            const response = await fetch(
                buildCompetitionUrl(`/competitions/${slug}/participants/${currentParticipantId}/connect-account`),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accountId, accountCurrency, currentBalance }),
                }
            );

            if (!response.ok) {
                throw new Error(await parseCompetitionError(response, 'Unable to connect this Deriv account.'));
            }

            const payload = await parseCompetitionJson<ParticipantSnapshot>(
                response,
                'Competition account response could not be read.'
            );

            setState(prev => ({
                ...prev,
                participantSnapshot: payload as ParticipantSnapshot,
                isJoining: false,
            }));
            await refreshCompetition();
            return payload as ParticipantSnapshot;
        } catch (error) {
            const message = toCompetitionErrorMessage(
                error,
                'Unable to connect this Deriv account. Check that the competition backend is running.'
            );
            setState(prev => ({ ...prev, isJoining: false, error: message }));
            throw error;
        }
    };

    const refreshParticipantBalance = async ({
        participantId: currentParticipantId,
        accountId,
        currentBalance,
    }: {
        participantId: string;
        accountId: string;
        currentBalance: number;
    }) => {
        setState(prev => ({ ...prev, isRefreshingBalance: true, error: null }));

        try {
            const response = await fetch(
                buildCompetitionUrl(`/competitions/${slug}/participants/${currentParticipantId}/balance`),
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ accountId, currentBalance }),
                }
            );

            if (!response.ok) {
                throw new Error(await parseCompetitionError(response, 'Unable to refresh your competition balance.'));
            }

            const payload = await parseCompetitionJson<ParticipantSnapshot>(
                response,
                'Competition balance response could not be read.'
            );

            setState(prev => ({
                ...prev,
                participantSnapshot: payload as ParticipantSnapshot,
                isRefreshingBalance: false,
            }));
            await refreshCompetition();
        } catch (error) {
            const message = toCompetitionErrorMessage(
                error,
                'Unable to refresh your competition balance. Check that the competition backend is running.'
            );
            setState(prev => ({ ...prev, isRefreshingBalance: false, error: message }));
            throw error;
        }
    };

    const runAdminAction = async (competitionId: string, action: string) => {
        setState(prev => ({ ...prev, isJoining: true, error: null }));
        try {
            const response = await fetch(buildCompetitionUrl(`/competitions/${competitionId}/admin/action`), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action }),
            });

            if (!response.ok) {
                throw new Error(await parseCompetitionError(response, 'Unable to complete the admin action.'));
            }

            const payload = await parseCompetitionJson<{ competition: CompetitionRecord }>(
                response,
                'Competition admin response could not be read.'
            );

            setState(prev => ({
                ...prev,
                competition: payload.competition as CompetitionRecord,
                isJoining: false,
            }));
            await refreshCompetition();
        } catch (error) {
            const message = toCompetitionErrorMessage(
                error,
                'Unable to complete the admin action. Check that the competition backend is running.'
            );
            setState(prev => ({ ...prev, isJoining: false, error: message }));
            throw error;
        }
    };

    return {
        ...state,
        refreshCompetition,
        createPendingProfile,
        connectAccount,
        refreshParticipantBalance,
        runAdminAction,
        participantId,
    };
};
