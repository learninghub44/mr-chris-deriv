 import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { getLastDigitFromQuote, isExpectedStreamInterruption } from '@/utils/market-data';
import { buyContractForUi, streamContractUntilSettled } from '@/utils/trade-purchase';
import { safeSubscribe } from '@/utils/websocket-handler';

type TManualMarket = {
    label: string;
    symbol: string;
};

type TTickPoint = {
    epoch: number;
    quote: number;
};

type TDigitStat = {
    count: number;
    digit: number;
    percent: number;
};

type TDigitTradeGroup = 'even_odd' | 'over_under' | 'matches_differs';

type TManualTradeAction = {
    contractType: 'DIGITEVEN' | 'DIGITODD' | 'DIGITOVER' | 'DIGITUNDER' | 'DIGITMATCH' | 'DIGITDIFF';
    label: string;
    tone: 'blue' | 'red' | 'teal' | 'slate';
};

type TProposalPreview = {
    payout: string;
    returnLabel: string;
    status: 'ready' | 'estimated';
};

const DEFAULT_TICK_COUNT = 1000;
const MIN_TICK_COUNT = 10;
const MAX_TICK_COUNT = 1000;
const DEFAULT_STAKE = '1';
const DEFAULT_DURATION = '1';
const DEFAULT_RUN_COUNT = '1';
const LIVE_TICK_STALE_MS = 4500;

const MANUAL_MARKETS: TManualMarket[] = [
    { label: 'Volatility 10 (1s) Index', symbol: '1HZ10V' },
    { label: 'Volatility 15 (1s) Index', symbol: '1HZ15V' },
    { label: 'Volatility 25 (1s) Index', symbol: '1HZ25V' },
    { label: 'Volatility 30 (1s) Index', symbol: '1HZ30V' },
    { label: 'Volatility 50 (1s) Index', symbol: '1HZ50V' },
    { label: 'Volatility 75 (1s) Index', symbol: '1HZ75V' },
    { label: 'Volatility 90 (1s) Index', symbol: '1HZ90V' },
    { label: 'Volatility 100 (1s) Index', symbol: '1HZ100V' },
    { label: 'Volatility 10 Index', symbol: 'R_10' },
    { label: 'Volatility 25 Index', symbol: 'R_25' },
    { label: 'Volatility 50 Index', symbol: 'R_50' },
    { label: 'Volatility 75 Index', symbol: 'R_75' },
    { label: 'Volatility 100 Index', symbol: 'R_100' },
];

const TRADE_GROUPS: { label: string; value: TDigitTradeGroup }[] = [
    { label: 'Even / Odd', value: 'even_odd' },
    { label: 'Over / Under', value: 'over_under' },
    { label: 'Matches / Differs', value: 'matches_differs' },
];

const TRADE_ACTIONS: Record<TDigitTradeGroup, TManualTradeAction[]> = {
    even_odd: [
        { contractType: 'DIGITEVEN', label: 'Even', tone: 'teal' },
        { contractType: 'DIGITODD', label: 'Odd', tone: 'red' },
    ],
    over_under: [
        { contractType: 'DIGITOVER', label: 'Over', tone: 'teal' },
        { contractType: 'DIGITUNDER', label: 'Under', tone: 'red' },
    ],
    matches_differs: [
        { contractType: 'DIGITMATCH', label: 'Matches', tone: 'blue' },
        { contractType: 'DIGITDIFF', label: 'Differs', tone: 'slate' },
    ],
};

const BARRIER_TRADE_GROUPS = new Set<TDigitTradeGroup>(['over_under', 'matches_differs']);

const RING_COLORS = {
    highest: '#0ba95b',
    secondHighest: '#1127ff',
    least: '#ff1717',
    secondLeast: '#ffe733',
    neutral: '#666666',
};

const clampTickCount = (value: number) => {
    if (!Number.isFinite(value)) return DEFAULT_TICK_COUNT;

    return Math.min(MAX_TICK_COUNT, Math.max(MIN_TICK_COUNT, Math.round(value)));
};

const clampDuration = (value: number) => {
    if (!Number.isFinite(value)) return 1;

    return Math.min(10, Math.max(1, Math.round(value)));
};

const clampRunCount = (value: number) => {
    if (!Number.isFinite(value)) return 1;

    return Math.min(100, Math.max(1, Math.round(value)));
};

