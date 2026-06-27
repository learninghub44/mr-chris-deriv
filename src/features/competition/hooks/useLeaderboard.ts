import { useEffect, useState } from 'react';
import type { LeaderboardEntry } from '@/features/competition/types/competition.types';

type LeaderboardState = {
    entries: LeaderboardEntry[];
    isLoading: boolean;
    error: string | null;
};

const DEFAULT_COMPETITION_SLUG = 'giftbaris-2026-july';
const apiBaseUrl = '/api';

const buildCompetitionUrl = (path: string) => `${apiBaseUrl}${path}`;

const getHtmlCompetitionErrorMessage = (response: Response) =>
    response.status === 404
        ? 'Competition API route was not found. Make sure /api/competitions is deployed and reachable.'
        : 'Competition API returned HTML instead of JSON. Make sure the backend route /api/competitions is running and reachable.';

const parseLeaderboardError = async (response: Response, fallbackMessage: string) => {
    const contentType = response.headers.get('content-type') || '';

    try {
        if (contentType.includes('application/json')) {
            const payload = (await response.json()) as { error?: string; message?: string };
            return payload.error || payload.message || fallbackMessage;
        }

        const text = await response.text();
        const htmlLike = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');

        if (htmlLike) {
            return getHtmlCompetitionErrorMessage(response);
        }

        return text || fallbackMessage;
    } catch {
        return fallbackMessage;
    }
};

const parseLeaderboardJson = async <T>(response: Response, fallbackMessage: string): Promise<T> => {
    const contentType = response.headers.get('content-type') || '';

    if (!contentType.includes('application/json')) {
        const text = await response.text().catch(() => '');
        const htmlLike = text.trim().startsWith('<!DOCTYPE') || text.trim().startsWith('<html');

        throw new Error(
            htmlLike
                ? getHtmlCompetitionErrorMessage(response)
                : fallbackMessage
        );
    }

    try {
        return (await response.json()) as T;
    } catch {
        throw new Error(fallbackMessage);
    }
};

const toLeaderboardErrorMessage = (error: unknown, fallbackMessage: string) => {
    if (error instanceof TypeError) {
        return 'Competition service is unavailable. Check the deployed API and Supabase configuration, then refresh the page.';
    }

    if (error instanceof Error && error.message) {
        return error.message;
    }

    return fallbackMessage;
};

export const useLeaderboard = (slug = DEFAULT_COMPETITION_SLUG) => {
    const [state, setState] = useState<LeaderboardState>({
        entries: [],
        isLoading: true,
        error: null,
    });

    useEffect(() => {
        let isMounted = true;

        const fetchLeaderboard = async (options?: { silent?: boolean }) => {
            const silent = options?.silent;

            if (!silent) {
                setState(prev => ({ ...prev, isLoading: true, error: null }));
            }

            try {
                const response = await fetch(buildCompetitionUrl(`/competitions/${slug}/leaderboard`));

                if (!response.ok) {
                    throw new Error(
                        await parseLeaderboardError(response, 'Unable to load the competition leaderboard.')
                    );
                }

                const payload = await parseLeaderboardJson<{ entries?: LeaderboardEntry[] }>(
                    response,
                    'Competition leaderboard response could not be read.'
                );

                if (!isMounted) {
                    return;
                }

                setState({
                    entries: (payload.entries || []) as LeaderboardEntry[],
                    isLoading: false,
                    error: null,
                });
            } catch (error) {
                if (!isMounted) {
                    return;
                }

                setState(prev => ({
                    entries: silent ? prev.entries : [],
                    isLoading: false,
                    error: toLeaderboardErrorMessage(
                        error,
                        'Unable to load the competition leaderboard. Check that the competition API and Supabase backend are running.'
                    ),
                }));
            }
        };

        void fetchLeaderboard();
        const intervalId = window.setInterval(() => {
            void fetchLeaderboard({ silent: true });
        }, 15000);

        return () => {
            isMounted = false;
            window.clearInterval(intervalId);
        };
    }, [slug]);

    return state;
};
