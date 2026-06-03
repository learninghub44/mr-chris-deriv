import { useCallback, useEffect, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Input from '@/components/shared_ui/input';
import ThemedScrollbars from '@/components/shared_ui/themed-scrollbars';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { buyContractForUi, emitContractSoldStatus, getContractSnapshot } from '@/utils/trade-purchase';
import { recordDiagnosticEvent, setDiagnosticGauge } from '@/utils/diagnostics';
import { conditionNotifierStore } from '@/stores/condition-notifier-store';
import { getLastDigitFromQuote, isExpectedStreamInterruption } from '@/utils/market-data';
import { safeSubscribe } from '@/utils/websocket-handler';
import './combo.scss';

// ── Constants ──────────────────────────────────────────────────────────────────
const COOLDOWN_TICKS = 60;
const CONSECUTIVE_LOSSES_FOR_COOLDOWN = 2;
const DATA_SILENCE_RESTART_MS = 15000;
const DATA_RESTART_COOLDOWN_MS = 10000;
const UI_REFRESH_THROTTLE_MS = 80;

// ── Trade type helpers ─────────────────────────────────────────────────────────
type ComboTradeType =
    | 'DIGITOVER'
    | 'DIGITUNDER'
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    | 'CALL'
    | 'PUT';

const TRADE_TYPE_LABELS: Record<ComboTradeType, string> = {
    DIGITOVER: 'Digit Over',
    DIGITUNDER: 'Digit Under',
    DIGITEVEN: 'Digit Even',
    DIGITODD: 'Digit Odd',
    DIGITMATCH: 'Matches',
    DIGITDIFF: 'Differs',
    CALL: 'Rise',
    PUT: 'Fall',
};
const BARRIER_NEEDED: Record<ComboTradeType, boolean> = {
    DIGITOVER: true,
    DIGITUNDER: true,
    DIGITEVEN: false,
    DIGITODD: false,
    DIGITMATCH: true,
    DIGITDIFF: true,
    CALL: false,
    PUT: false,
};
const IS_DIRECTION: Record<ComboTradeType, boolean> = {
    DIGITOVER: false,
    DIGITUNDER: false,
    DIGITEVEN: false,
    DIGITODD: false,
    DIGITMATCH: false,
    DIGITDIFF: false,
    CALL: true,
    PUT: true,
};
const DEFAULT_DIGIT: Record<ComboTradeType, string> = {
    DIGITOVER: '4',
    DIGITUNDER: '5',
    DIGITEVEN: '4',
    DIGITODD: '4',
    DIGITMATCH: '4',
    DIGITDIFF: '4',
    CALL: '4',
    PUT: '4',
};

/** Pattern match — same opposite logic as Auto Trades */
const isPatternMatch = (
    digit: number,
    prevQuote: number | null,
    quote: number,
    ct: ComboTradeType,
    bar: number
): boolean => {
    if (ct === 'DIGITOVER') return digit <= bar;
    if (ct === 'DIGITUNDER') return digit >= bar;
    if (ct === 'DIGITEVEN') return digit % 2 !== 0;
    if (ct === 'DIGITODD') return digit % 2 === 0;
    if (ct === 'DIGITMATCH') return digit !== bar;
    if (ct === 'DIGITDIFF') return digit === bar;
    if (ct === 'CALL') return prevQuote !== null && quote < prevQuote;
    if (ct === 'PUT') return prevQuote !== null && quote > prevQuote;
    return false;
};

// ── Market catalogue ───────────────────────────────────────────────────────────
const MARKET_GROUPS = [
    {
        group: 'Volatility (1s)',
        markets: [
            { label: 'Vol 10 (1s)', symbol: '1HZ10V' },
            { label: 'Vol 15 (1s)', symbol: '1HZ15V' },
            { label: 'Vol 25 (1s)', symbol: '1HZ25V' },
            { label: 'Vol 30 (1s)', symbol: '1HZ30V' },
            { label: 'Vol 50 (1s)', symbol: '1HZ50V' },
            { label: 'Vol 75 (1s)', symbol: '1HZ75V' },
            { label: 'Vol 90 (1s)', symbol: '1HZ90V' },
            { label: 'Vol 100 (1s)', symbol: '1HZ100V' },
        ],
    },
    {
        group: 'Volatility',
        markets: [
            { label: 'Volatility 10', symbol: 'R_10' },
            { label: 'Volatility 25', symbol: 'R_25' },
            { label: 'Volatility 50', symbol: 'R_50' },
            { label: 'Volatility 75', symbol: 'R_75' },
            { label: 'Volatility 100', symbol: 'R_100' },
        ],
    },
    {
        group: 'Jump Indices',
        markets: [
            { label: 'Jump 10', symbol: 'JD10' },
            { label: 'Jump 25', symbol: 'JD25' },
            { label: 'Jump 50', symbol: 'JD50' },
            { label: 'Jump 75', symbol: 'JD75' },
            { label: 'Jump 100', symbol: 'JD100' },
        ],
    },
    {
        group: 'Boom & Crash',
        markets: [
            { label: 'Boom 300', symbol: 'BOOM300N' },
            { label: 'Boom 500', symbol: 'BOOM500' },
            { label: 'Boom 1000', symbol: 'BOOM1000' },
            { label: 'Crash 300', symbol: 'CRASH300N' },
            { label: 'Crash 500', symbol: 'CRASH500' },
            { label: 'Crash 1000', symbol: 'CRASH1000' },
        ],
    },
];

// ── Data types ─────────────────────────────────────────────────────────────────
interface ComboRow {
    id: string;
    symbol: string;
    contractType: ComboTradeType;
    stake: string;
    digit: string; // barrier for OVER/UNDER
}

interface RowLive {
    consecutive: number;
    lastDigits: number[];
    directionHistory: (1 | -1 | 0)[];
    prevQuote: number | null;
    lastQuote: number | null;
    lastResult: 'win' | 'loss' | null;
    tradeCount: number;
    liveStake: number;
    ready: boolean;
}

const makeRowLive = (baseStake: number): RowLive => ({
    consecutive: 0,
    lastDigits: [],
    directionHistory: [],
    prevQuote: null,
    lastQuote: null,
    lastResult: null,
    tradeCount: 0,
    liveStake: baseStake,
    ready: false,
});

const createRow = (): ComboRow => ({
    id: crypto.randomUUID(),
    symbol: '1HZ100V',
    contractType: 'DIGITOVER',
    stake: '1',
    digit: '4',
});

// ── Component ──────────────────────────────────────────────────────────────────
const Combo = observer(() => {
    const { dashboard, client, run_panel, summary_card, transactions } = useStore();
    const { currency } = client;
    const { active_tab } = dashboard;

    const VALID_CT: ComboTradeType[] = [
        'DIGITOVER',
        'DIGITUNDER',
        'DIGITEVEN',
        'DIGITODD',
        'DIGITMATCH',
        'DIGITDIFF',
        'CALL',
        'PUT',
    ];
    const ALL_SYMBOLS = MARKET_GROUPS.flatMap(g => g.markets.map(m => m.symbol));
    const loadSaved = (key: string, fallback: string) => {
        try {
            return localStorage.getItem(`combo_${key}`) || fallback;
        } catch {
            return fallback;
        }
    };
    const loadSavedNum = (key: string, fallback: string, min: number, max: number) => {
        const v = loadSaved(key, fallback);
        const n = Number(v);
        return !isNaN(n) && n >= min && n <= max ? v : fallback;
    };
    const loadSavedRows = (): ComboRow[] => {
        try {
            const raw = localStorage.getItem('combo_rows');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const valid = parsed.filter(
                        (r: any) =>
                            r &&
                            typeof r.id === 'string' &&
                            ALL_SYMBOLS.includes(r.symbol) &&
                            VALID_CT.includes(r.contractType)
                    );
                    if (valid.length > 0) return valid;
                }
            }
        } catch {}
        return [createRow(), createRow()];
    };

    const [rows, setRows] = useState<ComboRow[]>(loadSavedRows);
    const [streak, setStreak] = useState(() => loadSavedNum('streak', '4', 2, 10));
    const [martingale, setMartingale] = useState(() => loadSavedNum('martingale', '2', 1.01, 100));
    const [takeProfit, setTakeProfit] = useState(() => loadSavedNum('takeProfit', '100', 1, 1000000));
    const [stopLoss, setStopLoss] = useState(() => loadSavedNum('stopLoss', '100', 1, 1000000));

    // UI state
    const [isRunning, setIsRunning] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [dataStreamLoading, setDataStreamLoading] = useState(true);
    const [dataStreamMessage, setDataStreamMessage] = useState('Loading market data...');
    const [isRecoveringData, setIsRecoveringData] = useState(false);
    const isRecoveringDataRef = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const [totalPnl, setTotalPnl] = useState(0);
    const [totalRounds, setTotalRounds] = useState(0);
    const [cooldownDisplay, setCooldownDisplay] = useState(0);
    const [showDisclaimer, setShowDisclaimer] = useState(false);
    const [liveSnapshot, setLiveSnapshot] = useState<Record<string, RowLive>>({});

    // Refs
    const unmountedRef = useRef(false);
    const runningRef = useRef(false);
    const rowsRef = useRef<ComboRow[]>(rows);
    const rowLiveRef = useRef<Record<string, RowLive>>({});
    const subscriptionsRef = useRef<Record<string, any>>({});
    const streakRef = useRef(4);
    const martingaleRef = useRef(2);
    const tpRef = useRef(100);
    const slRef = useRef(100);
    const cooldownTicksRef = useRef(0);
    const consecutiveLossRef = useRef(0);
    const totalPnlRef = useRef(0);
    const totalRoundsRef = useRef(0);
    const comboFiringRef = useRef(false);
    const lastTickAtRef = useRef(0);
    const restartInFlightRef = useRef(false);
    const lastRestartAttemptAtRef = useRef(0);
    const subscriptionVersionRef = useRef(0);
    const showComboRef = useRef(false);
    const lastUiRefreshAtRef = useRef(0);
    const uiRefreshTimerRef = useRef<number | null>(null);
    const restartTimerRef = useRef<number | null>(null);
    const pollTimersRef = useRef<Set<number>>(new Set());
    const pollResolversRef = useRef<Set<(value: Record<string, any>) => void>>(new Set());

    const show_combo = active_tab === DBOT_TABS.COMBO;
    showComboRef.current = show_combo;

    // Sync refs + persist to localStorage
    useEffect(() => {
        rowsRef.current = rows;
        try {
            localStorage.setItem('combo_rows', JSON.stringify(rows));
        } catch {}
    }, [rows]);
    useEffect(() => {
        streakRef.current = Math.min(10, Math.max(2, Number(streak) || 4));
        try {
            localStorage.setItem('combo_streak', streak);
        } catch {}
    }, [streak]);
    useEffect(() => {
        martingaleRef.current = Math.max(1.01, Number(martingale) || 2);
        try {
            localStorage.setItem('combo_martingale', martingale);
        } catch {}
    }, [martingale]);
    useEffect(() => {
        tpRef.current = Number(takeProfit) || 100;
        try {
            localStorage.setItem('combo_takeProfit', takeProfit);
        } catch {}
    }, [takeProfit]);
    useEffect(() => {
        slRef.current = Number(stopLoss) || 100;
        try {
            localStorage.setItem('combo_stopLoss', stopLoss);
        } catch {}
    }, [stopLoss]);

    const flushRefresh = useCallback(() => {
        if (unmountedRef.current || !showComboRef.current) return;
        lastUiRefreshAtRef.current = Date.now();
        setLiveSnapshot({ ...rowLiveRef.current });
        setTotalPnl(totalPnlRef.current);
        setTotalRounds(totalRoundsRef.current);
        setCooldownDisplay(cooldownTicksRef.current);
    }, []);

    // Snapshot refreshes are throttled so volatile streams cannot flood React while tabs switch.
    const refresh = useCallback(() => {
        if (unmountedRef.current || !showComboRef.current) return;

        const elapsed = Date.now() - lastUiRefreshAtRef.current;
        if (elapsed >= UI_REFRESH_THROTTLE_MS) {
            if (uiRefreshTimerRef.current !== null) {
                window.clearTimeout(uiRefreshTimerRef.current);
                uiRefreshTimerRef.current = null;
            }
            flushRefresh();
            return;
        }

        if (uiRefreshTimerRef.current !== null) return;
        uiRefreshTimerRef.current = window.setTimeout(() => {
            uiRefreshTimerRef.current = null;
            flushRefresh();
        }, UI_REFRESH_THROTTLE_MS - elapsed);
    }, [flushRefresh]);

    const setDataRecoveryLoading = useCallback((message: string) => {
        if (unmountedRef.current || !showComboRef.current) return;
        isRecoveringDataRef.current = true;
        setIsRecoveringData(true);
        setDataStreamMessage(message);
        setDataStreamLoading(true);
    }, []);

    const clearDataRecoveryLoading = useCallback(() => {
        if (unmountedRef.current) return;
        isRecoveringDataRef.current = false;
        setIsRecoveringData(false);
        setDataStreamLoading(false);
    }, []);

    const updateSubscriptionDiagnostics = useCallback(() => {
        setDiagnosticGauge('combo.subscriptions', {
            activeStreams: Object.keys(subscriptionsRef.current).length,
            configuredRows: rowsRef.current.length,
            isConnected: Object.keys(subscriptionsRef.current).length > 0,
            running: runningRef.current,
        });
    }, []);

    useEffect(() => {
        updateSubscriptionDiagnostics();
    }, [rows.length, updateSubscriptionDiagnostics]);

    const schedulePoll = useCallback((callback: () => void) => {
        const timer = window.setTimeout(() => {
            pollTimersRef.current.delete(timer);
            if (!unmountedRef.current && showComboRef.current) callback();
        }, 800);
        pollTimersRef.current.add(timer);
    }, []);

    const clearDeferredWork = useCallback(() => {
        if (uiRefreshTimerRef.current !== null) {
            window.clearTimeout(uiRefreshTimerRef.current);
            uiRefreshTimerRef.current = null;
        }
        if (restartTimerRef.current !== null) {
            window.clearTimeout(restartTimerRef.current);
            restartTimerRef.current = null;
        }
        pollTimersRef.current.forEach(timer => window.clearTimeout(timer));
        pollTimersRef.current.clear();
        pollResolversRef.current.forEach(resolve => resolve({ profit: 0, is_sold: true }));
        pollResolversRef.current.clear();
        restartInFlightRef.current = false;
    }, []);

    // Push to transactions panel and emit contract event for observers
    const pushTx = useCallback(
        (data: any) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {}
        },
        [run_panel, summary_card, transactions]
    );

    // Poll until contract is settled and push final data
    const pollContract = useCallback(
        (contractId: number): Promise<Record<string, any>> =>
            new Promise(resolve => {
                const finish = (value: Record<string, any>) => {
                    pollResolversRef.current.delete(finish);
                    resolve(value);
                };
                pollResolversRef.current.add(finish);
                const check = async () => {
                    if (unmountedRef.current || !showComboRef.current) {
                        finish({ profit: 0, is_sold: true });
                        return;
                    }
                    try {
                        const resp = await (api_base.api as any).send({
                            proposal_open_contract: 1,
                            contract_id: contractId,
                        });
                        const c = resp?.proposal_open_contract;
                        if (!c) {
                            schedulePoll(check);
                            return;
                        }
                        pushTx(getContractSnapshot(c));
                        if (c.is_sold) {
                            emitContractSoldStatus(c);
                            finish(c);
                        } else schedulePoll(check);
                    } catch {
                        finish({ profit: 0, is_sold: true });
                    }
                };
                check();
            }),
        [pushTx, schedulePoll]
    );

    // Execute all rows simultaneously; return per-row profits
    const fireAllRows = useCallback(async () => {
        const cur = rowsRef.current;

        const perRowResults: { rowId: string; profit: number }[] = await Promise.all(
            cur.map(async row => {
                const live = rowLiveRef.current[row.id];
                if (!live) return { rowId: row.id, profit: 0 };
                const ct = row.contractType;
                const stk = live.liveStake;

                const params: Record<string, any> = {
                    amount: stk,
                    basis: 'stake',
                    contract_type: ct,
                    currency: currency || 'USD',
                    duration: 1,
                    duration_unit: 't',
                    symbol: row.symbol,
                };
                if (BARRIER_NEEDED[ct]) params.barrier = row.digit;

                try {
                    const buy = await buyContractForUi({ parameters: params, price: stk, source: 'Combo' });
                    const { contract_id, buy_price, transaction_id } = buy;
                    // Push buy entry immediately
                    pushTx({
                        buy_price,
                        contract_id,
                        transaction_ids: { buy: transaction_id },
                        date_start: Math.floor(Date.now() / 1000),
                        display_name: row.symbol,
                        underlying_symbol: row.symbol,
                        shortcode: `COMBO_${ct}_${row.symbol}`,
                        contract_type: ct,
                        currency: currency || 'USD',
                    });
                    const c = await pollContract(contract_id);
                    return { rowId: row.id, profit: Number(c.profit ?? 0) };
                } catch (err) {
                    console.error('[Combo] executeTrade exception:', err);
                    setError(err instanceof Error ? err.message : 'Combo could not purchase this contract.');
                    return { rowId: row.id, profit: 0 };
                }
            })
        );

        const roundProfit = perRowResults.reduce((s, r) => s + r.profit, 0);
        // Martingale applies ONLY when every row in the combo lost
        const allRowsLost = perRowResults.every(r => r.profit < 0);
        const mult = martingaleRef.current;

        cur.forEach(row => {
            const live = rowLiveRef.current[row.id];
            if (!live) return;
            const base = Number(row.stake) || 1;
            const rowResult = perRowResults.find(r => r.rowId === row.id);
            // Only multiply if EVERY row lost; reset otherwise
            live.liveStake = allRowsLost ? parseFloat((live.liveStake * mult).toFixed(2)) : base;
            live.lastResult = (rowResult?.profit ?? 0) < 0 ? 'loss' : 'win';
            live.tradeCount++;
            live.consecutive = 0;
            live.ready = false;
        });

        totalPnlRef.current = parseFloat((totalPnlRef.current + roundProfit).toFixed(2));
        totalRoundsRef.current++;

        const isOverallLoss = roundProfit < 0;
        if (isOverallLoss) {
            consecutiveLossRef.current++;
            if (consecutiveLossRef.current >= CONSECUTIVE_LOSSES_FOR_COOLDOWN) {
                cooldownTicksRef.current = COOLDOWN_TICKS;
                consecutiveLossRef.current = 0;
            }
        } else {
            consecutiveLossRef.current = 0;
        }

        if (runningRef.current) {
            const tp = tpRef.current;
            const sl = slRef.current;
            if (totalPnlRef.current >= tp || totalPnlRef.current <= -sl) {
                runningRef.current = false;
                setIsRunning(false);
                run_panel.setIsRunning(false);
            }
        }

        comboFiringRef.current = false;
        refresh();
    }, [currency, pollContract, pushTx, run_panel, refresh]);

    // Tick handler — each row uses its OWN contractType and digit for pattern detection
    const handleTick = useCallback(
        (rowId: string, symbol: string, tick: any) => {
            const live = rowLiveRef.current[rowId];
            if (!live) return;
            const should_flush_immediately = isRecoveringDataRef.current || live.lastQuote === null;

            // Look up this row's own trade config
            const row = rowsRef.current.find(r => r.id === rowId);
            if (!row) return;
            const ct = row.contractType;
            const bar = Number(row.digit) || 4;
            const targetLen = streakRef.current;
            const quote = tick.quote as number;
            void symbol;

            live.lastQuote = quote;
            lastTickAtRef.current = Date.now();
            if (isRecoveringDataRef.current) {
                clearDataRecoveryLoading();
            }

            // Cooldown countdown
            if (cooldownTicksRef.current > 0) {
                cooldownTicksRef.current = Math.max(0, cooldownTicksRef.current - 1);
            }

            if (IS_DIRECTION[ct]) {
                const dir: 1 | -1 | 0 =
                    live.prevQuote === null ? 0 : quote > live.prevQuote ? 1 : quote < live.prevQuote ? -1 : 0;
                live.directionHistory = [...live.directionHistory.slice(-9), dir];
                if (dir !== 0) {
                    const match = isPatternMatch(0, live.prevQuote, quote, ct, bar);
                    live.consecutive = match ? Math.min(live.consecutive + 1, 10) : 0;
                }
                live.prevQuote = quote;
            } else {
                const lastDigit = getLastDigitFromQuote(quote, row.symbol);
                live.lastDigits = [...live.lastDigits.slice(-9), lastDigit];
                const match = isPatternMatch(lastDigit, live.prevQuote, quote, ct, bar);
                live.consecutive = match ? Math.min(live.consecutive + 1, 10) : 0;
                live.prevQuote = quote;
            }

            live.ready = live.consecutive >= targetLen;

            // Emit condition to notifier
            if (runningRef.current) {
                const mkt = MARKET_GROUPS.flatMap(g => g.markets).find(m => m.symbol === row.symbol);
                let condStr = '';
                let digitsStr = '';
                if (IS_DIRECTION[ct]) {
                    const dirs = live.directionHistory.slice(-targetLen);
                    digitsStr = `[${dirs.map((d: number) => (d === 1 ? '↑' : d === -1 ? '↓' : '—')).join(', ')}]`;
                    condStr =
                        ct === 'CALL'
                            ? `consecutive falling ticks ≥ ${targetLen}`
                            : `consecutive rising ticks ≥ ${targetLen}`;
                } else {
                    const recent = live.lastDigits.slice(-targetLen);
                    digitsStr = `[${recent.join(', ')}]`;
                    if (ct === 'DIGITOVER') condStr = `digits ≤ ${bar} streak ≥ ${targetLen}`;
                    if (ct === 'DIGITUNDER') condStr = `digits ≥ ${bar} streak ≥ ${targetLen}`;
                    if (ct === 'DIGITEVEN') condStr = `consecutive odd digits ≥ ${targetLen}`;
                    if (ct === 'DIGITODD') condStr = `consecutive even digits ≥ ${targetLen}`;
                    if (ct === 'DIGITMATCH') condStr = `digits ≠ ${bar} streak ≥ ${targetLen}`;
                    if (ct === 'DIGITDIFF') condStr = `digits = ${bar} streak ≥ ${targetLen}`;
                }
                conditionNotifierStore.setCondition({
                    market: mkt?.label ?? row.symbol,
                    condition: condStr,
                    digits: digitsStr,
                    result: live.ready,
                    source: 'combo',
                    timestamp: Date.now(),
                });
            }

            // Fire all rows when any row hits streak, not in cooldown, not already firing
            if (runningRef.current && !comboFiringRef.current && cooldownTicksRef.current === 0 && live.ready) {
                comboFiringRef.current = true;
                Object.values(rowLiveRef.current).forEach(l => {
                    l.consecutive = 0;
                    l.ready = false;
                });
                fireAllRows();
            }

            if (should_flush_immediately) {
                flushRefresh();
            } else {
                refresh();
            }
        },
        [fireAllRows, flushRefresh, refresh]
    );

    // Subscribe individual row
    const subscribe = useCallback(
        (row: ComboRow) => {
            if (subscriptionsRef.current[row.id]) return;
            const subscriptionVersion = subscriptionVersionRef.current;
            try {
                const obs = (api_base.api as any).subscribe({ ticks: row.symbol });
                const sub = safeSubscribe(
                    obs,
                    (data: any) => {
                        if (subscriptionVersion !== subscriptionVersionRef.current || !showComboRef.current) return;
                        if (data?.error) {
                            if (!isExpectedStreamInterruption(data.error)) {
                                console.warn('[Combo] Tick stream error:', data.error);
                            }
                            if (!isRecoveringDataRef.current) {
                                setDataRecoveryLoading(`Reconnecting ${row.symbol} tick stream...`);
                            }
                            return;
                        }
                        if (data?.tick?.quote !== undefined) handleTick(row.id, row.symbol, data.tick);
                    },
                    (streamError: unknown) => {
                        if (subscriptionVersion !== subscriptionVersionRef.current || !showComboRef.current) return;
                        if (!isExpectedStreamInterruption(streamError)) {
                            console.warn('[Combo] Tick stream error:', streamError);
                        }
                        if (!isRecoveringDataRef.current) {
                            setDataRecoveryLoading(`Reconnecting ${row.symbol} tick stream...`);
                        }
                    }
                );
                subscriptionsRef.current[row.id] = sub;
                updateSubscriptionDiagnostics();
            } catch (e) {
                if (!isExpectedStreamInterruption(e)) {
                    console.error('[Combo] Subscribe failed:', e);
                }
            }
        },
        [handleTick]
    );

    const unsubscribeAll = useCallback(() => {
        subscriptionVersionRef.current++;
        Object.values(subscriptionsRef.current).forEach(sub => {
            try {
                sub?.unsubscribe?.();
            } catch {}
        });
        subscriptionsRef.current = {};
        if (!unmountedRef.current) setIsConnected(false);
        clearDataRecoveryLoading();
        updateSubscriptionDiagnostics();
    }, [clearDataRecoveryLoading, updateSubscriptionDiagnostics]);

    const subscribeAll = useCallback(() => {
        if (!rowsRef.current.length) {
            if (!unmountedRef.current) setIsConnected(false);
            clearDataRecoveryLoading();
            return;
        }
        setDataRecoveryLoading('Loading market data...');
        rowsRef.current.forEach(row => {
            if (!rowLiveRef.current[row.id]) rowLiveRef.current[row.id] = makeRowLive(Number(row.stake) || 1);
            subscribe(row);
        });
        lastTickAtRef.current = Date.now();
        setIsConnected(true);
        updateSubscriptionDiagnostics();
    }, [clearDataRecoveryLoading, setDataRecoveryLoading, subscribe, updateSubscriptionDiagnostics]);

    const restartSubscriptions = useCallback(() => {
        const now = Date.now();
        if (restartInFlightRef.current) return;
        if (now - lastRestartAttemptAtRef.current < DATA_RESTART_COOLDOWN_MS) return;
        restartInFlightRef.current = true;
        lastRestartAttemptAtRef.current = now;
        recordDiagnosticEvent('combo.stream_restart', {
            rows: rowsRef.current.length,
            silentForMs: now - lastTickAtRef.current,
        });
        unsubscribeAll();
        setDataRecoveryLoading('Market data paused. Reconnecting streams...');
        restartTimerRef.current = window.setTimeout(() => {
            restartTimerRef.current = null;
            if (!showComboRef.current || unmountedRef.current) {
                restartInFlightRef.current = false;
                return;
            }
            try {
                subscribeAll();
            } finally {
                restartInFlightRef.current = false;
                lastTickAtRef.current = Date.now();
            }
        }, 1200);
    }, [setDataRecoveryLoading, subscribeAll, unsubscribeAll]);

    // Run / Stop — connect to run_panel so transactions + mobile drawer work
    const handleRun = useCallback(() => {
        if (!api_base.is_authorized) {
            setError('Please log in first.');
            return;
        }
        setError(null);

        totalPnlRef.current = 0;
        totalRoundsRef.current = 0;
        cooldownTicksRef.current = 0;
        consecutiveLossRef.current = 0;
        comboFiringRef.current = false;

        rowsRef.current.forEach(row => {
            rowLiveRef.current[row.id] = makeRowLive(Number(row.stake) || 1);
        });
        setTotalPnl(0);
        setTotalRounds(0);
        setCooldownDisplay(0);

        runningRef.current = true;
        setIsRunning(true);

        // Open run panel and set run_id so transactions show
        try {
            run_panel.setIsRunning(true);
            run_panel.setRunId(`run-${Date.now()}`);
            run_panel.toggleDrawer(true);
        } catch {}
        dashboard.setActiveTradingModule('combo');
    }, [dashboard, run_panel]);

    const stopTrading = useCallback(() => {
        runningRef.current = false;
        comboFiringRef.current = false;
        cooldownTicksRef.current = 0;
        consecutiveLossRef.current = 0;
        clearDeferredWork();
        Object.values(rowLiveRef.current).forEach(live => {
            live.consecutive = 0;
            live.ready = false;
        });
        setIsRunning(false);
        setCooldownDisplay(0);
        clearDataRecoveryLoading();
        setError(null);
        dashboard.setActiveTradingModule(null);
        recordDiagnosticEvent('combo.stop_trading', {
            configuredRows: rowsRef.current.length,
            activeStreams: Object.keys(subscriptionsRef.current).length,
        });
        updateSubscriptionDiagnostics();
        try {
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
        } catch {}
        refresh();
    }, [clearDataRecoveryLoading, clearDeferredWork, dashboard, refresh, run_panel, updateSubscriptionDiagnostics]);

    const handleStop = useCallback(() => {
        stopTrading();
    }, [stopTrading]);

    useEffect(() => {
        if (!show_combo) return undefined;

        dashboard.registerTradingStopHandler('combo', stopTrading);
        globalObserver.register('bot.running', run_panel.onBotRunningEvent);
        globalObserver.register('contract.status', run_panel.onContractStatusEvent);
        globalObserver.register('Error', run_panel.onError);
        globalObserver.register('bot.setPurchaseInProgress', run_panel.SetpurchaseInProgress);
        globalObserver.register('bot.manual_stop', stopTrading);

        return () => {
            dashboard.unregisterTradingStopHandler('combo');
            globalObserver.unregister('bot.running', run_panel.onBotRunningEvent);
            globalObserver.unregister('contract.status', run_panel.onContractStatusEvent);
            globalObserver.unregister('Error', run_panel.onError);
            globalObserver.unregister('bot.setPurchaseInProgress', run_panel.SetpurchaseInProgress);
            globalObserver.unregister('bot.manual_stop', stopTrading);
        };
    }, [dashboard, run_panel, show_combo, stopTrading]);

    // Row management
    const addRow = useCallback(() => {
        const row = createRow();
        setRows(prev => [...prev, row]);
        rowLiveRef.current[row.id] = makeRowLive(1);
        if (isConnected) subscribe(row);
    }, [isConnected, subscribe]);

    const removeRow = useCallback((id: string) => {
        setRows(prev => (prev.length > 1 ? prev.filter(r => r.id !== id) : prev));
        try {
            subscriptionsRef.current[id]?.unsubscribe?.();
        } catch {}
        delete subscriptionsRef.current[id];
        delete rowLiveRef.current[id];
        updateSubscriptionDiagnostics();
    }, [updateSubscriptionDiagnostics]);

    const updateRow = useCallback(
        (id: string, field: keyof ComboRow, value: string) => {
            setRows(prev =>
                prev.map(r => {
                    if (r.id !== id) return r;
                    const updated = { ...r, [field]: value };
                    // Auto-set default digit when trade type changes
                    if (field === 'contractType') updated.digit = DEFAULT_DIGIT[value as ComboTradeType];
                    return updated;
                })
            );

            if (field === 'symbol') {
                // Re-subscribe to new market
                try {
                    subscriptionsRef.current[id]?.unsubscribe?.();
                } catch {}
                delete subscriptionsRef.current[id];
                updateSubscriptionDiagnostics();
                rowLiveRef.current[id] = makeRowLive(Number(rowsRef.current.find(r => r.id === id)?.stake) || 1);
                if (isConnected) {
                    window.setTimeout(() => {
                        if (!showComboRef.current || unmountedRef.current) return;
                        const updatedRow = rowsRef.current.find(row => row.id === id);
                        if (updatedRow) subscribe(updatedRow);
                    }, 100);
                }
            }

            if (field === 'contractType') {
                // Reset streak when type changes since pattern is different
                if (rowLiveRef.current[id]) {
                    rowLiveRef.current[id].consecutive = 0;
                    rowLiveRef.current[id].ready = false;
                }
            }
        },
        [isConnected, subscribe, updateSubscriptionDiagnostics]
    );

    // Tab / lifecycle effects
    useEffect(() => {
        if (!show_combo) {
            if (runningRef.current) {
                runningRef.current = false;
                setIsRunning(false);
                try {
                    run_panel.setIsRunning(false);
                } catch {}
            }
            clearDeferredWork();
            unsubscribeAll();
            return;
        }
        if (rows.length > 0) {
            setDataRecoveryLoading('Loading market data...');
        } else {
            clearDataRecoveryLoading();
        }
        rowsRef.current.forEach(row => {
            if (!rowLiveRef.current[row.id]) rowLiveRef.current[row.id] = makeRowLive(Number(row.stake) || 1);
        });
        if (api_base.api) {
            subscribeAll();
        } else {
            const id = setInterval(() => {
                if (api_base.api) {
                    clearInterval(id);
                    subscribeAll();
                }
            }, 1000);
            return () => clearInterval(id);
        }
        return undefined;
    }, [clearDataRecoveryLoading, rows.length, setDataRecoveryLoading, show_combo, subscribeAll, unsubscribeAll, run_panel]);

    useEffect(
        () => () => {
            unmountedRef.current = true;
            clearDeferredWork();
            // Invalidate all subscription callbacks by bumping version
            subscriptionVersionRef.current++;
            stopTrading();
            try {
                run_panel.setIsRunning(false);
            } catch {}
            unsubscribeAll();
        },
        [unsubscribeAll, run_panel, stopTrading]
    );

    useEffect(() => {
        if (!show_combo || !isConnected) return undefined;

        const id = window.setInterval(() => {
            const silent_for = Date.now() - lastTickAtRef.current;
            if (rowsRef.current.length > 0 && silent_for > DATA_SILENCE_RESTART_MS) {
                restartSubscriptions();
            }
        }, 5000);

        return () => window.clearInterval(id);
    }, [isConnected, restartSubscriptions, show_combo]);

    // Stop combo when main Run Panel Stop button is pressed externally
    useEffect(() => {
        if (!run_panel.is_running && runningRef.current) {
            stopTrading();
        }
    }, [run_panel.is_running, stopTrading]);

    if (!show_combo) return null;

    // ── Render helpers ─────────────────────────────────────────────────────────
    const streakNum = Math.min(10, Math.max(2, Number(streak) || 4));
    const inCooldown = cooldownDisplay > 0;
    const pnlPos = totalPnl > 0;
    const pnlNeg = totalPnl < 0;
    const anyReady = Object.values(liveSnapshot).some(l => l.ready);
    const hasAnyLiveQuote =
        rows.length > 0 &&
        rows.some(row => {
            const live = liveSnapshot[row.id];
            return live?.lastQuote !== null && live?.lastQuote !== undefined;
        });
    const isDataLoading = rows.length > 0 && (dataStreamLoading || !isConnected || !hasAnyLiveQuote);

    return (
        <div className='combo-page'>
            <ThemedScrollbars className='combo-page__scroll'>
                <div className='combo-page__inner'>
                    {/* Header */}
                    <div className='combo-page__header'>
                        <div>
                            <h1 className='combo-page__title'>Combo Trading</h1>
                            <p className='combo-page__subtitle'>
                                {rows.length} market{rows.length !== 1 ? 's' : ''} &mdash; Streak&nbsp;{streakNum}
                            </p>
                            <p className='combo-page__subtitle combo-page__subtitle--dim'>
                                Any market hits streak → all fire simultaneously &bull; Martingale only when ALL trades
                                lose
                            </p>
                        </div>
                        <div className='combo-page__status-row'>
                            <span
                                className={classNames('combo-status', {
                                    'combo-status--connected': isConnected && !inCooldown,
                                    'combo-status--running': isRunning && !inCooldown,
                                    'combo-status--cooldown': inCooldown,
                                    'combo-status--loading': isDataLoading && !inCooldown,
                                })}
                            />
                            <span className='combo-status__label'>
                                {inCooldown
                                    ? `Cooldown ${cooldownDisplay}t`
                                    : isDataLoading
                                      ? 'Loading data'
                                    : isRunning
                                      ? 'Trading'
                                      : isConnected
                                        ? 'Live data'
                                        : 'Connecting…'}
                            </span>
                        </div>
                    </div>

                    {inCooldown && isRunning && (
                        <div className='combo-cooldown'>
                            ⏳ Cooldown after 2 consecutive losses — all markets paused for{' '}
                            <strong>{cooldownDisplay}</strong> more ticks
                        </div>
                    )}

                    {error && <div className='combo-error'>{error}</div>}
                    {!client.is_logged_in && (
                        <div className='combo-notice'>Please log in to your Deriv account to execute real trades.</div>
                    )}

                    {isDataLoading && (
                        <div className='combo-page__loader'>
                            <div className='combo-data-loader'>
                                <span className='combo-data-loader__spinner' />
                                <div className='combo-data-loader__copy'>
                                    <strong>Waiting for live market data</strong>
                                    <span>{dataStreamMessage}</span>
                                </div>
                            </div>
                        </div>
                    )}

                    <div
                        className={classNames('combo-page__body', {
                            'combo-page__body--loading': isDataLoading,
                        })}
                    >
                        {/* ── Sidebar ──────────────────────────────────── */}
                        <div className='combo-sidebar'>
                            <div className='combo-card'>
                                <h2 className='combo-card__title'>Settings</h2>

                                <div className='combo-config__group'>
                                    <p className='combo-config__group-label'>Streak trigger</p>
                                    <div className='combo-config__field'>
                                        <label>Consecutive matches to fire</label>
                                        <div className='combo-config__streak-row'>
                                            <input
                                                className='combo-config__streak-slider'
                                                type='range'
                                                min='2'
                                                max='10'
                                                step='1'
                                                value={streak}
                                                onChange={e => setStreak(e.target.value)}
                                                disabled={isRunning}
                                            />
                                            <span className='combo-config__streak-value'>{streak}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className='combo-config'>
                                    <div className='combo-config__field'>
                                        <label>Martingale × (all rows, only if ALL lose)</label>
                                        <Input
                                            type='number'
                                            min='1.01'
                                            step='0.5'
                                            value={martingale}
                                            onChange={e => setMartingale(e.target.value)}
                                            disabled={isRunning}
                                        />
                                    </div>
                                    <div className='combo-config__field'>
                                        <label>Take Profit ({currency || 'USD'})</label>
                                        <Input
                                            type='number'
                                            min='0'
                                            step='1'
                                            value={takeProfit}
                                            onChange={e => setTakeProfit(e.target.value)}
                                            disabled={isRunning}
                                        />
                                    </div>
                                    <div className='combo-config__field'>
                                        <label>Stop Loss ({currency || 'USD'})</label>
                                        <Input
                                            type='number'
                                            min='0'
                                            step='1'
                                            value={stopLoss}
                                            onChange={e => setStopLoss(e.target.value)}
                                            disabled={isRunning}
                                        />
                                    </div>
                                </div>

                                <div className='combo-controls'>
                                    {!isRunning ? (
                                        <button
                                            className='combo-controls__run'
                                            onClick={handleRun}
                                            disabled={!client.is_logged_in || rows.length === 0}
                                        >
                                            ▶ Run Combo
                                        </button>
                                    ) : (
                                        <button className='combo-controls__stop' onClick={handleStop}>
                                            ■ Stop
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* Session */}
                            <div className='combo-card'>
                                <h2 className='combo-card__title'>Session</h2>
                                <div className='combo-stats'>
                                    <div className='combo-stats__row'>
                                        <span>Rounds</span>
                                        <strong>{totalRounds}</strong>
                                    </div>
                                    <div className='combo-stats__row'>
                                        <span>P&amp;L</span>
                                        <strong
                                            className={classNames('combo-stats__pnl', {
                                                'combo-stats__pnl--pos': pnlPos,
                                                'combo-stats__pnl--neg': pnlNeg,
                                            })}
                                        >
                                            {pnlPos ? '+' : ''}
                                            {totalPnl.toFixed(2)} {currency || 'USD'}
                                        </strong>
                                    </div>
                                    <div className='combo-stats__row'>
                                        <span>Take Profit</span>
                                        <span className='combo-stats__limit--tp'>+{takeProfit}</span>
                                    </div>
                                    <div className='combo-stats__row'>
                                        <span>Stop Loss</span>
                                        <span className='combo-stats__limit--sl'>-{stopLoss}</span>
                                    </div>
                                </div>

                                {totalRounds > 0 && (
                                    <div className='combo-pnl-bar'>
                                        <div
                                            className={classNames('combo-pnl-bar__fill', {
                                                'combo-pnl-bar__fill--pos': totalPnl >= 0,
                                                'combo-pnl-bar__fill--neg': totalPnl < 0,
                                            })}
                                            style={{
                                                width: `${Math.min(
                                                    100,
                                                    (Math.abs(totalPnl) /
                                                        Number(totalPnl >= 0 ? takeProfit : stopLoss)) *
                                                        100
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                )}

                                {inCooldown && isRunning && (
                                    <div className='combo-cooldown combo-cooldown--compact'>
                                        ⏳ Cooldown: <strong>{cooldownDisplay}</strong> ticks left
                                    </div>
                                )}
                                {isRunning && !inCooldown && (
                                    <div className='combo-running'>
                                        <span className='combo-running__dot' />
                                        Watching {rows.length} market{rows.length !== 1 ? 's' : ''}
                                    </div>
                                )}
                                {isRecoveringData && (
                                    <div className='combo-running combo-running--recovery'>
                                        <span className='combo-running__dot' />
                                        Market data paused. Reconnecting streams...
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* ── Market cards ─────────────────────────────── */}
                        <div className='combo-markets'>
                            <div className='combo-markets__header'>
                                <h2 className='combo-markets__title'>
                                    Markets
                                    {isConnected && <span className='combo-markets__live-badge'>● LIVE</span>}
                                    {anyReady && isRunning && !inCooldown && (
                                        <span className='combo-markets__ready-badge'>⚡ FIRING</span>
                                    )}
                                    {inCooldown && isRunning && (
                                        <span className='combo-markets__cooldown-badge'>⏳ {cooldownDisplay}t</span>
                                    )}
                                </h2>
                                <button className='combo-markets__add-btn' onClick={addRow} disabled={isRunning}>
                                    + Add Market
                                </button>
                            </div>

                            <div className='combo-markets__grid'>
                                {rows.map((row, idx) => {
                                    const live = liveSnapshot[row.id];
                                    const dots = Math.min(live?.consecutive ?? 0, streakNum);
                                    const rowReady =
                                        (live?.ready || (live?.consecutive ?? 0) >= streakNum) && !inCooldown;
                                    const base = Number(row.stake) || 1;
                                    const liveStake = live?.liveStake ?? base;
                                    const martingaleActive = liveStake > base;
                                    const isDir = IS_DIRECTION[row.contractType];

                                    return (
                                        <div
                                            key={row.id}
                                            className={classNames('combo-market-card', {
                                                'combo-market-card--ready': rowReady && isRunning,
                                                'combo-market-card--cooldown': inCooldown && isRunning,
                                                'combo-market-card--win': live?.lastResult === 'win',
                                                'combo-market-card--loss': live?.lastResult === 'loss',
                                            })}
                                        >
                                            {/* Top row: number + market + badge + remove */}
                                            <div className='combo-market-card__top'>
                                                <div className='combo-market-card__num'>{idx + 1}</div>
                                                <select
                                                    className='combo-market-card__select'
                                                    value={row.symbol}
                                                    onChange={e => updateRow(row.id, 'symbol', e.target.value)}
                                                    disabled={isRunning}
                                                >
                                                    {MARKET_GROUPS.map(g => (
                                                        <optgroup key={g.group} label={g.group}>
                                                            {g.markets.map(m => (
                                                                <option key={m.symbol} value={m.symbol}>
                                                                    {m.label}
                                                                </option>
                                                            ))}
                                                        </optgroup>
                                                    ))}
                                                </select>

                                                {inCooldown && isRunning ? (
                                                    <div className='combo-market-card__badge combo-market-card__badge--cooldown'>
                                                        ⏳{cooldownDisplay}
                                                    </div>
                                                ) : (
                                                    <div
                                                        className={classNames('combo-market-card__badge', {
                                                            'combo-market-card__badge--ready': rowReady && isRunning,
                                                        })}
                                                    >
                                                        {rowReady && isRunning
                                                            ? 'READY'
                                                            : (live?.consecutive ?? 0) > 0
                                                              ? `${live?.consecutive}`
                                                              : '—'}
                                                    </div>
                                                )}

                                                <button
                                                    className='combo-market-card__remove'
                                                    onClick={() => removeRow(row.id)}
                                                    disabled={isRunning || rows.length === 1}
                                                    title='Remove'
                                                >
                                                    ✕
                                                </button>
                                            </div>

                                            {/* Per-row trade type + digit */}
                                            <div className='combo-market-card__type-row'>
                                                <select
                                                    className='combo-market-card__type-select'
                                                    value={row.contractType}
                                                    onChange={e => updateRow(row.id, 'contractType', e.target.value)}
                                                    disabled={isRunning}
                                                >
                                                    <optgroup label='Digits'>
                                                        <option value='DIGITOVER'>Digit Over</option>
                                                        <option value='DIGITUNDER'>Digit Under</option>
                                                        <option value='DIGITEVEN'>Digit Even</option>
                                                        <option value='DIGITODD'>Digit Odd</option>
                                                        <option value='DIGITMATCH'>Matches</option>
                                                        <option value='DIGITDIFF'>Differs</option>
                                                    </optgroup>
                                                    <optgroup label='Direction'>
                                                        <option value='CALL'>Rise</option>
                                                        <option value='PUT'>Fall</option>
                                                    </optgroup>
                                                </select>

                                                {BARRIER_NEEDED[row.contractType] && (
                                                    <select
                                                        className='combo-market-card__digit-select'
                                                        value={row.digit}
                                                        onChange={e => updateRow(row.id, 'digit', e.target.value)}
                                                        disabled={isRunning}
                                                    >
                                                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                                            <option key={d} value={String(d)}>
                                                                {d}
                                                            </option>
                                                        ))}
                                                    </select>
                                                )}

                                                <div className='combo-market-card__pattern-hint'>
                                                    {row.contractType === 'DIGITOVER' && `≤${row.digit}→Over`}
                                                    {row.contractType === 'DIGITUNDER' && `≥${row.digit}→Under`}
                                                    {row.contractType === 'DIGITEVEN' && 'odd→Even'}
                                                    {row.contractType === 'DIGITODD' && 'even→Odd'}
                                                    {row.contractType === 'DIGITMATCH' && `≠${row.digit}→Match`}
                                                    {row.contractType === 'DIGITDIFF' && `=${row.digit}→Differ`}
                                                    {row.contractType === 'CALL' && 'fall→Rise'}
                                                    {row.contractType === 'PUT' && 'rise→Fall'}
                                                </div>
                                            </div>

                                            {/* Stake */}
                                            <div className='combo-market-card__config'>
                                                <div className='combo-market-card__config-field'>
                                                    <span>Stake ({currency || 'USD'})</span>
                                                    <input
                                                        className={classNames('combo-market-card__input', {
                                                            'combo-market-card__input--martingale': martingaleActive,
                                                        })}
                                                        type='number'
                                                        min='0.35'
                                                        step='0.01'
                                                        value={row.stake}
                                                        onChange={e => updateRow(row.id, 'stake', e.target.value)}
                                                        disabled={isRunning}
                                                    />
                                                    {martingaleActive && isRunning && (
                                                        <span className='combo-market-card__martingale-label'>
                                                            → {liveStake.toFixed(2)} 🔁
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Live quote */}
                                            {live?.lastQuote != null && (
                                                <div className='combo-market-card__quote'>
                                                    {live.lastQuote.toFixed(2)}
                                                </div>
                                            )}

                                            {/* Streak dots */}
                                            {isRunning && !inCooldown && (
                                                <div className='combo-market-card__dots'>
                                                    {Array.from({ length: streakNum }).map((_, i) => (
                                                        <div
                                                            key={i}
                                                            className={classNames('combo-market-card__dot', {
                                                                'combo-market-card__dot--filled': i < dots,
                                                                'combo-market-card__dot--ready': i < dots && rowReady,
                                                            })}
                                                        />
                                                    ))}
                                                    <span className='combo-market-card__dots-label'>
                                                        {live?.consecutive ?? 0}/{streakNum}
                                                    </span>
                                                </div>
                                            )}

                                            {/* History */}
                                            {!isDir && (live?.lastDigits?.length ?? 0) > 0 && (
                                                <div className='combo-market-card__digits'>
                                                    {live!.lastDigits.slice(-6).map((d, i) => (
                                                        <span
                                                            key={i}
                                                            className={classNames('combo-market-card__digit', {
                                                                'combo-market-card__digit--low': d <= 4,
                                                                'combo-market-card__digit--high': d > 4,
                                                            })}
                                                        >
                                                            {d}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}
                                            {isDir && (live?.directionHistory?.length ?? 0) > 0 && (
                                                <div className='combo-market-card__digits'>
                                                    {live!.directionHistory.slice(-6).map((dir, i) => (
                                                        <span
                                                            key={i}
                                                            className={classNames('combo-market-card__digit', {
                                                                'combo-market-card__digit--low': dir === 1,
                                                                'combo-market-card__digit--high': dir === -1,
                                                            })}
                                                        >
                                                            {dir === 1 ? '▲' : dir === -1 ? '▼' : '—'}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {(live?.tradeCount ?? 0) > 0 && (
                                                <div className='combo-market-card__footer'>
                                                    <span>
                                                        {live!.tradeCount} trade{live!.tradeCount !== 1 ? 's' : ''}
                                                    </span>
                                                    <span
                                                        className={classNames({
                                                            'combo-market-card__last-win': live?.lastResult === 'win',
                                                            'combo-market-card__last-loss': live?.lastResult === 'loss',
                                                        })}
                                                    >
                                                        {live?.lastResult === 'win' ? '✓ Win' : '✗ Loss'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                </div>
            </ThemedScrollbars>

            {/* Floating disclaimer */}
            <button className='combo-disclaimer-btn' onClick={() => setShowDisclaimer(true)}>
                ⚠ Risk Disclaimer
            </button>

            {showDisclaimer && (
                <div className='combo-disclaimer-overlay' onClick={() => setShowDisclaimer(false)}>
                    <div className='combo-disclaimer-modal' onClick={e => e.stopPropagation()}>
                        <div className='combo-disclaimer-modal__header'>
                            <span>⚠</span>
                            <h3>Risk Disclaimer</h3>
                            <button onClick={() => setShowDisclaimer(false)}>✕</button>
                        </div>
                        <div className='combo-disclaimer-modal__body'>
                            <p>
                                Deriv offers complex derivatives. These products may not be suitable for all clients.
                                Trading puts you at risk of losing some or all of your invested capital. Never trade
                                with borrowed money or money you cannot afford to lose.
                            </p>
                        </div>
                        <div className='combo-disclaimer-modal__footer'>
                            <button onClick={() => setShowDisclaimer(false)}>I Understand</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default Combo;