const createEmptyStats = (): TDigitStat[] =>
    Array.from({ length: 10 }, (_, digit) => ({
        count: 0,
        digit,
        percent: 0,
    }));

const calculateDigitStats = (ticks: TTickPoint[], symbol: string): TDigitStat[] => {
    const counts = new Array(10).fill(0);

    ticks.forEach(tick => {
        counts[getLastDigitFromQuote(tick.quote, symbol)] += 1;
    });

    return counts.map((count, digit) => ({
        count,
        digit,
        percent: ticks.length ? Math.round((count / ticks.length) * 10000) / 100 : 0,
    }));
};

const getSpecialDigitColorMap = (stats: TDigitStat[], hasTicks: boolean) => {
    if (!hasTicks) return {};

    const colorMap: Record<number, string> = {};
    const descending = [...stats].sort((a, b) => b.percent - a.percent || b.digit - a.digit);
    const ascending = [...stats].sort((a, b) => a.percent - b.percent || a.digit - b.digit);

    colorMap[descending[0].digit] = RING_COLORS.highest;
    colorMap[descending[1].digit] = RING_COLORS.secondHighest;
    colorMap[ascending[0].digit] = RING_COLORS.least;
    colorMap[ascending[1].digit] = RING_COLORS.secondLeast;

    return colorMap;
};

const getQuoteFromTick = (data: any): TTickPoint | null => {
    const quote = Number(data?.tick?.quote);
    if (!Number.isFinite(quote)) return null;

    return {
        epoch: Number(data?.tick?.epoch) || Math.floor(Date.now() / 1000),
        quote,
    };
};

const formatPayout = (value: unknown, currency: string) => {
    const payout = Number(value);
    if (!Number.isFinite(payout)) return '';

    return `${payout.toFixed(2)} ${currency}`;
};

const OVER_UNDER_PROFIT_PERCENT: Record<'DIGITOVER' | 'DIGITUNDER', Record<number, number>> = {
    DIGITOVER: {
        0: 6,
        1: 19,
        2: 36,
        3: 59,
        4: 91,
        5: 138,
        6: 218,
        7: 377,
        8: 853,
    },
    DIGITUNDER: {
        1: 853,
        2: 377,
        3: 218,
        4: 138,
        5: 91,
        6: 59,
        7: 36,
        8: 19,
        9: 6,
    },
};

const getStandardizedProfitPercent = (contractType: TManualTradeAction['contractType'], barrier: string) => {
    if (contractType === 'DIGITEVEN' || contractType === 'DIGITODD') return 85;
    if (contractType === 'DIGITDIFF') return 6;
    if (contractType === 'DIGITMATCH') return 800;

    const digitBarrier = Number(barrier);
    if (!Number.isInteger(digitBarrier)) return null;

    return OVER_UNDER_PROFIT_PERCENT[contractType]?.[digitBarrier] ?? null;
};

const getLocalPayoutPreview = (
    contractType: TManualTradeAction['contractType'],
    stake: number,
    currency: string,
    barrier: string
): TProposalPreview => {
    const profitPercent = getStandardizedProfitPercent(contractType, barrier);

    if (!Number.isFinite(stake) || stake <= 0) {
        return {
            payout: `0.00 ${currency}`,
            returnLabel: 'Enter stake',
            status: 'estimated',
        };
    }

    if (profitPercent === null) {
        return {
            payout: `0.00 ${currency}`,
            returnLabel: 'Select valid barrier',
            status: 'estimated',
        };
    }

    const payout = stake * (1 + profitPercent / 100);

    return {
        payout: formatPayout(payout, currency),
        returnLabel: `+${profitPercent.toFixed(2)}% profit`,
        status: 'estimated',
    };
};

const getProposalPreview = (proposal: any, requestedStake: number, currency: string): TProposalPreview | null => {
    const payout = Number(proposal?.payout ?? proposal?.display_value);
    const stake = Number(proposal?.ask_price ?? requestedStake);
    if (!Number.isFinite(payout) || !Number.isFinite(stake) || stake <= 0) return null;

    const profitPercent = ((payout - stake) / stake) * 100;

    return {
        payout: formatPayout(payout, currency),
        returnLabel: `${profitPercent >= 0 ? '+' : ''}${profitPercent.toFixed(2)}% profit`,
        status: 'ready',
    };
};

