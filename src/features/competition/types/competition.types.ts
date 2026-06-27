export type CompetitionStatus =
    | 'draft'
    | 'registration'
    | 'locked'
    | 'live'
    | 'paused'
    | 'completed'
    | 'cancelled';

export type RegistrationStatus = 'pending' | 'verified' | 'rejected' | 'disqualified';

export type CompetitionRecord = {
    id: string;
    name: string;
    slug: string;
    status: CompetitionStatus;
    registration_opens_at: string | null;
    registration_closes_at: string | null;
    starts_at: string | null;
    ends_at: string | null;
    actual_started_at: string | null;
    actual_ended_at: string | null;
    actual_paused_at?: string | null;
    prize_info?: string | null;
    rules?: string | null;
    currency?: string | null;
    participants_count?: number | null;
    verified_participants_count?: number | null;
};

export type CompetitionParticipant = {
    id: string;
    competition_id: string;
    username: string;
    username_normalized?: string;
    masked_account_id: string | null;
    account_currency: string | null;
    is_real_account: boolean;
    is_account_verified: boolean;
    registration_status: RegistrationStatus;
    joined_at: string | null;
};

export type CompetitionResult = {
    id?: string;
    competition_id: string;
    participant_id: string;
    starting_balance: number | null;
    current_balance: number | null;
    deposits: number | null;
    withdrawals: number | null;
    adjusted_profit: number | null;
    growth_percentage: number | null;
    current_rank: number | null;
    previous_rank: number | null;
    last_balance_update_at: string | null;
};

export type LeaderboardEntry = {
    competition_id: string;
    participant_id: string;
    username: string;
    masked_account_id: string | null;
    account_currency: string | null;
    starting_balance: number | null;
    current_balance: number | null;
    adjusted_profit: number | null;
    growth_percentage: number | null;
    current_rank: number | null;
    previous_rank: number | null;
    last_balance_update_at: string | null;
};

export type ParticipantSnapshot = {
    participant: CompetitionParticipant;
    result: CompetitionResult | null;
};

export type DerivCompetitionAccount = {
    loginid: string;
    currency: string;
    balance?: number;
    current_balance?: number;
    is_virtual?: number;
    is_disabled?: number;
};
