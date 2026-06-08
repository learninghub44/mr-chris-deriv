import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { getLastDigitFromQuote, isExpectedStreamInterruption } from '@/utils/market-data';
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

const DEFAULT_TICK_COUNT = 1000;
const MIN_TICK_COUNT = 10;
const MAX_TICK_COUNT = 1000;

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

const DIGIT_RING_COLORS: Record<number, string> = {
    0: '#ffe733',
    5: '#11b8ad',
    7: '#ff1717',
    8: '#1127ff',
};

const clampTickCount = (value: number) => {
    if (!Number.isFinite(value)) return DEFAULT_TICK_COUNT;

    return Math.min(MAX_TICK_COUNT, Math.max(MIN_TICK_COUNT, Math.round(value)));
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

const getQuoteFromTick = (data: any): TTickPoint | null => {
    const quote = Number(data?.tick?.quote);
    if (!Number.isFinite(quote)) return null;

    return {
        epoch: Number(data?.tick?.epoch) || Math.floor(Date.now() / 1000),
        quote,
    };
};

const ManualTrading = observer(() => {
    const { dashboard } = useStore();
    const { active_tab } = dashboard;
    const [selectedSymbol, setSelectedSymbol] = useState(MANUAL_MARKETS[0].symbol);
    const [tickCountInput, setTickCountInput] = useState(String(DEFAULT_TICK_COUNT));
    const [activeTickCount, setActiveTickCount] = useState(DEFAULT_TICK_COUNT);
    const [ticks, setTicks] = useState<TTickPoint[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLive, setIsLive] = useState(false);
    const subscriptionRef = useRef<{ unsubscribe?: () => void } | null>(null);
    const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const showManualTrading = active_tab === DBOT_TABS.MANUAL_TRADING;
    const selectedMarket = MANUAL_MARKETS.find(market => market.symbol === selectedSymbol) ?? MANUAL_MARKETS[0];
    const latestTick = ticks[ticks.length - 1] ?? null;
    const latestDigit = latestTick ? getLastDigitFromQuote(latestTick.quote, selectedSymbol) : null;
    const digitStats = useMemo(() => calculateDigitStats(ticks, selectedSymbol), [selectedSymbol, ticks]);

    const clearRetryTimer = useCallback(() => {
        if (retryTimerRef.current) {
            clearTimeout(retryTimerRef.current);
            retryTimerRef.current = null;
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
    }, []);

    const applyTick = useCallback(
        (tick: TTickPoint) => {
            setTicks(previous_ticks => [...previous_ticks, tick].slice(-activeTickCount));
            setIsLive(true);
            setError(null);
        },
        [activeTickCount]
    );

    const loadMarketData = useCallback(async () => {
        clearRetryTimer();
        unsubscribe();

        if (!showManualTrading) return;

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
                end: 'latest',
                count: activeTickCount,
                style: 'ticks',
            });
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

            const tickObservable = (api_base.api as any).subscribe({ ticks: selectedSymbol });
            subscriptionRef.current = safeSubscribe(
                tickObservable,
                (data: any) => {
                    if (data?.error) {
                        if (!isExpectedStreamInterruption(data.error)) {
                            setError(data.error.message || 'Deriv tick stream error.');
                        }
                        return;
                    }

                    const tick = getQuoteFromTick(data);
                    if (tick) applyTick(tick);
                },
                streamError => {
                    if (!isExpectedStreamInterruption(streamError)) {
                        setError('Deriv tick stream interrupted. Reconnecting...');
                    }
                    setIsLive(false);
                }
            );
            setIsLive(true);
        } catch (loadError) {
            setError(loadError instanceof Error ? loadError.message : 'Unable to load Deriv market data.');
            setIsLive(false);
        } finally {
            setIsLoading(false);
        }
    }, [activeTickCount, applyTick, clearRetryTimer, selectedSymbol, showManualTrading, unsubscribe]);

    useEffect(() => {
        if (!showManualTrading) {
            clearRetryTimer();
            unsubscribe();
            return undefined;
        }

        void loadMarketData();

        return () => {
            clearRetryTimer();
            unsubscribe();
        };
    }, [clearRetryTimer, loadMarketData, showManualTrading, unsubscribe]);

    const handleApplyTicks = () => {
        const nextTickCount = clampTickCount(Number(tickCountInput));
        setTickCountInput(String(nextTickCount));
        setActiveTickCount(nextTickCount);
    };

    const handleTickCountChange = (value: string) => {
        setTickCountInput(value.replace(/[^\d]/g, ''));
    };

    if (!showManualTrading) return null;

    return (
        <div className='manual-trading-page'>
            <div className='manual-trading-page__controls'>
                <select
                    aria-label='Market'
                    className='manual-trading-page__select'
                    value={selectedSymbol}
                    onChange={event => setSelectedSymbol(event.target.value)}
                >
                    {MANUAL_MARKETS.map(market => (
                        <option key={market.symbol} value={market.symbol}>
                            {market.label}
                        </option>
                    ))}
                </select>
                <input
                    aria-label='Analysis ticks'
                    className='manual-trading-page__input'
                    inputMode='numeric'
                    max={MAX_TICK_COUNT}
                    min={MIN_TICK_COUNT}
                    value={tickCountInput}
                    onBlur={handleApplyTicks}
                    onChange={event => handleTickCountChange(event.target.value)}
                />
                <button className='manual-trading-page__button' type='button' onClick={handleApplyTicks}>
                    Apply
                </button>
            </div>

            <section className='manual-trading-page__price-section'>
                <h2>PRICE</h2>
                <div className='manual-trading-page__market'>{selectedMarket.label}</div>
                <div className='manual-trading-page__price'>{latestTick ? latestTick.quote.toFixed(2) : '--'}</div>
                <div
                    className={classNames('manual-trading-page__status', {
                        'manual-trading-page__status--live': isLive && !isLoading,
                    })}
                >
                    {isLoading ? 'Loading live Deriv data...' : isLive ? 'LIVE' : 'Waiting for data'}
                </div>
            </section>

            {error && <div className='manual-trading-page__error'>{error}</div>}

            <section className='manual-trading-digits-card'>
                <div className='manual-trading-digits-grid'>
                    {(digitStats.length ? digitStats : createEmptyStats()).map(stat => (
                        <div
                            className={classNames('manual-trading-digit', {
                                'manual-trading-digit--active': stat.digit === latestDigit,
                            })}
                            key={stat.digit}
                        >
                            <div
                                className='manual-trading-digit__circle'
                                style={{ '--ring-color': DIGIT_RING_COLORS[stat.digit] ?? '#666666' } as CSSProperties}
                            >
                                <div className='manual-trading-digit__inner'>
                                    <span className='manual-trading-digit__number'>{stat.digit}</span>
                                    <span className='manual-trading-digit__percent'>{stat.percent.toFixed(2)}%</span>
                                </div>
                            </div>
                            {stat.digit === latestDigit && <span className='manual-trading-digit__active-arrow' />}
                        </div>
                    ))}
                </div>
            </section>

            <div className='manual-trading-page__footer-button' />
        </div>
    );
});

export default ManualTrading;
