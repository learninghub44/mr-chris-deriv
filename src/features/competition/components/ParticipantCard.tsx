import type { ParticipantSnapshot } from '@/features/competition/types/competition.types';
import { formatCompetitionMoney } from '@/features/competition/utils/formatCompetitionMoney';
import { getDisplayMaskedLoginId } from '@/utils/account-helpers';

type ParticipantCardProps = {
    participantSnapshot: ParticipantSnapshot;
    canRefresh: boolean;
    isRefreshing: boolean;
    onRefreshBalance: () => Promise<void>;
};

const ParticipantCard = ({ participantSnapshot, canRefresh, isRefreshing, onRefreshBalance }: ParticipantCardProps) => {
    const { participant, result } = participantSnapshot;

    return (
        <section className='competition-card competition-participant'>
            <div className='competition-section-heading'>
                <div>
                    <h2>Your entry</h2>
                    <p>Competition profiles stay locked once registered, and full account IDs are never shown.</p>
                </div>
            </div>

            <dl className='competition-participant__details'>
                <div>
                    <dt>Username</dt>
                    <dd>{participant.username}</dd>
                </div>
                <div>
                    <dt>Account</dt>
                    <dd>{getDisplayMaskedLoginId(participant.masked_account_id || '') || 'Pending connection'}</dd>
                </div>
                <div>
                    <dt>Status</dt>
                    <dd>{participant.registration_status}</dd>
                </div>
                <div>
                    <dt>Current balance</dt>
                    <dd>{formatCompetitionMoney(result?.current_balance, participant.account_currency || 'USD')}</dd>
                </div>
            </dl>

            <div className='competition-participant__actions'>
                <p>Waiting to begin</p>
                {canRefresh ? (
                    <button
                        type='button'
                        className='competition-button competition-button--ghost'
                        onClick={() => void onRefreshBalance()}
                        disabled={isRefreshing}
                    >
                        {isRefreshing ? 'Refreshing...' : 'Refresh balance'}
                    </button>
                ) : null}
            </div>
        </section>
    );
};

export default ParticipantCard;