const ManualTrading = observer(() => {
    const { client, dashboard, run_panel, summary_card, transactions, ui } = useStore();
    const { active_tab } = dashboard;
    const [selectedSymbol, setSelectedSymbol] = useState(MANUAL_MARKETS[0].symbol);
    const [tickCountInput, setTickCountInput] = useState(String(DEFAULT_TICK_COUNT));
    const [activeTickCount, setActiveTickCount] = useState(DEFAULT_TICK_COUNT);
    const [ticks, setTicks] = useState<TTickPoint[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);
    const [tradeGroup, setTradeGroup] = useState<TDigitTradeGroup>('even_odd');
    const [selectedBarrier, setSelectedBarrier] = useState('2');
    const [durationInput, setDurationInput] = useState(DEFAULT_DURATION);
    const [stakeInput, setStakeInput] = useState(DEFAULT_STAKE);
    const [runCountInput, setRunCountInput] = useState(DEFAULT_RUN_COUNT);
    const [isPurchasing, setIsPurchasing] = useState(false);
    const [tradeMessage, setTradeMessage] = useState('');
    const [tradeError, setTradeError] = useState('');
    const [proposalPreviews, setProposalPreviews] = useState<Record<string, TProposalPreview>>({});
    const [isProposalLoading, setIsProposalLoading] = useState(false);
    const [proposalRefreshKey, setProposalRefreshKey] = useState(0);
    const subscriptionRef = useRef<{ unsubscribe?: () => void } | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const proposalRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const streamWatchdogTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastLiveTickAtRef = useRef(0);
    const requestVersionRef = useRef(0);
    const proposalVersionRef = useRef(0);

    const showManualTrading = active_tab === DBOT_TABS.MANUAL_TRADING;
    const selectedMarket = MANUAL_MARKETS.find(market => market.symbol === selectedSymbol) ?? MANUAL_MARKETS[0];
    const latestTick = ticks[ticks.length - 1] ?? null;
    const latestDigit = latestTick ? getLastDigitFromQuote(latestTick.quote, selectedSymbol) : null;
    const digitStats = useMemo(() => calculateDigitStats(ticks, selectedSymbol), [selectedSymbol, ticks]);
    const specialDigitColorMap = useMemo(() => getSpecialDigitColorMap(digitStats, ticks.length > 0), [digitStats, ticks.length]);
    const needsBarrier = BARRIER_TRADE_GROUPS.has(tradeGroup);
    const activeActions = TRADE_ACTIONS[tradeGroup];
    const currency = client.currency || 'USD';
    const localProposalPreviews = useMemo(() => {
        const stake = Number(stakeInput);

        return activeActions.reduce<Record<string, TProposalPreview>>((previews, action) => {
            previews[action.contractType] = getLocalPayoutPreview(action.contractType, stake, currency, selectedBarrier);
            return previews;
        }, {});
    }, [activeActions, currency, selectedBarrier, stakeInput]);

    const clearRetryTimer = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
        }
    }, []);

    const clearProposalRetryTimer = useCallback(() => {
        if (proposalRetryTimerRef.current) {
            clearTimeout(proposalRetryTimerRef.current);
            proposalRetryTimerRef.current = null;
        }
    }, []);

    const clearStreamWatchdogTimer = useCallback(() => {
        if (streamWatchdogTimerRef.current) {
            clearTimeout(streamWatchdogTimerRef.current);
            streamWatchdogTimerRef.current = null;
        }
    }, []);

    const unsubscribe = useCallback(() => {
        try {
            subscriptionRef.current?.unsubscribe?.();
        } catch {
            // The safe subscriber already reports unsubscribe errors.
        }
        subscriptionRef.current = null;
        setIsLive(false);
        clearStreamWatchdogTimer();
    }, [clearStreamWatchdogTimer]);

    const applyTick = useCallback(
        (tick: TTickPoint) => {
            lastLiveTickAtRef.current = Date.now();
            setTicks(previous_ticks => {
                const hasDuplicateTick = previous_ticks.some(
                    previous_tick => previous_tick.epoch === tick.epoch && previous_tick.quote === tick.quote
                );
                if (hasDuplicateTick) return previous_ticks;

                return [...previous_ticks, tick].slice(-activeTickCount);
            });
            setIsLive(true);
            setError(null);
        },
        [activeTickCount]
    );

    const loadMarketData = useCallback(async () => {
        clearRetryTimer();
        unsubscribe();

        if (!showManualTrading) return;

        const requestVersion = requestVersionRef.current + 1;
        requestVersionRef.current = requestVersion;

        const reconnectMarketStream = (delay = 900) => {
            clearRetryTimer();
            clearStreamWatchdogTimer();
            setIsLive(false);
            setIsLoading(true);
            retryTimerRef.current = setTimeout(() => {
                void loadMarketData();
            }, delay);
        };

        const scheduleStreamWatchdog = () => {
            clearStreamWatchdogTimer();
            streamWatchdogTimerRef.current = setTimeout(() => {
                if (requestVersionRef.current !== requestVersion || !showManualTrading) return;
                const elapsed = Date.now() - lastLiveTickAtRef.current;
                if (elapsed >= LIVE_TICK_STALE_MS) {
                    setError(null);
                    reconnectMarketStream();
                    return;
                }
                scheduleStreamWatchdog();
            }, LIVE_TICK_STALE_MS);
        };

        if (!api_base.api) {
            setIsLoading(true);
            setError('Connecting to Deriv market data...');
            retryTimerRef.current = setTimeout(() => {
                void loadMarketData();
            }, 1000);
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await (api_base.api as any).send({
                ticks_history: selectedSymbol,
                adjust_start_time: 1,
                end: 'latest',
                count: activeTickCount,
                start: 1,
                style: 'ticks',
            });
            if (requestVersionRef.current !== requestVersion) return;

            const prices = Array.isArray(response?.history?.prices) ? response.history.prices : [];
            const times = Array.isArray(response?.history?.times) ? response.history.times : [];
            const historyTicks = prices
                .map((price: unknown, index: number) => ({
                    epoch: Number(times[index]) || Math.floor(Date.now() / 1000),
                    quote: Number(price),
                }))
                .filter((tick: TTickPoint) => Number.isFinite(tick.quote))
                .slice(-activeTickCount);

            setTicks(historyTicks);
            lastLiveTickAtRef.current = Date.now();

            const tickObservable = (api_base.api as any).subscribe({ ticks: selectedSymbol });
            subscriptionRef.current = safeSubscribe(
                tickObservable,
                (data: any) => {
                    if (requestVersionRef.current !== requestVersion) return;

                    if (data?.error) {
                        if (!isExpectedStreamInterruption(data.error)) {
                            setError(data.error.message || 'Deriv tick stream error.');
                        } else {
                            setError(null);
                        }
                        reconnectMarketStream();
                        return;
                    }

                    const tick = getQuoteFromTick(data);
                    if (tick) applyTick(tick);
                },
                streamError => {
                    if (requestVersionRef.current !== requestVersion) return;

                    setError(null);
                    reconnectMarketStream();
                }
            );
            setIsLive(true);
            scheduleStreamWatchdog();
        } catch (loadError) {
            if (requestVersionRef.current !== requestVersion) return;

            setError(loadError instanceof Error ? loadError.message : 'Unable to load Deriv market data.');
            setIsLive(false);
            reconnectMarketStream(1200);
        } finally {
            if (requestVersionRef.current === requestVersion) {
                setIsLoading(false);
            }
        }
    }, [
        activeTickCount,
        applyTick,
        clearRetryTimer,
        clearStreamWatchdogTimer,
        selectedSymbol,
        showManualTrading,
        unsubscribe,
    ]);

    useEffect(() => {
        if (!showManualTrading) {
            clearRetryTimer();
            clearStreamWatchdogTimer();
            unsubscribe();
            return undefined;
        }

        void loadMarketData();

        return () => {
            clearRetryTimer();
            clearStreamWatchdogTimer();
            unsubscribe();
        };
    }, [clearRetryTimer, clearStreamWatchdogTimer, loadMarketData, showManualTrading, unsubscribe]);

    const buildTradeParameters = useCallback(
        (contractType: TManualTradeAction['contractType']) => {
            const stake = Number(stakeInput);
            const duration = clampDuration(Number(durationInput));
            const parameters: Record<string, number | string> = {
                amount: stake,
                basis: 'stake',
                contract_type: contractType,
                currency,
                duration,
                duration_unit: 't',
                symbol: selectedSymbol,
            };

            if (needsBarrier) parameters.barrier = selectedBarrier;

            return parameters;
        },
        [currency, durationInput, needsBarrier, selectedBarrier, selectedSymbol, stakeInput]
    );

    const pushContract = useCallback(
        (data: any) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {
                // Manual trading should not fail because a side panel observer is unavailable.
            }
        },
        [run_panel, summary_card, transactions]
    );

    useEffect(() => {
        const proposalVersion = proposalVersionRef.current + 1;
        proposalVersionRef.current = proposalVersion;
        clearProposalRetryTimer();
        setProposalPreviews(localProposalPreviews);
        setIsProposalLoading(false);

        const stake = Number(stakeInput);
        if (!showManualTrading || !Number.isFinite(stake) || stake <= 0) return undefined;

        const queueProposalRetry = (delay = 1500) => {
            clearProposalRetryTimer();
            proposalRetryTimerRef.current = setTimeout(() => {
                setProposalRefreshKey(version => version + 1);
            }, delay);
        };

        if (!api_base.api) {
            setIsProposalLoading(true);
            queueProposalRetry(1000);
            return () => clearProposalRetryTimer();
        }

        setIsProposalLoading(true);

        const loadProposals = async () => {
            const nextPreviews: Record<string, TProposalPreview> = {};

            await Promise.all(
                activeActions.map(async action => {
                    try {
                        const proposalResponse = await (api_base.api as any).send({
                            proposal: 1,
                            subscribe: 0,
                            ...buildTradeParameters(action.contractType),
                        });
                        const preview = getProposalPreview(proposalResponse?.proposal, stake, currency);
                        nextPreviews[action.contractType] = preview || localProposalPreviews[action.contractType];
                    } catch {
                        nextPreviews[action.contractType] = localProposalPreviews[action.contractType];
                    }
                })
            );

            if (proposalVersionRef.current === proposalVersion) {
                setProposalPreviews(nextPreviews);
                setIsProposalLoading(false);
                if (Object.values(nextPreviews).some(preview => preview.status !== 'ready')) {
                    queueProposalRetry(3000);
                }
            }
        };

        void loadProposals();

        return () => clearProposalRetryTimer();
    }, [
        activeActions,
        buildTradeParameters,
        clearProposalRetryTimer,
        currency,
        localProposalPreviews,
        proposalRefreshKey,
        showManualTrading,
        stakeInput,
    ]);

    useEffect(
        () => () => {
            clearProposalRetryTimer();
        },
        [clearProposalRetryTimer]
    );

    const handleApplyTicks = () => {
        const nextTickCount = clampTickCount(Number(tickCountInput));
        setTickCountInput(String(nextTickCount));
        setActiveTickCount(nextTickCount);
    };

    const handleMarketChange = (symbol: string) => {
        requestVersionRef.current += 1;
        clearRetryTimer();
        clearStreamWatchdogTimer();
        unsubscribe();
        lastLiveTickAtRef.current = 0;
        setSelectedSymbol(symbol);
        setTicks([]);
        setProposalPreviews(localProposalPreviews);
        setError(null);
        setIsLoading(true);
    };

    const handleTickCountChange = (value: string) => {
        setTickCountInput(value.replace(/[^\d]/g, ''));
    };

    const handleDurationChange = (value: string) => {
        setDurationInput(value.replace(/[^\d]/g, ''));
    };

    const handleDurationBlur = () => {
        setDurationInput(String(clampDuration(Number(durationInput))));
    };

    const handleRunCountChange = (value: string) => {
        setRunCountInput(value.replace(/[^\d]/g, ''));
    };

    const handleRunCountBlur = () => {
        setRunCountInput(String(clampRunCount(Number(runCountInput))));
    };

    const handleStakeChange = (value: string) => {
        const cleaned = value.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
        setStakeInput(cleaned);
    };

    const handleManualPurchase = async (action: TManualTradeAction) => {
        const stake = Number(stakeInput);
        if (!Number.isFinite(stake) || stake <= 0) {
            setTradeError('Enter a valid stake before buying a contract.');
            return;
        }

        if (!api_base.api) {
            setTradeError('Deriv connection is not ready yet.');
            return;
        }

        const runCount = clampRunCount(Number(runCountInput));
        setRunCountInput(String(runCount));

        setTradeError('');
        setTradeMessage(`Buying ${action.label} contract 1 of ${runCount}...`);
        setIsPurchasing(true);

        const parameters = buildTradeParameters(action.contractType);

        try {
            let totalProfit = 0;

            for (let runIndex = 1; runIndex <= runCount; runIndex++) {
                setTradeMessage(`Buying ${action.label} contract ${runIndex} of ${runCount}...`);
                const tradeStartTime = Math.floor(Date.now() / 1000);
                const verificationId = `manual_${selectedSymbol}_${tradeStartTime}_${runIndex}_${Math.random()
                    .toString(36)
                    .slice(2, 11)}`;
                const fallbackContract = {
                    buy_price: stake,
                    date_start: tradeStartTime,
                    display_name: selectedMarket.label,
                    underlying_symbol: selectedSymbol,
                    shortcode: `MANUAL_${action.contractType}_${selectedSymbol}_${runIndex}`,
                    contract_type: action.contractType,
                    currency,
                    verification_id: verificationId,
                };
                const buy = await buyContractForUi({ parameters, price: stake, source: 'ManualTrading' });
                const buySnapshot = {
                    ...fallbackContract,
                    buy_price: buy.buy_price,
                    contract_id: buy.contract_id,
                    transaction_ids: { buy: buy.transaction_id },
                };

                pushContract(buySnapshot);

                const settledContract = await streamContractUntilSettled({
                    contractId: buy.contract_id,
                    fallback: buySnapshot,
                    onUpdate: snapshot => pushContract(snapshot),
                    source: 'ManualTrading',
                });
                const profit = Number(settledContract.profit ?? 0);
                totalProfit = Number((totalProfit + profit).toFixed(8));
                setTradeMessage(
                    `${action.label} run ${runIndex} of ${runCount} closed ${profit >= 0 ? 'with profit' : 'with loss'}: ${profit.toFixed(2)} ${currency}`
                );
            }

            setTradeMessage(
                `${action.label} ${runCount} run${runCount === 1 ? '' : 's'} complete. Total P/L: ${totalProfit.toFixed(2)} ${currency}`
            );
        } catch (purchaseError) {
            setTradeMessage('');
            setTradeError(
                purchaseError instanceof Error ? purchaseError.message : 'Manual Trading could not purchase this contract.'
            );
        } finally {
            setIsPurchasing(false);
        }
    };

    if (!showManualTrading) return null;

    return (
        <div
            className={classNames('manual-trading-page', {
                'manual-trading-page--dark': ui.is_dark_mode_on,
            })}
        >
            <section className='manual-trading-toolbar'>
                <label className='manual-trading-field manual-trading-field--market'>
                    <span>Market</span>
                    <select
                        aria-label='Market'
                        className='manual-trading-field__control'
                        value={selectedSymbol}
                        onChange={event => handleMarketChange(event.target.value)}
                    >
                        {MANUAL_MARKETS.map(market => (
                            <option key={market.symbol} value={market.symbol}>
                                {market.label}
                            </option>
                        ))}
                    </select>
                </label>
                <label className='manual-trading-field'>
                    <span>Analysis ticks</span>
                    <input
                        aria-label='Analysis ticks'
                        className='manual-trading-field__control'
                        inputMode='numeric'
                        max={MAX_TICK_COUNT}
                        min={MIN_TICK_COUNT}
                        value={tickCountInput}
                        onBlur={handleApplyTicks}
                        onChange={event => handleTickCountChange(event.target.value)}
                    />
                </label>
                <button className='manual-trading-toolbar__apply' type='button' onClick={handleApplyTicks}>
                    Apply
                </button>
                <span
                    className={classNames('manual-trading-toolbar__status', {
                        'manual-trading-toolbar__status--live': isLive && !isLoading,
                    })}
                >
                    {isLoading ? 'Loading' : isLive ? 'LIVE' : 'Waiting'}
                </span>
            </section>

            {error && <div className='manual-trading-page__error'>{error}</div>}

            <section className='manual-trading-digits-card'>
                <div className='manual-trading-digits-grid'>
                    {(digitStats.length ? digitStats : createEmptyStats()).map(stat => {
                        const ringColor = specialDigitColorMap[stat.digit] ?? RING_COLORS.neutral;

                        return (
                            <div
                                className={classNames('manual-trading-digit', {
                                    'manual-trading-digit--active': stat.digit === latestDigit,
                                    'manual-trading-digit--special': Boolean(specialDigitColorMap[stat.digit]),
                                })}
                                key={stat.digit}
                            >
                                <div
                                    className='manual-trading-digit__circle'
                                    style={{ '--ring-color': ringColor } as CSSProperties}
                                >
                                    <div className='manual-trading-digit__inner'>
                                        <span className='manual-trading-digit__number'>{stat.digit}</span>
                                        <span className='manual-trading-digit__percent'>{stat.percent.toFixed(2)}%</span>
                                    </div>
                                </div>
                                {stat.digit === latestDigit && <span className='manual-trading-digit__active-arrow' />}
                            </div>
                        );
                    })}
                </div>
            </section>

            <section className='manual-trading-ticket'>
                <div className='manual-trading-ticket__header'>
                    <h2>Digit trade type</h2>
                    <span>{selectedMarket.label}</span>
                </div>

                <div className='manual-trading-trade-types'>
                    {TRADE_GROUPS.map(option => (
                        <button
                            className={classNames('manual-trading-trade-types__button', {
                                'manual-trading-trade-types__button--active': tradeGroup === option.value,
                            })}
                            key={option.value}
                            type='button'
                            onClick={() => setTradeGroup(option.value)}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>

                {needsBarrier && (
                    <div className='manual-trading-barrier'>
                        {Array.from({ length: 10 }, (_, digit) => String(digit)).map(digit => (
                            <button
                                className={classNames('manual-trading-barrier__digit', {
                                    'manual-trading-barrier__digit--active': selectedBarrier === digit,
                                })}
                                key={digit}
                                type='button'
                                onClick={() => setSelectedBarrier(digit)}
                            >
                                {digit}
                            </button>
                        ))}
                    </div>
                )}

                <div className='manual-trading-ticket__inputs'>
                    <label className='manual-trading-field'>
                        <span>Duration</span>
                        <div className='manual-trading-inline-input'>
                            <input
                                aria-label='Duration in ticks'
                                className='manual-trading-field__control'
                                inputMode='numeric'
                                value={durationInput}
                                onBlur={handleDurationBlur}
                                onChange={event => handleDurationChange(event.target.value)}
                            />
                            <span>ticks</span>
                        </div>
                    </label>
                    <label className='manual-trading-field'>
                        <span>Stake</span>
                        <div className='manual-trading-inline-input'>
                            <input
                                aria-label='Stake'
                                className='manual-trading-field__control'
                                inputMode='decimal'
                                value={stakeInput}
                                onChange={event => handleStakeChange(event.target.value)}
                            />
                            <span>{currency}</span>
                        </div>
                    </label>
                    <label className='manual-trading-field'>
                        <span>Runs</span>
                        <div className='manual-trading-inline-input'>
                            <input
                                aria-label='Number of runs'
                                className='manual-trading-field__control'
                                inputMode='numeric'
                                value={runCountInput}
                                onBlur={handleRunCountBlur}
                                onChange={event => handleRunCountChange(event.target.value)}
                            />
                            <span>runs</span>
                        </div>
                    </label>
                </div>

                <div className='manual-trading-actions'>
                    {activeActions.map(action => {
                        const preview = proposalPreviews[action.contractType] ?? localProposalPreviews[action.contractType];
                        const payoutLabel = preview.payout;
                        const returnLabel =
                            preview.status === 'ready' || !isProposalLoading ? preview.returnLabel : `${preview.returnLabel} · quoting`;

                        return (
                            <button
                                className={`manual-trading-actions__button manual-trading-actions__button--${action.tone}`}
                                disabled={isPurchasing}
                                key={action.contractType}
                                type='button'
                                onClick={() => void handleManualPurchase(action)}
                            >
                                <strong>{action.label}</strong>
                                <span>{payoutLabel}</span>
                                <small>{returnLabel}</small>
                            </button>
                        );
                    })}
                </div>

                {(tradeMessage || tradeError) && (
                    <div
                        className={classNames('manual-trading-ticket__message', {
                            'manual-trading-ticket__message--error': Boolean(tradeError),
                        })}
                    >
                        {tradeError || tradeMessage}
                    </div>
                )}
            </section>
        </div>
    );
});

export default ManualTrading;
