import type { CompetitionRecord } from '@/features/competition/types/competition.types';

const formatDate = (value?: string | null) => {
    if (!value) {
        return '1 July 2026 8:00 AM';
    }

    return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'long',
        timeStyle: 'short',
    }).format(new Date(value));
};

type CompetitionHeaderProps = {
    competition: CompetitionRecord | null;
};

const CompetitionHeader = ({ competition }: CompetitionHeaderProps) => {
    const status = competition?.status || 'registration';

    return (
        <section className='competition-page__hero competition-card'>
            <div className='competition-page__hero-copy'>
                <span className={`competition-status competition-status--${status}`}>
                    {status === 'live' ? 'Live now' : status}
                </span>
                <h1>Competition</h1>
                <p>
                    Join the Mr Chris competition, connect one verified real Deriv account, and climb the
                    leaderboard using adjusted growth instead of raw balance jumps.
                </p>
            </div>

            <div className='competition-page__hero-metrics'>
                <div>
                    <span>Start date</span>
                    <strong>{formatDate(competition?.starts_at)}</strong>
                </div>
                <div>
                    <span>Participants</span>
                    <strong>{competition?.participants_count ?? 0}</strong>
                </div>
                <div>
                    <span>Prize</span>
                    <strong>{competition?.prize_info || 'Prize pool and featured placement'}</strong>
                </div>
            </div>
        </section>
    );
};

export default CompetitionHeader;
