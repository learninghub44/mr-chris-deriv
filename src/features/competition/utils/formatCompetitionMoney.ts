import { formatMoney, getCurrencyDisplayCode, isCryptocurrency } from '@/components/shared';

export const formatCompetitionMoney = (amount?: number | null, currency = 'USD') => {
    if (amount === null || amount === undefined) {
        return '--';
    }

    if (isCryptocurrency(currency)) {
        return `${formatMoney(currency, amount, true, 0, 0)} ${getCurrencyDisplayCode(currency)}`;
    }

    try {
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency,
            maximumFractionDigits: 2,
        }).format(amount);
    } catch {
        return `${formatMoney(currency, amount, true, 0, 0)} ${getCurrencyDisplayCode(currency)}`;
    }
};
