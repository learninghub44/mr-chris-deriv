import type { LeaderboardEntry } from '@/features/competition/types/competition.types';
import { formatCompetitionMoney } from '@/features/competition/utils/formatCompetitionMoney';
import { getDisplayMaskedLoginId } from '@/utils/account-helpers';

const formatGrowth = (growth?: number | null) => {
    if (growth === null || growth === undefined) {
        return '--';
    }

    return `${growth >= 0 ? '+' : ''}${growth.toFixed(2)}%`;
};

const getRankMovement = (currentRank?: number | null, previousRank?: number | null) => {
    if (!currentRank || !previousRank || currentRank === previousRank) {
        return '\u2022';
    }

    if (currentRank < previousRank) {
        return '\u25B2';
    }

    return '\u25BC';
};

type LeaderboardTableProps = {
    entries: LeaderboardEntry[];
    competitionIsLive: boolean;
    emptyMessage?: string;
};

const MAX_VISIBLE_ROWS = 50;
const AWARD_CUTOFF = 20;

const LeaderboardTable = ({ entries, competitionIsLive, emptyMessage = 'No competition entries yet.' }: LeaderboardTableProps) => {
    const visibleEntries = entries.slice(0, MAX_VISIBLE_ROWS);
    const fillerCount = Math.max(MAX_VISIBLE_ROWS - visibleEntries.length, 0);
    const hasEntries = visibleEntries.length > 0;

    return (
        <div className='competition-card competition-leaderboard competition-leaderboard--minimal'>
            <div className='competition-leaderboard__table-wrap'>
                <table className='competition-leaderboard__table'>
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Participant</th>
                            <th>Account</th>
                            {competitionIsLive ? (
                                <>
                                    <th>Start</th>
                                    <th>Current</th>
                                    <th>Profit</th>
                                    <th>Growth %</th>
                                </>
                            ) : (
                                <>
                                    <th>Current balance</th>
                                    <th>Growth %</th>
                                </>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {!hasEntries ? (
                            <tr className='competition-leaderboard__row--empty'>
                                <td
                                    className='competition-leaderboard__empty-cell'
                                    colSpan={competitionIsLive ? 7 : 5}
                                >
                                    <div className='competition-leaderboard__empty-state'>{emptyMessage}</div>
                                </td>
                            </tr>
                        ) : null}
                        {visibleEntries.map((entry, index) => {
                            const tone =
                                (entry.growth_percentage ?? 0) > 0
                                    ? 'positive'
                                    : (entry.growth_percentage ?? 0) < 0
                                      ? 'negative'
                                      : 'neutral';
                            const isAwardZone = index < AWARD_CUTOFF;

                            return (
                                <tr
                                    key={entry.participant_id}
                                    className={`competition-leaderboard__row--${tone}${isAwardZone ? ' competition-leaderboard__row--award' : ''}`}
                                >
                                    <td>
                                        <div className={`competition-rank competition-rank--${index + 1}`}>
                                            <strong>{entry.current_rank || index + 1}</strong>
                                            <span>{getRankMovement(entry.current_rank, entry.previous_rank)}</span>
                                        </div>
                                    </td>
                                    <td>{entry.username}</td>
                                    <td>{getDisplayMaskedLoginId(entry.masked_account_id || '') || 'Pending verification'}</td>
                                    {competitionIsLive ? (
                                        <>
                                            <td>{formatCompetitionMoney(entry.starting_balance, entry.account_currency || 'USD')}</td>
                                            <td>{formatCompetitionMoney(entry.current_balance, entry.account_currency || 'USD')}</td>
                                            <td className={`competition-metric competition-metric--${tone}`}>
                                                {formatCompetitionMoney(entry.adjusted_profit, entry.account_currency || 'USD')}
                                            </td>
                                            <td className={`competition-metric competition-metric--${tone}`}>
                                                {formatGrowth(entry.growth_percentage)}
                                            </td>
                                        </>
                                    ) : (
                                        <>
                                            <td>{formatCompetitionMoney(entry.current_balance, entry.account_currency || 'USD')}</td>
                                            <td className={`competition-metric competition-metric--${tone}`}>
                                                {formatGrowth(entry.growth_percentage)}
                                            </td>
                                        </>
                                    )}
                                </tr>
                            );
                        })}
                        {hasEntries
                            ? Array.from({ length: fillerCount }, (_, index) => {
                            const rank = visibleEntries.length + index + 1;
                            const isAwardZone = rank <= AWARD_CUTOFF;

                            return (
                                <tr
                                    key={`empty-row-${rank}`}
                                    className={`competition-leaderboard__row--empty${isAwardZone ? ' competition-leaderboard__row--award' : ''}`}
                                >
                                    <td>
                                        <div className='competition-rank'>
                                            <strong>{rank}</strong>
                                            <span>{'\u2022'}</span>
                                        </div>
                                    </td>
                                    <td>--</td>
                                    <td>--</td>
                                    {competitionIsLive ? (
                                        <>
                                            <td>--</td>
                                            <td>--</td>
                                            <td>--</td>
                                            <td>--</td>
                                        </>
                                    ) : (
                                        <>
                                            <td>--</td>
                                            <td>--</td>
                                        </>
                                    )}
                                </tr>
                            );
                        })
                            : null}
                    </tbody>
                </table>
            </div>

        </div>
    );
};

export default LeaderboardTable;
