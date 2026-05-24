import React, { useCallback, useEffect, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import './scanner.scss';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DigitStat {
    digit: number;
    count: number;
    pct: number;
    color: string;
}

interface MarketCard {
    symbol: string;
    display_name: string;
    current_quote: string;
    digits: DigitStat[];
    last_digits: number[];
    even_pct: number;
    odd_pct: number;
    even_payout: string;
    odd_payout: string;
    strong_count: number;
    moderate_count: number;
}

interface TickData {
    quote: number;
    epoch: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const TICK_OPTIONS = [30, 60, 100, 120, 240, 500, 1000];
const SQUARES_COUNT = 10;

const DIGIT_COLORS: Record<string, string> = {
    most: '#2a9d8f',
    second: '#8a9ba8',
    least: '#d64545',
    second_least: '#e67e22',
    neutral: '#8a9ba8',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getLastDigit(quote: number): number {
    const str = quote.toString();
    const lastChar = str[str.length - 1];
    return parseInt(lastChar, 10);
}

function calculateDigitStats(ticks: TickData[]): DigitStat[] {
    const counts = new Array(10).fill(0);
    ticks.forEach(t => {
        counts[getLastDigit(t.quote)]++;
    });
    const total = ticks.length || 1;

    const indexed = counts.map((count, digit) => ({
        digit,
        count,
        pct: Math.round((count / total) * 1000) / 10,
    }));

    // Sort by count to determine rankings
    const sorted = [...indexed].sort((a, b) => b.count - a.count);

    const colorMap: Record<number, string> = {};
    // Most appearing
    colorMap[sorted[0].digit] = DIGIT_COLORS.most;
    // 2nd most
    if (sorted.length > 1) colorMap[sorted[1].digit] = DIGIT_COLORS.second;
    // Least appearing
    colorMap[sorted[sorted.length - 1].digit] = DIGIT_COLORS.least;
    // 2nd least
    if (sorted.length > 2) colorMap[sorted[sorted.length - 2].digit] = DIGIT_COLORS.second_least;

    return indexed.map(item => ({
        ...item,
        color: colorMap[item.digit] || DIGIT_COLORS.neutral,
    }));
}

function calculateEvenOdd(ticks: TickData[]): { even_pct: number; odd_pct: number } {
    if (ticks.length === 0) return { even_pct: 50, odd_pct: 50 };
    let even = 0;
    ticks.forEach(t => {
        if (getLastDigit(t.quote) % 2 === 0) even++;
    });
    const even_pct = Math.round((even / ticks.length) * 1000) / 10;
    return { even_pct, odd_pct: Math.round((100 - even_pct) * 10) / 10 };
}

function getMarketStrength(digits: DigitStat[]): { strong: number; moderate: number } {
    if (digits.length === 0) return { strong: 0, moderate: 0 };
    const avg = 100 / 10; // 10% per digit
    let strong = 0;
    let moderate = 0;
    digits.forEach(d => {
        if (d.pct >= avg * 1.3) strong++;
        else if (d.pct >= avg * 0.7) moderate++;
    });
    return { strong, moderate };
}

// ─── Component ───────────────────────────────────────────────────────────────

const Scanner = observer(() => {
    const { client } = useStore();
    const currency = client?.currency || 'AUD';

    const [activeTicks, setActiveTicks] = useState(120);
    const [cards, setCards] = useState<MarketCard[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const subscriptionsRef = useRef<Record<string, any>>({});
    const ticksRef = useRef<Record<string, TickData[]>>({});
    const cardsRef = useRef<MarketCard[]>([]);
    const activeTicksRef = useRef<number>(activeTicks);

    // Keep activeTicksRef in sync
    useEffect(() => {
        activeTicksRef.current = activeTicks;
    }, [activeTicks]);

    // Keep cardsRef in sync
    useEffect(() => {
        cardsRef.current = cards;
    }, [cards]);

    // ── Fetch active symbols and filter to continuous indices ─────────────
    const fetchContinuousMarkets = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            // Ensure API is available
            if (!api_base.api) {
                setError('API not connected. Please log in.');
                setLoading(false);
                return;
            }

            // Fetch active symbols
            const response = await (api_base.api as any).send({ active_symbols: 'brief' });
            const symbols = response?.active_symbols || [];

            // Filter to continuous indices (random_index submarket)
            const continuousSymbols = symbols.filter(
                (s: any) => s.submarket === 'random_index' && s.exchange_is_open === 1
            );

            if (continuousSymbols.length === 0) {
                setError('No continuous indices markets available.');
                setLoading(false);
                return;
            }

            // Build initial cards
            const initialCards: MarketCard[] = continuousSymbols.map((s: any) => ({
                symbol: s.symbol,
                display_name: s.display_name,
                current_quote: '—',
                digits: Array.from({ length: 10 }, (_, i) => ({
                    digit: i,
                    count: 0,
                    pct: 0,
                    color: DIGIT_COLORS.neutral,
                })),
                last_digits: [],
                even_pct: 50,
                odd_pct: 50,
                even_payout: '—',
                odd_payout: '—',
                strong_count: 0,
                moderate_count: 0,
            }));

            setCards(initialCards);
            setLoading(false);

            // Initialize tick storage
            continuousSymbols.forEach((s: any) => {
                ticksRef.current[s.symbol] = [];
            });

            // Subscribe to ticks for each symbol
            subscribeAll(continuousSymbols.map((s: any) => s.symbol));

            // Fetch payouts
            fetchPayouts(continuousSymbols.map((s: any) => s.symbol));
        } catch (err: any) {
            console.error('[Scanner] Failed to fetch markets:', err);
            setError(err?.message || 'Failed to load markets.');
            setLoading(false);
        }
    }, []);

    // ── Subscribe to tick streams ────────────────────────────────────────
    const subscribeAll = useCallback((symbols: string[]) => {
        symbols.forEach(symbol => {
            if (subscriptionsRef.current[symbol]) return;
            try {
                const obs = (api_base.api as any).subscribe({ ticks: symbol });
                const sub = obs.subscribe((data: any) => {
                    if (data?.tick?.quote !== undefined) {
                        handleTick(symbol, {
                            quote: data.tick.quote,
                            epoch: data.tick.epoch || Date.now(),
                        });
                    }
                });
                subscriptionsRef.current[symbol] = sub;
            } catch (e) {
                console.error(`[Scanner] Subscribe failed for ${symbol}:`, e);
            }
        });
    }, []);

    // ── Handle incoming tick ─────────────────────────────────────────────
    const handleTick = useCallback((symbol: string, tick: TickData) => {
        const allTicks = ticksRef.current[symbol] || [];
        allTicks.push(tick);

        // Keep only the last activeTicks count (read from ref for latest value)
        const limit = activeTicksRef.current;
        const trimmed = allTicks.slice(-limit);
        ticksRef.current[symbol] = trimmed;

        // Update the specific card
        setCards(prev => {
            const updated = prev.map(card => {
                if (card.symbol !== symbol) return card;

                const digits = calculateDigitStats(trimmed);
                const { even_pct, odd_pct } = calculateEvenOdd(trimmed);
                const last_digits = trimmed.slice(-SQUARES_COUNT).map(t => getLastDigit(t.quote));
                const { strong, moderate } = getMarketStrength(digits);

                return {
                    ...card,
                    current_quote: tick.quote.toString(),
                    digits,
                    last_digits,
                    even_pct,
                    odd_pct,
                    strong_count: strong,
                    moderate_count: moderate,
                };
            });
            return updated;
        });
    }, []);

    // ── Fetch payouts via proposal API ───────────────────────────────────
    const fetchPayouts = useCallback(
        async (symbols: string[]) => {
            for (const symbol of symbols) {
                try {
                    // Get Even/Odd proposal
                    const proposalResp = await (api_base.api as any).send({
                        proposal: 1,
                        amount: 1,
                        basis: 'stake',
                        contract_type: 'DIGITEVEN',
                        currency,
                        duration: 1,
                        duration_unit: 't',
                        symbol,
                    });

                    const evenPayout = proposalResp?.proposal?.payout || null;

                    const proposalResp2 = await (api_base.api as any).send({
                        proposal: 1,
                        amount: 1,
                        basis: 'stake',
                        contract_type: 'DIGITODD',
                        currency,
                        duration: 1,
                        duration_unit: 't',
                        symbol,
                    });

                    const oddPayout = proposalResp2?.proposal?.payout || null;

                    setCards(prev =>
                        prev.map(card => {
                            if (card.symbol !== symbol) return card;
                            return {
                                ...card,
                                even_payout: evenPayout ? `${currency} ${evenPayout}` : 'Unavailable',
                                odd_payout: oddPayout ? `${currency} ${oddPayout}` : 'Unavailable',
                            };
                        })
                    );
                } catch (e) {
                    console.error(`[Scanner] Payout fetch failed for ${symbol}:`, e);
                }
            }
        },
        [currency]
    );

    // ── Unsubscribe all ──────────────────────────────────────────────────
    const unsubscribeAll = useCallback(() => {
        Object.entries(subscriptionsRef.current).forEach(([symbol, sub]) => {
            try {
                sub?.unsubscribe?.();
            } catch (e) {
                console.error(`[Scanner] Unsubscribe failed for ${symbol}:`, e);
            }
        });
        subscriptionsRef.current = {};
    }, []);

    // ── Handle tick count change ─────────────────────────────────────────
    const handleTickChange = useCallback((newTick: number) => {
        setActiveTicks(newTick);
        // Trim existing data to new count
        Object.keys(ticksRef.current).forEach(symbol => {
            const ticks = ticksRef.current[symbol];
            if (ticks.length > newTick) {
                ticksRef.current[symbol] = ticks.slice(-newTick);
            }
        });
        // Force recalculation
        setCards(prev =>
            prev.map(card => {
                const ticks = ticksRef.current[card.symbol] || [];
                if (ticks.length === 0) return card;
                const digits = calculateDigitStats(ticks);
                const { even_pct, odd_pct } = calculateEvenOdd(ticks);
                const last_digits = ticks.slice(-SQUARES_COUNT).map(t => getLastDigit(t.quote));
                const { strong, moderate } = getMarketStrength(digits);
                return {
                    ...card,
                    digits,
                    last_digits,
                    even_pct,
                    odd_pct,
                    strong_count: strong,
                    moderate_count: moderate,
                };
            })
        );
    }, []);

    // ── Lifecycle ────────────────────────────────────────────────────────
    useEffect(() => {
        fetchContinuousMarkets();
        return () => {
            unsubscribeAll();
        };
    }, []);

    // ── Aggregate market strength across all cards ───────────────────────
    const totalStrong = cards.reduce((sum, c) => sum + c.strong_count, 0);
    const totalModerate = cards.reduce((sum, c) => sum + c.moderate_count, 0);

    // ── Render ───────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className='scanner-new'>
                <div className='topbar' />
                <div className='container'>
                    <div className='scanner-loading'>
                        <div className='scanner-loading__spinner' />
                        <p>Loading Continuous Indices markets...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className='scanner-new'>
                <div className='topbar' />
                <div className='container'>
                    <div className='scanner-error'>
                        <p>{error}</p>
                        <button onClick={fetchContinuousMarkets} className='scanner-retry-btn'>
                            Retry
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className='scanner-new'>
            <div className='topbar' />

            <div className='container'>
                {/* Ticks selector */}
                <div className='ticks'>
                    <span className='ticks-label'>NO. OF TICKS</span>
                    <div className='ticks-pills'>
                        {TICK_OPTIONS.map(t => (
                            <span
                                key={t}
                                className={t === activeTicks ? 'active' : ''}
                                onClick={() => handleTickChange(t)}
                            >
                                {t}
                            </span>
                        ))}
                    </div>
                </div>

                {/* Legend */}
                <div className='legend'>
                    <div className='legend-left'>
                        <div className='legend-item'>
                            <span className='legend-dot' style={{ background: DIGIT_COLORS.most }} />
                            Most Appearing
                        </div>
                        <div className='legend-item'>
                            <span className='legend-dot' style={{ background: DIGIT_COLORS.second }} />
                            2nd Most
                        </div>
                        <div className='legend-item'>
                            <span className='legend-dot' style={{ background: DIGIT_COLORS.least }} />
                            Least Appearing
                        </div>
                        <div className='legend-item'>
                            <span className='legend-dot' style={{ background: DIGIT_COLORS.second_least }} />
                            2nd Least
                        </div>
                    </div>
                    <div className='legend-right'>
                        <div className='title'>
                            <span className='legend-dot' style={{ background: DIGIT_COLORS.second_least }} />
                            MARKET STRENGTH
                        </div>
                        <span className='pill'>{totalStrong} STRONG</span>
                        <span className='pill'>{totalModerate} MODERATE</span>
                    </div>
                </div>

                {/* Grid of market cards */}
                <div className='grid'>
                    {cards.map(card => (
                        <div key={card.symbol} className='card'>
                            {/* Card header */}
                            <div className='card-head'>
                                <div className='card-title'>
                                    <svg width='14' height='14' viewBox='0 0 24 24' fill='#f9a8d4'>
                                        <path d='M12 2l2.47 5.01 5.53.8-4 3.9.94 5.48L12 14.77 7.06 17.2l.94-5.48-4-3.9 5.53-.8L12 2z' />
                                    </svg>
                                    {card.display_name}
                                </div>
                                <div className='card-value'>{card.current_quote}</div>
                            </div>

                            {/* Digit circles */}
                            <div className='circles'>
                                {card.digits.map(d => (
                                    <div key={d.digit} className='circle-wrap'>
                                        <div
                                            className='circle-inner'
                                            style={{ '--color': d.color } as React.CSSProperties}
                                        >
                                            {d.digit}
                                        </div>
                                        <div className='pct'>{d.pct}%</div>
                                    </div>
                                ))}
                            </div>

                            {/* Recent digit squares */}
                            <div className='squares'>
                                {Array.from({ length: SQUARES_COUNT }).map((_, i) => {
                                    const digit = card.last_digits[i];
                                    const isEven = digit !== undefined && digit % 2 === 0;
                                    return (
                                        <div
                                            key={i}
                                            className={`sq ${isEven ? 'teal' : digit !== undefined ? 'red' : 'empty'}`}
                                        >
                                            {digit !== undefined ? digit : '—'}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Controls */}
                            <div className='controls'>
                                <div>
                                    <div className='label'>Trade type</div>
                                    <div className='box'>
                                        Even / Odd
                                        <svg width='14' height='14' viewBox='0 0 20 20' fill='none'>
                                            <path
                                                d='M6 8l4 4 4-4'
                                                stroke='#9ca3af'
                                                strokeWidth='1.5'
                                                strokeLinecap='round'
                                            />
                                        </svg>
                                    </div>
                                </div>
                                <div>
                                    <div className='label'>Stake</div>
                                    <div className='box'>1.00</div>
                                </div>
                                <div>
                                    <div className='label'>Ticks</div>
                                    <div className='box'>1</div>
                                </div>
                            </div>

                            {/* Payout boxes */}
                            <div className='payout'>
                                <div className='payout-box teal'>
                                    <div className='top'>
                                        <span>Even</span>
                                        <span>{card.even_pct}%</span>
                                    </div>
                                    <div className='bottom'>
                                        <span>Even payout</span>
                                        <span>{card.even_payout}</span>
                                    </div>
                                </div>
                                <div className='payout-box red'>
                                    <div className='top'>
                                        <span>Odd</span>
                                        <span>{card.odd_pct}%</span>
                                    </div>
                                    <div className='bottom'>
                                        <span>Odd payout</span>
                                        <span>{card.odd_payout}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
});

export default Scanner;
