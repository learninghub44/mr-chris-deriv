import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import ThemedScrollbars from '@/components/shared_ui/themed-scrollbars';
import { contract_stages } from '@/constants/contract-stage';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { SUPPORTED_VOLATILITY_MARKETS } from '@/utils/digit-strategy';
import { isExpectedStreamInterruption } from '@/utils/market-data';
import { buyContractForUi, normalizeTradeParameters, sellContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe } from '@/utils/websocket-handler';

type TAccumulatorMarket = {
    label: string;
    symbol: string;
};

type TTickSnapshot = {
    epoch: number;
    quote: number;
};

type THistoryMove = {
    className: 'high' | 'low' | 'medium';
    value: string;
};

type TProposalPreview = {
    askPrice: number;
    currency: string;
    maxPayout?: number;
    maxTicks?: number;
    message: string;
    minStake?: number;
    status: 'idle' | 'loading' | 'ready' | 'error';
    tickSizeBarrier?: number;
};

type TAutoCashoutSettings = {
    enabled: boolean;
    takeProfit: string;
    useServerTakeProfit: boolean;
};

const ACCUMULATOR_MARKETS: TAccumulatorMarket[] = SUPPORTED_VOLATILITY_MARKETS.map(({ label, symbol }) => ({
    label,
    symbol,
}));

const GROWTH_RATES = [
    { label: '1%', value: '0.01' },
    { label: '2%', value: '0.02' },
    { label: '3%', value: '0.03' },
    { label: '4%', value: '0.04' },
    { label: '5%', value: '0.05' },
];

const DEFAULT_STAKE = '1';
const DEFAULT_TAKE_PROFIT = '1';
const PROPOSAL_REFRESH_MS = 500;
const INITIAL_RETURN_PERCENT = 0;
const MAX_GRAPH_TICKS = 60;
const MAX_HISTORY_MOVES = 28;

const cleanMoneyInput = (value: string) => value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');

const formatMoney = (value: unknown, currency = 'USD') => {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return `0.00 ${currency}`;

    return `${amount.toFixed(2)} ${currency}`;
};

const getTickFromResponse = (data: any): TTickSnapshot | null => {
    const quote = Number(data?.tick?.quote);
    if (!Number.isFinite(quote)) return null;

    return {
        epoch: Number(data?.tick?.epoch) || Math.floor(Date.now() / 1000),
        quote,
    };
};

const getTickFromContract = (contract: Record<string, any>): TTickSnapshot | null => {
    const quote = Number(
        contract?.current_spot ??
            contract?.current_tick ??
            contract?.spot ??
            contract?.entry_tick ??
            contract?.entry_spot ??
            contract?.exit_tick ??
            contract?.exit_spot
    );
    if (!Number.isFinite(quote)) return null;

    return {
        epoch:
            Number(contract?.current_spot_time) ||
            Number(contract?.tick_time) ||
            Number(contract?.entry_tick_time) ||
            Number(contract?.exit_tick_time) ||
            Math.floor(Date.now() / 1000),
        quote,
    };
};

const appendTick = (ticks: TTickSnapshot[], tick: TTickSnapshot) => {
    const lastTick = ticks[ticks.length - 1];
    if (lastTick?.epoch === tick.epoch && lastTick.quote === tick.quote) return ticks;

    return [...ticks, tick].slice(-MAX_GRAPH_TICKS);
};

const getAccumulatorReturnPercent = (survivedTicks: number, growthRateValue: unknown) => {
    const ticks = Math.max(0, Math.floor(Number(survivedTicks) || 0));
    const rate = Number(growthRateValue);
    if (!Number.isFinite(rate) || rate <= 0 || ticks <= 0) return 0;

    return Number(((Math.pow(1 + rate, ticks) - 1) * 100).toFixed(2));
};

const hasAccumulatorBarrierBreakout = (quote: number, entryQuote: number, tickSizeBarrier: unknown) => {
    const barrier = Number(tickSizeBarrier);
    if (!Number.isFinite(quote) || !Number.isFinite(entryQuote) || !Number.isFinite(barrier) || barrier <= 0) {
        return false;
    }

    return quote >= entryQuote + barrier || quote <= entryQuote - barrier;
};

const classifyMove = (value: number): THistoryMove['className'] => {
    if (value >= 1) return 'high';
    if (value >= 0.25) return 'medium';
    return 'low';
};

const formatPercent = (value: unknown) => {
    const percent = Number(value);
    if (!Number.isFinite(percent)) return '0.00%';

    return `${percent.toFixed(2)}%`;
};

const getFirstFiniteNumber = (...values: unknown[]) => {
    for (const value of values) {
        const numberValue = Number(value);
        if (Number.isFinite(numberValue) && numberValue > 0) return numberValue;
    }

    return undefined;
};

const getProposalTickSizeBarrier = (proposal: any) =>
    getFirstFiniteNumber(
        proposal?.contract_details?.tick_size_barrier,
        proposal?.contract_details?.barrier_spot_distance,
        proposal?.contract_details?.barrier_offset,
        proposal?.tick_size_barrier,
        proposal?.barrier_spot_distance,
        proposal?.barrier_offset,
        Math.abs(Number(proposal?.contract_details?.high_barrier) - Number(proposal?.spot)),
        Math.abs(Number(proposal?.spot) - Number(proposal?.contract_details?.low_barrier)),
        Math.abs(Number(proposal?.high_barrier) - Number(proposal?.spot)),
        Math.abs(Number(proposal?.spot) - Number(proposal?.low_barrier))
    );

