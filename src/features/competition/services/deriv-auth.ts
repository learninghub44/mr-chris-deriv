import type { DerivCompetitionAccount } from '@/features/competition/types/competition.types';
import type RootStore from '@/stores/root-store';

type DerivAuthLike = {
    getAccounts: () => Promise<DerivCompetitionAccount[]>;
    connectAccount: (accountId: string) => Promise<DerivCompetitionAccount>;
    getBalance: (accountId: string) => Promise<number>;
    isRealAccount: (account: DerivCompetitionAccount) => boolean;
};

declare global {
    interface Window {
        derivAuth?: DerivAuthLike;
    }
}

const isRealAccount = (account: DerivCompetitionAccount) => !String(account.loginid || '').startsWith('VR');
const isEligibleRealAccount = (account: DerivCompetitionAccount) =>
    !account.is_virtual && !String(account.loginid || '').startsWith('VR');

export const getDerivCompetitionAuth = (store?: RootStore): DerivAuthLike => {
    if (window.derivAuth) {
        return window.derivAuth;
    }

    return {
        async getAccounts() {
            return (store?.client?.account_list || []) as DerivCompetitionAccount[];
        },
        async connectAccount(accountId: string) {
            const account = (store?.client?.account_list || []).find(item => item.loginid === accountId);
            if (!account) {
                throw new Error('Unable to find that Deriv account in your current session.');
            }
            return account as DerivCompetitionAccount;
        },
        async getBalance(accountId: string) {
            return Number(store?.client?.getDisplayBalanceAmount(accountId) || 0);
        },
        isRealAccount: isEligibleRealAccount,
    };
};
