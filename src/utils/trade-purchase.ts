import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { assertApiTokenScope } from '@/utils/api-token-permissions';
import type { Buy } from '@deriv/api-types';

type TTradeParameters = Record<string, number | string>;

type TBuyContractArgs = {
    parameters: TTradeParameters;
    price: number;
    source: string;
};

const throwApiError = (response: any, source: string) => {
    if (response?.error) {
        throw new Error(response.error.message || `${source} contract purchase failed.`);
    }
};

const isLegacyOAuthSession = () => {
    try {
        const active_loginid = localStorage.getItem('active_loginid');
        const accounts_list_raw = localStorage.getItem('accountsList');
        if (!active_loginid || !accounts_list_raw) return false;

        const accounts_list = JSON.parse(accounts_list_raw);
        return Boolean(accounts_list?.[active_loginid]);
    } catch {
        return false;
    }
};

const removeUndefinedFields = <T extends Record<string, any>>(fields: T): T =>
    Object.entries(fields).reduce((cleaned, [key, value]) => {
        if (value !== undefined && value !== null && value !== '') cleaned[key as keyof T] = value;
        return cleaned;
    }, {} as T);

const normalizeParameters = (parameters: TTradeParameters) => {
    const { symbol, underlying_symbol, ...rest } = parameters;
    const normalized_symbol = symbol || underlying_symbol;
    const symbol_field = normalized_symbol
        ? isLegacyOAuthSession()
            ? { symbol: normalized_symbol }
            : { underlying_symbol: normalized_symbol }
        : {};

    return removeUndefinedFields({ ...rest, ...symbol_field });
};

const ensureAuthorizedForTrading = async () => {
    if (api_base.is_authorized) return;

    await (api_base as any).authorizeAndSubscribe?.();

    if (!api_base.is_authorized) {
        throw new Error('Please log in to your Deriv account before trading.');
    }
};

export const buyContractForUi = async ({ parameters, price, source }: TBuyContractArgs): Promise<Buy> => {
    await ensureAuthorizedForTrading();
    assertApiTokenScope('trade');

    globalObserver.emit('bot.running');
    globalObserver.emit('bot.setPurchaseInProgress');

    const normalized_parameters = normalizeParameters(parameters);

    try {
        const proposal_response = await (api_base.api as any).send({
            proposal: 1,
            subscribe: 0,
            ...normalized_parameters,
        });
        throwApiError(proposal_response, source);

        const proposal = proposal_response?.proposal;
        if (!proposal?.id) {
            throw new Error(`${source} could not get a contract proposal.`);
        }

        const ask_price = Number(proposal.ask_price ?? price);
        globalObserver.emit('contract.status', {
            id: 'contract.purchase_sent',
            data: ask_price,
        });

        const buy_response = await (api_base.api as any).send({ buy: proposal.id, price: ask_price });
        throwApiError(buy_response, source);

        const buy = buy_response?.buy;
        if (buy) {
            globalObserver.emit('contract.status', {
                id: 'contract.purchase_received',
                data: buy.transaction_id,
                buy,
            });

            return buy;
        }
    } catch (proposal_error) {
        console.warn(`[${source}] Proposal buy failed, retrying with direct buy.`, proposal_error);
    }

    globalObserver.emit('contract.status', {
        id: 'contract.purchase_sent',
        data: price,
    });

    const direct_buy_response = await (api_base.api as any).send({
        buy: '1',
        price,
        parameters: normalized_parameters,
    });
    throwApiError(direct_buy_response, source);

    const buy = direct_buy_response?.buy;
    if (!buy) {
        throw new Error(`${source} did not receive a buy confirmation.`);
    }

    globalObserver.emit('contract.status', {
        id: 'contract.purchase_received',
        data: buy.transaction_id,
        buy,
    });

    return buy;
};

export const getContractSnapshot = (contract: Record<string, any>, fallback: Record<string, any> = {}) => ({
    ...fallback,
    buy_price: contract.buy_price ?? fallback.buy_price,
    contract_id: contract.contract_id ?? fallback.contract_id,
    transaction_ids: contract.transaction_ids ?? fallback.transaction_ids,
    date_start: contract.date_start ?? fallback.date_start,
    display_name: contract.display_name || contract.underlying || fallback.display_name,
    underlying_symbol: contract.underlying || contract.underlying_symbol || fallback.underlying_symbol,
    shortcode: contract.shortcode ?? fallback.shortcode,
    contract_type: contract.contract_type ?? fallback.contract_type,
    currency: contract.currency ?? fallback.currency,
    entry_spot: contract.entry_spot ?? contract.entry_tick_display_value ?? contract.entry_tick ?? fallback.entry_spot,
    entry_tick: contract.entry_tick ?? contract.entry_spot ?? fallback.entry_tick,
    entry_tick_time: contract.entry_tick_time ?? contract.entry_spot_time ?? fallback.entry_tick_time,
    exit_spot: contract.exit_spot ?? contract.exit_tick_display_value ?? contract.exit_tick ?? fallback.exit_spot,
    exit_tick: contract.exit_tick ?? contract.exit_spot ?? fallback.exit_tick,
    exit_tick_time: contract.exit_tick_time ?? contract.exit_spot_time ?? fallback.exit_tick_time,
    barrier: contract.barrier ?? fallback.barrier,
    sell_price: contract.sell_price ?? fallback.sell_price,
    bid_price: contract.bid_price ?? fallback.bid_price,
    profit: contract.is_sold ? contract.profit : (fallback.profit ?? 0),
    is_sold: Boolean(contract.is_sold ?? fallback.is_sold),
    status: contract.status ?? fallback.status,
});

export const emitContractSoldStatus = (contract: Record<string, any>) => {
    if (!contract?.is_sold) return;

    globalObserver.emit('contract.status', {
        id: 'contract.sold',
        data: contract.transaction_ids?.sell,
        contract,
    });
};