const getReturnPercent = (cashoutValue: unknown, buyValue: unknown) => {
    const cashout = Number(cashoutValue);
    const buy = Number(buyValue);
    if (!Number.isFinite(cashout) || !Number.isFinite(buy) || buy <= 0) return 0;

    return Number((((cashout - buy) / buy) * 100).toFixed(2));
};

const buildHistoryMoves = (ticks: TTickSnapshot[], tickSizeBarrier: unknown, growthRateValue: unknown): THistoryMove[] => {
    if (ticks.length < 2) return [];

    let entryQuote = ticks[0].quote;
    let survivedTicks = 0;

    return ticks
        .slice(1)
        .reduce<THistoryMove[]>((moves, tick) => {
            if (hasAccumulatorBarrierBreakout(tick.quote, entryQuote, tickSizeBarrier)) {
                const value = getAccumulatorReturnPercent(survivedTicks, growthRateValue);
                moves.push({
                    className: classifyMove(value),
                    value: formatPercent(value),
                });
                entryQuote = tick.quote;
                survivedTicks = 0;
                return moves;
            }

            survivedTicks += 1;
            return moves;
        }, [])
        .slice(-MAX_HISTORY_MOVES);
};

const Accumilatoirs = observer(() => {
    const { client, dashboard, run_panel, summary_card, transactions, ui } = useStore();
    const { active_tab } = dashboard;
    const showAccumilatoirs = active_tab === DBOT_TABS.ACCUMILATOIRS;
    const currency = client.currency || 'USD';

    const [selectedSymbol, setSelectedSymbol] = useState(ACCUMULATOR_MARKETS[0]?.symbol ?? 'R_100');
    const [stakeInput, setStakeInput] = useState(DEFAULT_STAKE);
    const [growthRate, setGrowthRate] = useState(GROWTH_RATES[0].value);
    const [autoCashout, setAutoCashout] = useState<TAutoCashoutSettings>({
        enabled: true,
        takeProfit: DEFAULT_TAKE_PROFIT,
        useServerTakeProfit: true,
    });
    const [proposalPreview, setProposalPreview] = useState<TProposalPreview>({
        askPrice: 0,
        currency,
        message: 'Enter stake to quote accumulator.',
        status: 'idle',
    });
    const [latestTick, setLatestTick] = useState<TTickSnapshot | null>(null);
    const [tickHistory, setTickHistory] = useState<TTickSnapshot[]>([]);
    const [marketSurvivedTicks, setMarketSurvivedTicks] = useState(0);
    const [isLive, setIsLive] = useState(false);
    const [isMarketLoading, setIsMarketLoading] = useState(false);
    const [isPurchasing, setIsPurchasing] = useState(false);
    const [isCashingOut, setIsCashingOut] = useState(false);
    const [openContract, setOpenContract] = useState<Record<string, any> | null>(null);
    const [queuedPurchase, setQueuedPurchase] = useState(false);
    const [autoTradeEnabled, setAutoTradeEnabled] = useState(false);
    const [roundStatus, setRoundStatus] = useState<'flew' | 'running'>('running');
    const [outcomeHistory, setOutcomeHistory] = useState<THistoryMove[]>([]);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const tickSubscriptionRef = useRef<{ unsubscribe?: () => void } | null>(null);
    const contractAbortRef = useRef<AbortController | null>(null);
    const openContractRef = useRef<Record<string, any> | null>(null);
    const cashoutInFlightRef = useRef(false);
    const cashoutRequestedRef = useRef(false);
    const autoCashoutRef = useRef(autoCashout);
    const queuedPurchaseRef = useRef(false);
    const autoTradeEnabledRef = useRef(false);
    const executePurchaseRef = useRef<(() => void) | null>(null);
    const hasOpenContractRef = useRef(false);
    const roundStatusRef = useRef<'flew' | 'running'>('running');
    const proposalBarrierRef = useRef<number | undefined>(undefined);
    const marketEntryQuoteRef = useRef<number | null>(null);
    const marketSurvivedTicksRef = useRef(0);

    const selectedMarket = useMemo(
        () => ACCUMULATOR_MARKETS.find(market => market.symbol === selectedSymbol) ?? ACCUMULATOR_MARKETS[0],
        [selectedSymbol]
    );
    const growthRatePercent = Number(growthRate) * 100;
    const stake = Number(stakeInput);
    const currentProfit = Number(openContract?.profit ?? 0);
    const bidPrice = Number(openContract?.bid_price ?? openContract?.sell_price ?? 0);
    const buyPrice = Number(openContract?.buy_price ?? 0);
    const cashoutValue = Number(openContract?.bid_price ?? openContract?.sell_price ?? openContract?.payout ?? 0);
    const contractStatus = String(openContract?.status || '').toLowerCase();
    const hasClosedContract = Boolean(openContract?.is_sold) || ['sold', 'won', 'lost'].includes(contractStatus);
    const hasCrashed = hasClosedContract && (contractStatus === 'lost' || currentProfit < 0);
    const hasWon = hasClosedContract && !hasCrashed;
    const hasOpenContract = Boolean(openContract?.contract_id && !openContract?.is_sold);
    const canTrade = !isPurchasing && Number.isFinite(stake) && stake > 0;
    const historyMoves = useMemo(
        () =>
            outcomeHistory.length
                ? outcomeHistory.slice(-MAX_HISTORY_MOVES)
                : buildHistoryMoves(tickHistory, proposalPreview.tickSizeBarrier, growthRate),
        [growthRate, outcomeHistory, proposalPreview.tickSizeBarrier, tickHistory]
    );
    const marketReturnPercent = useMemo(
        () => getAccumulatorReturnPercent(marketSurvivedTicks, growthRate),
        [growthRate, marketSurvivedTicks]
    );
    const contractReturnPercent =
        buyPrice > 0 && cashoutValue > 0
            ? getReturnPercent(cashoutValue, buyPrice)
            : buyPrice > 0
              ? Number(((currentProfit / buyPrice) * 100).toFixed(2))
              : null;
    const displayReturnPercent = contractReturnPercent ?? marketReturnPercent;
    const graphTicks = useMemo(() => tickHistory.slice(-36), [tickHistory]);
    const graphPosition = useMemo(() => {
        const width = 1000;
        const height = 500;
        const progress = hasOpenContract
            ? Math.max(0.02, Math.min(Math.max(displayReturnPercent, 0) / 200, 1))
            : Math.max(0.08, Math.min(graphTicks.length / 36, 1));
        const hasGraphTicks = graphTicks.length >= 2;
        const quotes = graphTicks.map(tick => tick.quote);
        const minQuote = Math.min(...quotes);
        const maxQuote = Math.max(...quotes);
        const quoteRange = Math.max(maxQuote - minQuote, 0.000001);
        const endX = 80 + progress * (width - 160);
        const latestQuote = quotes[quotes.length - 1] ?? 0;
        const normalizedLatest = hasGraphTicks ? (latestQuote - minQuote) / quoteRange : progress;
        const movementY = height - 72 - normalizedLatest * (height - 180);
        const payoutY = height - 60 - progress * (height - 160);
        const endY = hasOpenContract ? payoutY : movementY;
        const cx1 = 80 + (endX - 80) * 0.55;
        const cy1 = height - 60;
        const cx2 = endX - (endX - 80) * 0.15;
        const cy2 = endY + (height - 60 - endY) * 0.55;
        const linePath = `M 80 ${height - 60} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${endX} ${endY}`;

        return {
            areaPath: `${linePath} L ${endX} ${height - 60} L 80 ${height - 60} Z`,
            linePath,
            planeX: endX,
            planeY: endY,
        };
    }, [displayReturnPercent, graphTicks, hasOpenContract]);

    useEffect(() => {
        openContractRef.current = openContract;
    }, [openContract]);

    useEffect(() => {
        hasOpenContractRef.current = hasOpenContract;
    }, [hasOpenContract]);

    useEffect(() => {
        autoCashoutRef.current = autoCashout;
    }, [autoCashout]);

    useEffect(() => {
        queuedPurchaseRef.current = queuedPurchase;
    }, [queuedPurchase]);

    useEffect(() => {
        autoTradeEnabledRef.current = autoTradeEnabled;
    }, [autoTradeEnabled]);

    useEffect(() => {
        roundStatusRef.current = roundStatus;
    }, [roundStatus]);

    useEffect(() => {
        proposalBarrierRef.current = proposalPreview.tickSizeBarrier;
    }, [proposalPreview.tickSizeBarrier]);

    useEffect(() => {
        marketSurvivedTicksRef.current = marketSurvivedTicks;
    }, [marketSurvivedTicks]);

    const recordFlewAway = useCallback((move: number, useExactValue = false, triggerQueuedPurchase = true) => {
        const value = Number((useExactValue ? move : Math.max(move, INITIAL_RETURN_PERCENT)).toFixed(2));
        setOutcomeHistory(previous =>
            [...previous, { className: classifyMove(value), value: formatPercent(value) }].slice(-MAX_HISTORY_MOVES)
        );
        setRoundStatus('flew');

        window.setTimeout(() => {
            if (triggerQueuedPurchase && (queuedPurchaseRef.current || autoTradeEnabledRef.current) && executePurchaseRef.current) {
                executePurchaseRef.current();
                return;
            }
            setRoundStatus('running');
        }, 450);
    }, []);

    const pushContract = useCallback(
        (data: any) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {
                // Accumulator trading should keep running if an observer panel is unavailable.
            }
        },
        [run_panel, summary_card, transactions]
    );

    const buildAccumulatorParameters = useCallback(() => {
        const takeProfit = Number(autoCashout.takeProfit);
        const shouldUseServerTakeProfit =
            autoCashout.enabled && autoCashout.useServerTakeProfit && Number.isFinite(takeProfit) && takeProfit > 0;

        return {
            amount: Number(stakeInput),
            basis: 'stake',
            contract_type: 'ACCU',
            currency,
            growth_rate: Number(growthRate),
            symbol: selectedSymbol,
            limit_order: shouldUseServerTakeProfit
                ? {
                      take_profit: Number(takeProfit.toFixed(2)),
                  }
                : undefined,
        };
    }, [autoCashout.enabled, autoCashout.takeProfit, autoCashout.useServerTakeProfit, currency, growthRate, selectedSymbol, stakeInput]);

    const cashoutContract = useCallback(
        async (reason = 'Manual cashout') => {
            const contractId = openContractRef.current?.contract_id;
            if (!contractId || cashoutInFlightRef.current) return;

            cashoutInFlightRef.current = true;
            setIsCashingOut(true);
            cashoutRequestedRef.current = true;
            setError('');
            setMessage(`${reason} requested...`);

            try {
                const sell = await sellContractForUi({
                    contractId,
                    price: 0,
                    source: 'Accumilatoirs',
                });
                setMessage(`Cashout accepted at ${formatMoney(sell.sold_for, currency)}.`);
            } catch (cashoutError) {
                setError(cashoutError instanceof Error ? cashoutError.message : 'Could not cash out this accumulator.');
            } finally {
                setIsCashingOut(false);
                cashoutInFlightRef.current = false;
            }
        },
        [currency]
    );

    const maybeAutoCashout = useCallback(
        (snapshot: Record<string, any>) => {
            if (!snapshot?.contract_id || snapshot?.is_sold || cashoutInFlightRef.current) return;

            const settings = autoCashoutRef.current;
            if (!settings.enabled) return;

            const profit = Number(snapshot.profit ?? 0);
            const takeProfit = Number(settings.takeProfit);

            if (Number.isFinite(takeProfit) && takeProfit > 0 && profit >= takeProfit) {
                void cashoutContract('Automated take profit');
            }
        },
        [cashoutContract]
    );

    const cleanupContractStream = useCallback(() => {
        contractAbortRef.current?.abort();
        contractAbortRef.current = null;
    }, []);

    const stopAccumulator = useCallback(async () => {
        setAutoTradeEnabled(false);
        setQueuedPurchase(false);
        autoTradeEnabledRef.current = false;
        queuedPurchaseRef.current = false;
        if (openContractRef.current?.contract_id && !openContractRef.current?.is_sold) {
            await cashoutContract('Navigation cashout');
        }
        cleanupContractStream();
        setOpenContract(null);
        dashboard.setActiveTradingModule(null);
        try {
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract?.(false);
            run_panel.setContractStage?.(contract_stages.NOT_RUNNING);
            api_base.setIsRunning?.(false);
        } catch {
            // Optional run panel cleanup only.
        }
    }, [cashoutContract, cleanupContractStream, dashboard, run_panel]);

    useEffect(() => {
        dashboard.registerTradingStopHandler('accumilatoirs', stopAccumulator);

        return () => {
            dashboard.unregisterTradingStopHandler('accumilatoirs');
        };
    }, [dashboard, stopAccumulator]);

    useEffect(() => {
        if (!showAccumilatoirs) return undefined;

        let isMounted = true;
        setIsMarketLoading(true);

        const requestTickHistory = async () => {
            try {
                const response = await (api_base.api as any)?.send?.({
                    ticks_history: selectedSymbol,
                    adjust_start_time: 1,
                    count: MAX_GRAPH_TICKS,
                    end: 'latest',
                    style: 'ticks',
                });

                const times = response?.history?.times ?? [];
                const prices = response?.history?.prices ?? [];
                const historyTicks = prices
                    .map((price: string | number, index: number) => ({
                        epoch: Number(times[index]) || Math.floor(Date.now() / 1000) - prices.length + index,
                        quote: Number(price),
                    }))
                    .filter((tick: TTickSnapshot) => Number.isFinite(tick.quote));

                if (isMounted && historyTicks.length) {
                    setTickHistory(historyTicks.slice(-MAX_GRAPH_TICKS));
                    setLatestTick(historyTicks[historyTicks.length - 1]);
                    marketEntryQuoteRef.current = historyTicks[historyTicks.length - 1].quote;
                    marketSurvivedTicksRef.current = 0;
                    setMarketSurvivedTicks(0);
                }
            } catch (historyError) {
                if (isMounted) {
                    console.warn('[Accumilatoirs] Tick history is not available yet.', historyError);
                }
            } finally {
                if (isMounted) {
                    setIsMarketLoading(false);
                }
            }
        };

        void requestTickHistory();

        try {
            tickSubscriptionRef.current?.unsubscribe?.();
        } catch {
            // safeSubscribe handles stream errors; ignore stale unsubscribe failures.
        }

        setIsLive(false);
        const observable = (api_base.api as any)?.subscribe?.({
            ticks: selectedSymbol,
            subscribe: 1,
        });

        tickSubscriptionRef.current = safeSubscribe(
            observable,
            (data: any) => {
                const tick = getTickFromResponse(data);
                if (!tick) return;

                setLatestTick(tick);
                setTickHistory(previousTicks => {
                    const barrier = Number(proposalBarrierRef.current);
                    if (
                        !hasOpenContractRef.current &&
                        roundStatusRef.current === 'running' &&
                        Number.isFinite(barrier) &&
                        barrier > 0
                    ) {
                        if (!Number.isFinite(Number(marketEntryQuoteRef.current))) {
                            marketEntryQuoteRef.current = tick.quote;
                            marketSurvivedTicksRef.current = 0;
                            setMarketSurvivedTicks(0);
                        } else if (hasAccumulatorBarrierBreakout(tick.quote, Number(marketEntryQuoteRef.current), proposalBarrierRef.current)) {
                            recordFlewAway(getAccumulatorReturnPercent(marketSurvivedTicksRef.current, growthRate));
                            marketEntryQuoteRef.current = tick.quote;
                            marketSurvivedTicksRef.current = 0;
                            setMarketSurvivedTicks(0);
                        } else {
                            const nextSurvivedTicks = marketSurvivedTicksRef.current + 1;
                            marketSurvivedTicksRef.current = nextSurvivedTicks;
                            setMarketSurvivedTicks(nextSurvivedTicks);
                        }
                    }

                    return appendTick(previousTicks, tick);
                });
                setIsLive(true);
            },
            streamError => {
                setIsLive(false);
                if (!isExpectedStreamInterruption(streamError)) {
                    setError('Live tick stream is not available yet.');
                }
            }
        );

        return () => {
            isMounted = false;
            try {
                tickSubscriptionRef.current?.unsubscribe?.();
            } catch {
                // Ignore stale unsubscribe failures.
            }
            tickSubscriptionRef.current = null;
            setIsLive(false);
            setIsMarketLoading(false);
        };
    }, [growthRate, recordFlewAway, selectedSymbol, showAccumilatoirs]);

    useEffect(() => {
        if (!showAccumilatoirs) return undefined;

        const proposalVersion = window.setTimeout(async () => {
            if (!Number.isFinite(stake) || stake <= 0) {
                setProposalPreview({
                    askPrice: 0,
                    currency,
                    message: 'Enter a valid stake to quote accumulator.',
                    status: 'idle',
                });
                return;
            }

            if (!api_base.api) {
                setProposalPreview({
                    askPrice: stake,
                    currency,
                    message: 'Waiting for Deriv connection...',
                    status: 'loading',
                });
                return;
            }

            setProposalPreview(previous => ({
                ...previous,
                message: 'Quoting accumulator...',
                status: 'loading',
            }));

            try {
                const response = await (api_base.api as any).send({
                    proposal: 1,
                    subscribe: 0,
                    ...normalizeTradeParameters(buildAccumulatorParameters()),
                });

                if (response?.error) {
                    throw new Error(response.error.message || 'Accumulator proposal failed.');
                }

                const proposal = response?.proposal;
                setProposalPreview({
                    askPrice: Number(proposal?.ask_price ?? stake),
                    currency,
                    maxPayout: Number(proposal?.validation_params?.max_payout) || undefined,
                    maxTicks: Number(proposal?.validation_params?.max_ticks) || undefined,
                    message: proposal?.longcode || 'Accumulator is ready to buy.',
                    minStake: Number(proposal?.contract_details?.minimum_stake) || undefined,
                    status: 'ready',
                    tickSizeBarrier: getProposalTickSizeBarrier(proposal),
                });
            } catch (proposalError) {
                setProposalPreview({
                    askPrice: stake,
                    currency,
                    message: proposalError instanceof Error ? proposalError.message : 'Accumulator proposal failed.',
                    status: 'error',
                });
            }
        }, PROPOSAL_REFRESH_MS);

        return () => window.clearTimeout(proposalVersion);
    }, [buildAccumulatorParameters, currency, showAccumilatoirs, stake]);

    useEffect(
        () => () => {
            cleanupContractStream();
        },
        [cleanupContractStream]
    );

    const executePurchase = useCallback(async () => {
        if (!Number.isFinite(stake) || stake <= 0) {
            setError('Enter a valid stake before buying an accumulator.');
            return;
        }

        if (!api_base.api) {
            setError('Deriv connection is not ready yet.');
            return;
        }

        const tradeStartTime = Math.floor(Date.now() / 1000);
        const verificationId = `accu_${selectedSymbol}_${tradeStartTime}_${Math.random().toString(36).slice(2, 11)}`;
        const parameters = buildAccumulatorParameters();

        setError('');
        setMessage('Buying accumulator...');
        setIsPurchasing(true);
        setQueuedPurchase(false);
        setRoundStatus('running');
        queuedPurchaseRef.current = false;

        try {
            run_panel.setIsRunning(true);
            run_panel.setRunId(`accu-${Date.now()}`);
            run_panel.setContractStage?.(contract_stages.RUNNING);
            run_panel.toggleDrawer(true);
            run_panel.setHasOpenContract?.(true);
            dashboard.setActiveTradingModule('accumilatoirs');

            const buy = await buyContractForUi({ parameters, price: stake, source: 'Accumilatoirs' });
            const buySnapshot = {
                buy_price: buy.buy_price,
                contract_id: buy.contract_id,
                contract_type: 'ACCU',
                currency,
                date_start: tradeStartTime,
                display_name: selectedMarket?.label ?? selectedSymbol,
                growth_rate: Number(growthRate),
                shortcode: `ACCU_${selectedSymbol}_${growthRate}`,
                transaction_ids: { buy: buy.transaction_id },
                underlying_symbol: selectedSymbol,
                verification_id: verificationId,
            };

            setOpenContract(buySnapshot);
            pushContract(buySnapshot);
            setMessage('Accumulator is open. Watch profit or cash out manually.');

            cleanupContractStream();
            const abortController = new AbortController();
            contractAbortRef.current = abortController;

            void streamContractUntilSettled({
                contractId: buy.contract_id,
                fallback: buySnapshot,
                onUpdate: (snapshot, rawContract) => {
                    setOpenContract(snapshot);
                    const contractTick = getTickFromContract(rawContract);
                    if (contractTick) {
                        setLatestTick(contractTick);
                        setTickHistory(previousTicks => appendTick(previousTicks, contractTick));
                    }
                    pushContract(snapshot);
                    maybeAutoCashout(snapshot);
                },
                signal: abortController.signal,
                source: 'Accumilatoirs',
                timeoutMs: 180000,
            }).then(settledContract => {
                setOpenContract(settledContract);
                pushContract(settledContract);
                const profit = Number(settledContract.profit ?? 0);
                if (settledContract.is_sold) {
                    const wasCashoutRequested = cashoutRequestedRef.current;
                    const takeProfit = Number(autoCashoutRef.current.takeProfit);
                    const wasTakeProfitClose =
                        !wasCashoutRequested && Number.isFinite(takeProfit) && takeProfit > 0 && profit >= takeProfit;
                    cashoutRequestedRef.current = false;
                    const closedReturnPercent =
                        Number(settledContract.buy_price) > 0
                            ? Number(((profit / Number(settledContract.buy_price)) * 100).toFixed(2))
                            : displayReturnPercent;
                    if (wasCashoutRequested || wasTakeProfitClose) {
                        setOutcomeHistory(previous =>
                            [
                                ...previous,
                                { className: classifyMove(closedReturnPercent), value: formatPercent(closedReturnPercent) },
                            ].slice(-MAX_HISTORY_MOVES)
                        );
                        const shouldKeepWaitingForBreakout = autoTradeEnabledRef.current;
                        setRoundStatus('running');
                        setQueuedPurchase(shouldKeepWaitingForBreakout);
                        queuedPurchaseRef.current = shouldKeepWaitingForBreakout;
                        const closeReason = wasTakeProfitClose ? 'closed at take profit' : 'cashed out';
                        setMessage(
                            shouldKeepWaitingForBreakout
                                ? `Accumulator ${closeReason}. P/L: ${formatMoney(profit, currency)}. Waiting for the next barrier breakout.`
                                : `Accumulator ${closeReason}. P/L: ${formatMoney(profit, currency)}.`
                        );
                    } else {
                        recordFlewAway(closedReturnPercent, true);
                        setMessage(`Accumulator closed. P/L: ${formatMoney(profit, currency)}.`);
                    }
                    dashboard.setActiveTradingModule(null);
                    run_panel.setHasOpenContract?.(false);
                    run_panel.setContractStage?.(contract_stages.CONTRACT_CLOSED);
                }
            });
        } catch (purchaseError) {
            setMessage('');
            setError(purchaseError instanceof Error ? purchaseError.message : 'Could not buy accumulator.');
            dashboard.setActiveTradingModule(null);
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract?.(false);
            run_panel.setContractStage?.(contract_stages.NOT_RUNNING);
        } finally {
            setIsPurchasing(false);
        }
    }, [
        buildAccumulatorParameters,
        cleanupContractStream,
        currency,
        dashboard,
        growthRate,
        maybeAutoCashout,
        pushContract,
        run_panel,
        selectedMarket?.label,
        selectedSymbol,
        stake,
        displayReturnPercent,
        recordFlewAway,
    ]);

    useEffect(() => {
        executePurchaseRef.current = () => {
            void executePurchase();
        };
    }, [executePurchase]);

    const handleTradeAction = useCallback(async () => {
        if (hasOpenContract) {
            await cashoutContract();
            return;
        }

        if (roundStatus !== 'flew') {
            setQueuedPurchase(true);
            queuedPurchaseRef.current = true;
            setError('');
            setMessage('Waiting for breakout/flew away. Next accumulator will buy after the break.');
            return;
        }

        void executePurchase();
    }, [cashoutContract, executePurchase, hasOpenContract, roundStatus]);

    const handleStopAllTrades = useCallback(async () => {
        setAutoTradeEnabled(false);
        setQueuedPurchase(false);
        autoTradeEnabledRef.current = false;
        queuedPurchaseRef.current = false;
        setError('');

        if (hasOpenContract) {
            await cashoutContract('Stop all trades cashout');
            setMessage('Stop all trades requested. Auto trading is off.');
            return;
        }

        cleanupContractStream();
        setOpenContract(null);
        dashboard.setActiveTradingModule(null);
        run_panel.setIsRunning(false);
        run_panel.setHasOpenContract?.(false);
        run_panel.setContractStage?.(contract_stages.NOT_RUNNING);
        setMessage('All accumulator auto trading has been stopped.');
    }, [cashoutContract, cleanupContractStream, dashboard, hasOpenContract, run_panel]);

    const handleMarketChange = (symbol: string) => {
        setSelectedSymbol(symbol);
        setLatestTick(null);
        setTickHistory([]);
        setOutcomeHistory([]);
        setMarketSurvivedTicks(0);
        marketEntryQuoteRef.current = null;
        marketSurvivedTicksRef.current = 0;
        setQueuedPurchase(false);
        queuedPurchaseRef.current = false;
        setRoundStatus('running');
        setMessage('');
        setError('');
    };

    if (!showAccumilatoirs) return null;

    return (
        <div
            className={classNames('accumilatoirs-page', {
                'accumilatoirs-page--dark': ui.is_dark_mode_on,
            })}
        >
            <ThemedScrollbars className='accumilatoirs-page__scroll' autohide={false}>
                <div className='accumilatoirs-page__inner'>
                    <section className='accumilatoirs-crash'>
                        <div className='history-bar'>
                            <div className='history-scroll'>
                                {historyMoves.length ? (
                                    historyMoves.map((history, index) => (
                                        <span
                                            className={`history-value history-${history.className}`}
                                            key={`${history.value}-${index}`}
                                        >
                                            {history.value}
                                        </span>
                                    ))
                                ) : (
                                    <span className='history-value history-low'>
                                        {proposalPreview.tickSizeBarrier
                                            ? 'Waiting for barrier breakout...'
                                            : 'Waiting for Deriv barrier data...'}
                                    </span>
                                )}
                            </div>
                            <button className='history-menu' aria-label='menu' type='button'>
                                <span />
                                <span />
                                <span />
                            </button>
                        </div>

                        <div className='game-shell'>
                            <div
                                className={classNames('game-board', {
                                    'game-board--crashed': hasCrashed,
                                    'game-board--won': hasWon,
                                })}
                            >
                                <div className='background-rays' />
                                <div className='background-glow' />

                                <svg className='graph-svg' viewBox='0 0 1000 500' preserveAspectRatio='none'>
                                    <defs>
                                        <linearGradient id='accuAreaFill' x1='0' y1='0' x2='0' y2='1'>
                                            <stop offset='0%' stopColor='#ff0045' stopOpacity='0.45' />
                                            <stop offset='100%' stopColor='#ff0045' stopOpacity='0.02' />
                                        </linearGradient>
                                    </defs>
                                    <path className='graph-area' d={graphPosition.areaPath} fill='url(#accuAreaFill)' />
                                    <path className='graph-line' d={graphPosition.linePath} />
                                </svg>

                                <div
                                    className='plane-position'
                                    style={{
                                        left: `${(graphPosition.planeX / 1000) * 100}%`,
                                        top: `${(graphPosition.planeY / 500) * 100}%`,
                                    }}
                                >
                                    <svg
                                        className='crash-plane'
                                        viewBox='0 0 220 110'
                                        xmlns='http://www.w3.org/2000/svg'
                                    >
                                        <defs>
                                            <linearGradient id='accuFuse' x1='0' y1='0' x2='0' y2='1'>
                                                <stop offset='0%' stopColor='#ffffff' />
                                                <stop offset='45%' stopColor='#e6e9ee' />
                                                <stop offset='100%' stopColor='#9aa1ac' />
                                            </linearGradient>
                                            <linearGradient id='accuRedStripe' x1='0' y1='0' x2='1' y2='0'>
                                                <stop offset='0%' stopColor='#ff1a4d' />
                                                <stop offset='100%' stopColor='#b3002a' />
                                            </linearGradient>
                                            <linearGradient id='accuWing' x1='0' y1='0' x2='0' y2='1'>
                                                <stop offset='0%' stopColor='#cfd4dc' />
                                                <stop offset='100%' stopColor='#6b7280' />
                                            </linearGradient>
                                            <linearGradient id='accuWingBack' x1='0' y1='0' x2='0' y2='1'>
                                                <stop offset='0%' stopColor='#7a8290' />
                                                <stop offset='100%' stopColor='#3f4753' />
                                            </linearGradient>
                                            <radialGradient id='accuEngine' cx='0.3' cy='0.4' r='0.7'>
                                                <stop offset='0%' stopColor='#9ea4ad' />
                                                <stop offset='60%' stopColor='#3a3f47' />
                                                <stop offset='100%' stopColor='#0f1115' />
                                            </radialGradient>
                                            <radialGradient id='accuCockpit' cx='0.3' cy='0.3' r='0.8'>
                                                <stop offset='0%' stopColor='#b8e7ff' />
                                                <stop offset='60%' stopColor='#1f4c6b' />
                                                <stop offset='100%' stopColor='#0a1a26' />
                                            </radialGradient>
                                        </defs>

                                        <path d='M95 58 L175 92 L200 96 L150 70 Z' fill='url(#accuWingBack)' opacity='0.85' />
                                        <path d='M30 55 L18 18 L42 22 L55 58 Z' fill='url(#accuWing)' />
                                        <path d='M22 28 L40 30 L48 52 L34 52 Z' fill='#ff1a4d' opacity='0.9' />
                                        <path d='M30 58 L8 70 L26 72 L48 64 Z' fill='url(#accuWingBack)' />
                                        <path
                                            d='M30 50 C 60 38, 110 36, 160 44 C 185 47, 205 53, 212 58 C 205 63, 185 66, 160 67 C 110 71, 60 68, 30 60 Z'
                                            fill='url(#accuFuse)'
                                            stroke='#5b6470'
                                            strokeWidth='0.6'
                                        />
                                        <path
                                            d='M40 56 C 80 52, 140 52, 200 58 L 200 60 C 140 56, 80 56, 40 60 Z'
                                            fill='url(#accuRedStripe)'
                                        />
                                        <g fill='#1b2733'>
                                            {Array.from({ length: 14 }).map((_, index) => (
                                                <rect
                                                    height='3'
                                                    key={index}
                                                    rx='0.8'
                                                    width='4'
                                                    x={60 + index * 9}
                                                    y='48'
                                                />
                                            ))}
                                        </g>
                                        <path
                                            d='M198 54 C 205 54, 210 56, 211 58 C 208 59, 203 60, 196 60 Z'
                                            fill='url(#accuCockpit)'
                                        />
                                        <ellipse cx='210' cy='58' rx='3' ry='2' fill='#ffffff' opacity='0.4' />
                                        <path
                                            d='M90 60 L60 96 L95 96 L150 66 Z'
                                            fill='url(#accuWing)'
                                            stroke='#4b525d'
                                            strokeWidth='0.5'
                                        />
                                        <path d='M95 78 L80 92 L92 92 L120 74 Z' fill='#ff1a4d' opacity='0.85' />
                                        <ellipse cx='108' cy='84' rx='14' ry='6.5' fill='url(#accuEngine)' />
                                        <ellipse cx='98' cy='84' rx='3' ry='5' fill='#05070a' />
                                        <ellipse cx='97' cy='83' rx='1.2' ry='2' fill='#7fd4ff' opacity='0.5' />
                                        <path
                                            d='M40 62 C 90 70, 160 70, 205 62 C 160 66, 90 66, 40 62 Z'
                                            fill='#000'
                                            opacity='0.15'
                                        />
                                    </svg>
                                </div>

                                <div className='result-display'>
                                    <span>
                                        {hasCrashed || roundStatus === 'flew'
                                            ? 'BREAKOUT / FLEW AWAY'
                                            : hasWon
                                              ? 'CASHED OUT'
                                              : hasOpenContract
                                                ? 'LIVE ACCUMULATOR'
                                                : 'LIVE MARKET'}
                                    </span>
                                    <strong
                                        className={classNames({
                                            'result-display__value--crashed': hasCrashed || roundStatus === 'flew',
                                            'result-display__value--won': hasWon,
                                        })}
                                    >
                                        {formatPercent(displayReturnPercent)}
                                    </strong>
                                </div>

                                <div className='balance-display'>
                                    <div className='avatar-stack'>
                                        <div className='avatar avatar-one'>$</div>
                                        <div className='avatar avatar-two'>E</div>
                                        <div className='avatar avatar-three'>P</div>
                                    </div>
                                    <span className='balance-amount'>{formatMoney(client.balance || 0, currency).replace(` ${currency}`, '')}</span>
                                </div>
                            </div>
                        </div>
                    </section>

                    {error && <div className='accumilatoirs-alert accumilatoirs-alert--error'>{error}</div>}
                    {message && <div className='accumilatoirs-alert'>{message}</div>}

                    <div className='accumilatoirs-trade-setup'>
                        <section className='accumilatoirs-ticket'>
                            <div className='accumilatoirs-ticket__header'>
                                <h2>Trade setup</h2>
                                <span className={classNames({ 'accumilatoirs-live': isLive })}>
                                    {isMarketLoading ? 'Loading' : isLive ? 'LIVE' : 'Waiting'} / {currency}
                                </span>
                            </div>

                            <div className='accumilatoirs-ticket__content'>
                                <label className='accumilatoirs-field'>
                                    <span>Market</span>
                                    <select
                                        className='accumilatoirs-field__control'
                                        disabled={hasOpenContract || queuedPurchase}
                                        value={selectedSymbol}
                                        onChange={event => handleMarketChange(event.target.value)}
                                    >
                                        {ACCUMULATOR_MARKETS.map(market => (
                                            <option key={market.symbol} value={market.symbol}>
                                                {market.label}
                                            </option>
                                        ))}
                                    </select>
                                </label>

                                <div className='accumilatoirs-ticket__row'>
                                    <label className='accumilatoirs-field'>
                                        <span>Stake</span>
                                        <div className='accumilatoirs-inline-input'>
                                            <input
                                                className='accumilatoirs-field__control'
                                                disabled={hasOpenContract || queuedPurchase}
                                                inputMode='decimal'
                                                value={stakeInput}
                                                onChange={event => setStakeInput(cleanMoneyInput(event.target.value))}
                                            />
                                            <span>{currency}</span>
                                        </div>
                                    </label>

                                    <label className='accumilatoirs-field'>
                                        <span>Growth rate</span>
                                        <select
                                            className='accumilatoirs-field__control'
                                            disabled={hasOpenContract || queuedPurchase}
                                            value={growthRate}
                                            onChange={event => setGrowthRate(event.target.value)}
                                        >
                                            {GROWTH_RATES.map(rate => (
                                                <option key={rate.value} value={rate.value}>
                                                    {rate.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>

                                <label className='accumilatoirs-field'>
                                    <span>Take profit</span>
                                    <div className='accumilatoirs-inline-input'>
                                        <input
                                            className='accumilatoirs-field__control'
                                            disabled={hasOpenContract || queuedPurchase}
                                            inputMode='decimal'
                                            value={autoCashout.takeProfit}
                                            onChange={event =>
                                                setAutoCashout(previous => ({
                                                    ...previous,
                                                    enabled: true,
                                                    takeProfit: cleanMoneyInput(event.target.value),
                                                    useServerTakeProfit: true,
                                                }))
                                            }
                                        />
                                        <span>{currency}</span>
                                    </div>
                                </label>

                                <label
                                    className={classNames('accumilatoirs-check accumilatoirs-check--auto', {
                                        'accumilatoirs-check--auto-active': autoTradeEnabled,
                                    })}
                                >
                                    <input
                                        checked={autoTradeEnabled}
                                        type='checkbox'
                                        onChange={event => {
                                            const enabled = event.target.checked;
                                            setAutoTradeEnabled(enabled);
                                            if (enabled && !hasOpenContract) {
                                                setQueuedPurchase(true);
                                                queuedPurchaseRef.current = true;
                                                setMessage('Auto trade enabled. Waiting for breakout/flew away.');
                                            } else if (!enabled) {
                                                setQueuedPurchase(false);
                                                queuedPurchaseRef.current = false;
                                                setMessage('');
                                            }
                                        }}
                                    />
                                    <span>Auto trade after breakout</span>
                                </label>

                                <button
                                    className={classNames('accumilatoirs-primary', {
                                        'accumilatoirs-primary--cashout': hasOpenContract,
                                        'accumilatoirs-primary--waiting': queuedPurchase,
                                    })}
                                    disabled={!canTrade || isCashingOut}
                                    type='button'
                                    onClick={() => void handleTradeAction()}
                                >
                                    {hasOpenContract
                                        ? isCashingOut
                                            ? 'Cashing out...'
                                            : `Cash out ${formatMoney(bidPrice, currency)}`
                                        : queuedPurchase
                                          ? 'Waiting for breakout...'
                                          : isPurchasing
                                            ? 'Buying...'
                                            : `Buy accumulator at ${growthRatePercent.toFixed(0)}%`}
                                </button>
                                <button
                                    className='accumilatoirs-stop'
                                    disabled={!hasOpenContract && !queuedPurchase && !autoTradeEnabled && !isPurchasing}
                                    type='button'
                                    onClick={() => void handleStopAllTrades()}
                                >
                                    Stop all trades
                                </button>
                                <div className='accumilatoirs-ticket__status'>
                                    {hasOpenContract
                                        ? `Live return ${formatPercent(displayReturnPercent)} (${formatMoney(currentProfit, currency)})`
                                        : queuedPurchase
                                          ? 'Purchase queued for the next breakout/flew away.'
                                          : proposalPreview.status === 'loading'
                                            ? 'Preparing Deriv quote...'
                                            : proposalPreview.message}
                                </div>
                                <div className='accumilatoirs-ticket__meta'>
                                    <span>{selectedMarket?.label}</span>
                                    {proposalPreview.minStake ? <span>Min stake {formatMoney(proposalPreview.minStake, currency)}</span> : null}
                                    {proposalPreview.maxPayout ? <span>Max payout {formatMoney(proposalPreview.maxPayout, currency)}</span> : null}
                                </div>
                            </div>
                        </section>
                    </div>
                </div>
            </ThemedScrollbars>
        </div>
    );
});

export default Accumilatoirs;
