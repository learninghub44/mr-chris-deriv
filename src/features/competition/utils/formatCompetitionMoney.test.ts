import { formatCompetitionMoney } from './formatCompetitionMoney';

describe('formatCompetitionMoney', () => {
    it('returns placeholder for missing values', () => {
        expect(formatCompetitionMoney(null, 'USD')).toBe('--');
        expect(formatCompetitionMoney(undefined, 'USD')).toBe('--');
    });

    it('formats fiat balances with Intl currency formatting', () => {
        expect(formatCompetitionMoney(12986.52, 'USD')).toBe('$12,986.52');
    });

    it('formats crypto-style Deriv currencies without throwing', () => {
        expect(formatCompetitionMoney(120.5, 'tUSDT')).toBe('120.50 tUSDT');
    });
});
