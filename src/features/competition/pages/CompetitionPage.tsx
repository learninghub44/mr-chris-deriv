import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import LeaderboardTable from '@/features/competition/components/LeaderboardTable';
import { useCompetition } from '@/features/competition/hooks/useCompetition';
import { useLeaderboard } from '@/features/competition/hooks/useLeaderboard';
import { getDerivCompetitionAuth } from '@/features/competition/services/deriv-auth';
import type { DerivCompetitionAccount } from '@/features/competition/types/competition.types';
import { useStore } from '@/hooks/useStore';
import '../styles/competition.scss';

const COMPETITION_API_UNAVAILABLE = 'Competition API route was not found.';

const CompetitionPage = observer(() => {
    const store = useStore();
    const derivAuth = useMemo(() => getDerivCompetitionAuth(store), [store]);
    const {
        competition,
        participantSnapshot,
        isLoading,
        isJoining,
        error,
        refreshCompetition,
        createPendingProfile,
        connectAccount,
    } = useCompetition();
    const { entries, isLoading: isLeaderboardLoading, error: leaderboardError } = useLeaderboard();
    const [availableAccounts, setAvailableAccounts] = useState<DerivCompetitionAccount[]>([]);
    const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
    const [username, setUsername] = useState('');
    const [formError, setFormError] = useState('');
    const combinedError = error || leaderboardError || '';
    const competitionApiUnavailable = combinedError.includes(COMPETITION_API_UNAVAILABLE);
    const leaderboardEmptyMessage = competitionApiUnavailable
        ? 'Competition is temporarily unavailable while the service is being deployed. Please check back shortly.'
        : 'No verified participants have appeared on the leaderboard yet.';

    useEffect(() => {
        if (!store?.client?.is_logged_in) {
            setAvailableAccounts([]);
            return;
        }

        derivAuth
            .getAccounts()
            .then(accounts => setAvailableAccounts(accounts.filter(account => derivAuth.isRealAccount(account))))
            .catch(() => setAvailableAccounts([]));
    }, [derivAuth, store?.client?.is_logged_in]);

    const handleCreateProfile = async () => {
        const normalized = username.trim().toLowerCase();

        if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
            setFormError('Use 3-20 chars: a-z, 0-9, _');
            return;
        }

        setFormError('');

        try {
            await createPendingProfile(normalized);
        } catch (createError) {
            setFormError(
                createError instanceof Error
                    ? createError.message
                    : 'Unable to create your competition profile right now.'
            );
        }
    };

    const handleConnectAccount = async (accountId: string) => {
        if (!participantSnapshot) {
            return;
        }

        try {
            const account = await derivAuth.connectAccount(accountId);
            const currentBalance = await derivAuth.getBalance(account.loginid);

            await connectAccount({
                participantId: participantSnapshot.participant.id,
                accountId: account.loginid,
                accountCurrency: account.currency,
                currentBalance,
            });
            setIsJoinModalOpen(false);
            setFormError('');
        } catch (connectError) {
            setFormError(
                connectError instanceof Error ? connectError.message : 'Unable to connect this Deriv account right now.'
            );
        }
    };

    const joinState = participantSnapshot?.participant.registration_status || 'not_joined';
    const showUsernameStep = !participantSnapshot;
    const showAccountStep = participantSnapshot?.participant.registration_status === 'pending';

    return (
        <div className='competition-page competition-page--fullscreen'>
            <div className='competition-shell'>
                <div className='competition-shell__topbar'>
                    <div className='competition-shell__title'>
                        <h2>Competition</h2>
                        {participantSnapshot ? (
                            <span className='competition-shell__status'>
                                {participantSnapshot.participant.username}
                                {participantSnapshot.participant.masked_account_id
                                    ? ` \u2022 ${participantSnapshot.participant.masked_account_id}`
                                    : ''}
                            </span>
                        ) : null}
                    </div>

                    <div className='competition-shell__actions'>
                        {participantSnapshot ? (
                            <span className={`competition-pill competition-pill--${joinState}`}>{joinState}</span>
                        ) : null}
                        <button
                            type='button'
                            className='competition-button competition-button--primary'
                            disabled={competitionApiUnavailable}
                            onClick={() => {
                                setFormError('');
                                setIsJoinModalOpen(true);
                            }}
                        >
                            {participantSnapshot ? 'Manage' : 'Join'}
                        </button>
                    </div>
                </div>

                <div className='competition-shell__body'>
                    {isLeaderboardLoading || isLoading ? (
                        <div className='competition-empty'>Loading...</div>
                    ) : (
                        <LeaderboardTable
                            entries={entries}
                            competitionIsLive={competition?.status === 'live'}
                            emptyMessage={leaderboardEmptyMessage}
                        />
                    )}
                    {combinedError ? (
                        <div className='competition-banner competition-banner--error'>
                            <strong>Competition error:</strong> {combinedError}
                            <button
                                type='button'
                                className='competition-button competition-button--secondary'
                                onClick={() => void refreshCompetition()}
                            >
                                Retry
                            </button>
                        </div>
                    ) : null}
                </div>
            </div>

            {isJoinModalOpen ? (
                <div className='competition-modal'>
                    <div className='competition-modal__backdrop' onClick={() => !isJoining && setIsJoinModalOpen(false)} />
                    <div className='competition-modal__panel'>
                        <div className='competition-modal__header'>
                            <h3>{participantSnapshot ? 'Join Competition' : 'Create Entry'}</h3>
                            <button
                                type='button'
                                className='competition-modal__close'
                                onClick={() => !isJoining && setIsJoinModalOpen(false)}
                            >
                                {'\u00D7'}
                            </button>
                        </div>

                        <div className='competition-modal__content'>
                            {!store?.client?.is_logged_in ? (
                                <div className='competition-empty'>Log in first.</div>
                            ) : null}
                            {competitionApiUnavailable ? (
                                <div className='competition-banner competition-banner--error'>
                                    Competition signup is temporarily unavailable while the API is being deployed.
                                </div>
                            ) : null}

                            {showUsernameStep && !competitionApiUnavailable ? (
                                <div className='competition-join-minimal'>
                                    <input
                                        value={username}
                                        onChange={event => {
                                            setUsername(event.target.value);
                                            if (formError) {
                                                setFormError('');
                                            }
                                        }}
                                        placeholder='username'
                                    />
                                    {formError || error ? (
                                        <div className='competition-banner competition-banner--error'>
                                            {formError || error}
                                        </div>
                                    ) : null}
                                    <button
                                        type='button'
                                        className='competition-button competition-button--primary'
                                        disabled={isJoining || !store?.client?.is_logged_in}
                                        onClick={() => void handleCreateProfile()}
                                    >
                                        {isJoining ? 'Saving...' : 'Continue'}
                                    </button>
                                </div>
                            ) : null}

                            {showAccountStep && !competitionApiUnavailable ? (
                                <div className='competition-account-list'>
                                    {availableAccounts.map(account => (
                                        <button
                                            key={account.loginid}
                                            type='button'
                                            className='competition-account-option'
                                            disabled={isJoining}
                                            onClick={() => void handleConnectAccount(account.loginid)}
                                        >
                                            <strong>{account.loginid}</strong>
                                            <span>{account.currency}</span>
                                        </button>
                                    ))}
                                    {formError || error ? (
                                        <div className='competition-banner competition-banner--error'>
                                            {formError || error}
                                        </div>
                                    ) : null}
                                    {!availableAccounts.length ? <div className='competition-empty'>No real account found.</div> : null}
                                </div>
                            ) : null}

                            {!showUsernameStep && !showAccountStep && participantSnapshot ? (
                                <div className='competition-empty'>
                                    {participantSnapshot.participant.username}
                                    {participantSnapshot.participant.masked_account_id
                                        ? ` \u2022 ${participantSnapshot.participant.masked_account_id}`
                                        : ''}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
});

export default CompetitionPage;
