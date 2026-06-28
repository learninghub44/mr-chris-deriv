import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import LeaderboardTable from '@/features/competition/components/LeaderboardTable';
import { useCompetition } from '@/features/competition/hooks/useCompetition';
import { useLeaderboard } from '@/features/competition/hooks/useLeaderboard';
import { getDerivCompetitionAuth } from '@/features/competition/services/deriv-auth';
import type { DerivCompetitionAccount } from '@/features/competition/types/competition.types';
import { useStore } from '@/hooks/useStore';
import { getDisplayLoginId } from '@/utils/account-helpers';
import '../styles/competition.scss';

const COMPETITION_API_UNAVAILABLE = 'Competition API route was not found.';
const MINIMUM_COMPETITION_BALANCE = 20;

type EligibleCompetitionAccount = DerivCompetitionAccount & {
    current_balance: number;
};

const getBelowMinimumBalanceMessage = (balance: number, currency: string) =>
    `Only eligible competition accounts above 20 USD can join the competition. Your current balance is ${currency} ${balance.toFixed(2)}. Top up and try again.`;

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
        resetParticipantEntry,
    } = useCompetition();
    const { entries, isLoading: isLeaderboardLoading, error: leaderboardError } = useLeaderboard();
    const [eligibleAccount, setEligibleAccount] = useState<EligibleCompetitionAccount | null>(null);
    const [bestRealAccountBalance, setBestRealAccountBalance] = useState<EligibleCompetitionAccount | null>(null);
    const [isJoinModalOpen, setIsJoinModalOpen] = useState(false);
    const [username, setUsername] = useState('');
    const [formError, setFormError] = useState('');
    const combinedError = error || leaderboardError || '';
    const competitionApiUnavailable = combinedError.includes(COMPETITION_API_UNAVAILABLE);
    const leaderboardEmptyMessage = competitionApiUnavailable
        ? 'Competition is temporarily unavailable while the service is being deployed. Please check back shortly.'
        : 'No verified participants have appeared on the leaderboard yet.';

    useEffect(() => {
        let isMounted = true;

        if (!store?.client?.is_logged_in) {
            setEligibleAccount(null);
            return;
        }

        const loadEligibleAccount = async () => {
            try {
                const accounts = await derivAuth.getAccounts();
                const realAccounts = accounts.filter(account => derivAuth.isRealAccount(account));
                const accountsWithBalances = await Promise.all(
                    realAccounts.map(async account => ({
                        ...account,
                        current_balance: Number(await derivAuth.getBalance(account.loginid)),
                    }))
                );

                const bestEligibleAccount =
                    accountsWithBalances
                        .filter(account => account.current_balance >= MINIMUM_COMPETITION_BALANCE)
                        .sort((left, right) => right.current_balance - left.current_balance)[0] || null;

                if (isMounted) {
                    setEligibleAccount(bestEligibleAccount);
                    setBestRealAccountBalance(
                        accountsWithBalances.sort((left, right) => right.current_balance - left.current_balance)[0] || null
                    );
                }
            } catch {
                if (isMounted) {
                    setEligibleAccount(null);
                    setBestRealAccountBalance(null);
                }
            }
        };

        void loadEligibleAccount();

        return () => {
            isMounted = false;
        };
    }, [derivAuth, store?.client?.is_logged_in]);

    const ineligibleBalanceMessage = bestRealAccountBalance
        ? getBelowMinimumBalanceMessage(bestRealAccountBalance.current_balance, bestRealAccountBalance.currency)
        : 'Only eligible competition accounts above 20 USD can join the competition. Top up and try again.';

    const handleCreateProfile = async () => {
        const normalized = username.trim().toLowerCase();

        if (!/^[a-z0-9_]{3,20}$/.test(normalized)) {
            setFormError('Use 3-20 chars: a-z, 0-9, _');
            return;
        }

        if (!eligibleAccount) {
            setFormError(ineligibleBalanceMessage);
            return;
        }

        setFormError('');

        try {
            const profile = await createPendingProfile(normalized);

            await connectAccount({
                participantId: profile.participant.id,
                accountId: eligibleAccount.loginid,
                accountCurrency: eligibleAccount.currency,
                currentBalance: eligibleAccount.current_balance,
            });

            setIsJoinModalOpen(false);
        } catch (createError) {
            setFormError(
                createError instanceof Error
                    ? createError.message
                    : 'Unable to create your competition profile right now.'
            );
        }
    };

    const handleConnectEligibleAccount = async () => {
        if (!participantSnapshot) {
            return;
        }

        if (!eligibleAccount) {
            setFormError(ineligibleBalanceMessage);
            return;
        }

        try {
            await connectAccount({
                participantId: participantSnapshot.participant.id,
                accountId: eligibleAccount.loginid,
                accountCurrency: eligibleAccount.currency,
                currentBalance: eligibleAccount.current_balance,
            });
            setIsJoinModalOpen(false);
            setFormError('');
        } catch (connectError) {
            setFormError(
                connectError instanceof Error ? connectError.message : 'Unable to connect this Deriv account right now.'
            );
        }
    };

    const handleResetEntry = async () => {
        if (!participantSnapshot) {
            return;
        }

        try {
            await resetParticipantEntry(participantSnapshot.participant.id);
            setFormError('');
            setUsername('');
            setIsJoinModalOpen(false);
        } catch (resetError) {
            setFormError(
                resetError instanceof Error ? resetError.message : 'Unable to reset this competition entry right now.'
            );
        }
    };

    const joinState = participantSnapshot?.participant.registration_status || 'not_joined';
    const showUsernameStep = !participantSnapshot;
    const showAccountStep = participantSnapshot?.participant.registration_status === 'pending';
    const ineligibleAccountMessage = store?.client?.is_logged_in
        ? ineligibleBalanceMessage
        : 'Log in with an eligible Deriv account above 20 USD to join the competition.';

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
                                    ? ` - ${participantSnapshot.participant.masked_account_id}`
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
                            className='competition-button competition-button--primary competition-shell__manage-button'
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
                                onClick={() => void refreshCompetition({ silent: true })}
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
                            <h3>{participantSnapshot ? 'Competition entry' : 'Create Entry'}</h3>
                            <button
                                type='button'
                                className='competition-modal__close'
                                onClick={() => !isJoining && setIsJoinModalOpen(false)}
                            >
                                {'x'}
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
                                    <div className='competition-note'>
                                        {eligibleAccount
                                            ? `We'll automatically link your eligible account ${getDisplayLoginId(eligibleAccount.loginid)} (${eligibleAccount.currency} ${eligibleAccount.current_balance.toFixed(2)}).`
                                            : ineligibleAccountMessage}
                                    </div>
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
                                        className='competition-button competition-button--primary competition-button--full'
                                        disabled={isJoining || !store?.client?.is_logged_in || !eligibleAccount}
                                        onClick={() => void handleCreateProfile()}
                                    >
                                        {isJoining ? 'Saving...' : 'Join competition'}
                                    </button>
                                </div>
                            ) : null}

                            {showAccountStep && !competitionApiUnavailable ? (
                                <div className='competition-account-list'>
                                    <div className='competition-note'>
                                        {eligibleAccount
                                            ? `Only your eligible account ${getDisplayLoginId(eligibleAccount.loginid)} (${eligibleAccount.currency} ${eligibleAccount.current_balance.toFixed(2)}) can be linked.`
                                            : ineligibleAccountMessage}
                                    </div>
                                    {formError || error ? (
                                        <div className='competition-banner competition-banner--error'>
                                            {formError || error}
                                        </div>
                                    ) : null}
                                    <button
                                        type='button'
                                        className='competition-button competition-button--primary competition-button--full'
                                        disabled={isJoining || !eligibleAccount}
                                        onClick={() => void handleConnectEligibleAccount()}
                                    >
                                        {isJoining ? 'Linking...' : 'Link eligible account'}
                                    </button>
                                </div>
                            ) : null}

                            {!showUsernameStep && !showAccountStep && participantSnapshot ? (
                                <div className='competition-account-list'>
                                    <div className='competition-empty competition-empty--summary'>
                                        {participantSnapshot.participant.username}
                                        {participantSnapshot.participant.masked_account_id
                                            ? ` - ${participantSnapshot.participant.masked_account_id}`
                                            : ''}
                                    </div>
                                    <button
                                        type='button'
                                        className='competition-button competition-button--secondary competition-button--full'
                                        disabled={isJoining}
                                        onClick={() => void handleResetEntry()}
                                    >
                                        Reset entry
                                    </button>
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
