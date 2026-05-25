import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import Input from '@/components/shared_ui/input';
import ThemedScrollbars from '@/components/shared_ui/themed-scrollbars';
import { DBOT_TABS } from '@/constants/bot-contents';
import { api_base, observer as globalObserver } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { conditionNotifierStore } from '@/stores/condition-notifier-store';
import { getLastDigitFromQuote, getMarketPipSize, isExpectedStreamInterruption } from '@/utils/market-data';
import { buyContractForUi, emitContractSoldStatus, getContractSnapshot } from '@/utils/trade-purchase';
import './auto-trades.scss';

type AutoMarket = { symbol: string; label: string; pip: number };
type Direction = 1 | -1 | 0;

const FIVE_MINUTE_GRANULARITY = 300;

const AUTO_MARKETS: AutoMarket[] = [
    { symbol: '1HZ10V', label: 'Vol 10 (1s)', pip: 2 },
    { symbol: '1HZ15V', label: 'Vol 15 (1s)', pip: 3 },
    { symbol: '1HZ25V', label: 'Vol 25 (1s)', pip: 2 },
    { symbol: '1HZ30V', label: 'Vol 30 (1s)', pip: 3 },
    { symbol: '1HZ50V', label: 'Vol 50 (1s)', pip: 2 },
    { symbol: '1HZ75V', label: 'Vol 75 (1s)', pip: 2 },
    { symbol: '1HZ90V', label: 'Vol 90 (1s)', pip: 3 },
    { symbol: '1HZ100V', label: 'Vol 100 (1s)', pip: 2 },
    { symbol: 'R_10', label: 'Vol 10', pip: 3 },
    { symbol: 'R_25', label: 'Vol 25', pip: 3 },
    { symbol: 'R_50', label: 'Vol 50', pip: 3 },
    { symbol: 'R_75', label: 'Vol 75', pip: 3 },
    { symbol: 'R_100', label: 'Vol 100', pip: 2 },
];

const AUTO_MARKET_SYMBOLS = AUTO_MARKETS.map(({ symbol }) => symbol);
const AUTO_MARKET_LOOKUP = new Map(AUTO_MARKETS.map(market => [market.symbol, market]));

const COOLDOWN_TICKS = 60;
const CONSECUTIVE_LOSSES_FOR_COOLDOWN = 2;
const DATA_SILENCE_RESTART_MS = 15000;

type TradeType =
    | 'DIGITOVER'
    | 'DIGITUNDER'
    | 'DIGITEVEN'
    | 'DIGITODD'
    | 'DIGITMATCH'
    | 'DIGITDIFF'
    | 'CALL'
    | 'PUT'
    | 'RUNHIGH'
    | 'RUNLOW';

const TRADE_TYPE_LABELS: Record<TradeType, string> = {
    DIGITOVER: 'Digit Over',
    DIGITUNDER: 'Digit Under',
    DIGITEVEN: 'Digit Even',
    DIGITODD: 'Digit Odd',
    DIGITMATCH: 'Matches',
    DIGITDIFF: 'Differs',
    CALL: 'Rise',
    PUT: 'Fall',
    RUNHIGH: 'Only Ups',
    RUNLOW: 'Only Downs',
};

const BARRIER_NEEDED: Record<TradeType, boolean> = {
    DIGITOVER: true,
    DIGITUNDER: true,
    DIGITEVEN: false,
    DIGITODD: false,
    DIGITMATCH: true,
    DIGITDIFF: true,
    CALL: false,
    PUT: false,
    RUNHIGH: false,
    RUNLOW: false,
};

const IS_DIRECTION_TYPE: Record<TradeType, boolean> = {
    DIGITOVER: false,
    DIGITUNDER: false,
    DIGITEVEN: false,
    DIGITODD: false,
    DIGITMATCH: false,
    DIGITDIFF: false,
    CALL: true,
    PUT: true,
    RUNHIGH: true,
    RUNLOW: true,
};

const DEFAULT_BARRIER: Record<TradeType, string> = {
    DIGITOVER: '4',
    DIGITUNDER: '5',
    DIGITEVEN: '4',
    DIGITODD: '4',
    DIGITMATCH: '4',
    DIGITDIFF: '4',
    CALL: '4',
    PUT: '4',
    RUNHIGH: '4',
    RUNLOW: '4',
};

const isRunTradeType = (trade_type: TradeType) => trade_type === 'RUNHIGH' || trade_type === 'RUNLOW';
const usesLossPrediction = (trade_type: TradeType) => trade_type === 'DIGITOVER' || trade_type === 'DIGITUNDER';

const isDirectionMatch = (trade_type: TradeType, direction: Direction) => {
    if (trade_type === 'CALL') return direction === -1;
    if (trade_type === 'PUT') return direction === 1;
    if (trade_type === 'RUNHIGH') return direction === -1;
    if (trade_type === 'RUNLOW') return direction === 1;
    return false;
};

const isRunCandleMatch = (trade_type: TradeType, candle_direction: Direction) => {
    if (trade_type === 'RUNHIGH') return candle_direction === 1;
    if (trade_type === 'RUNLOW') return candle_direction === -1;
    return true;
};

const getCandleDirectionLabel = (direction: Direction) => {
    if (direction === 1) return 'Bullish';
    if (direction === -1) return 'Bearish';
    return 'Waiting';
};

const getDirectionCondition = (trade_type: TradeType, target_len: number) => {
    if (trade_type === 'CALL') return `consecutive falling ticks ≥ ${target_len}`;
    if (trade_type === 'PUT') return `consecutive rising ticks ≥ ${target_len}`;
    if (trade_type === 'RUNHIGH') return `5m candle bullish + consecutive falling ticks ≥ ${target_len}`;
    return `5m candle bearish + consecutive rising ticks ≥ ${target_len}`;
};

const getDirectionStreakLabel = (trade_type: TradeType) => {
    if (trade_type === 'CALL') return 'falling ticks';
    if (trade_type === 'PUT') return 'rising ticks';
    if (trade_type === 'RUNHIGH') return 'falling ticks + bullish 5m candle';
    return 'rising ticks + bearish 5m candle';
};

interface MarketState {
    consecutive: number;
    trading: boolean;
    lastDigits: number[];
    directionHistory: Direction[];
    prevQuote: number | null;
    candleDirection: Direction;
    candleOpen: number | null;
    candleClose: number | null;
    tradeCount: number;
    lastResult: 'win' | 'loss' | null;
    lastQuote: number | null;
}

interface MarketDisplay extends MarketState {
    symbol: string;
    label: string;
    currentStake: number;
    cooldownLeft: number;
}

const createMarketState = (prev?: Partial<MarketState>): MarketState => ({
    consecutive: 0,
    trading: false,
    lastDigits: prev?.lastDigits ?? [],
    directionHistory: prev?.directionHistory ?? [],
    prevQuote: prev?.prevQuote ?? null,
    candleDirection: prev?.candleDirection ?? 0,
    candleOpen: prev?.candleOpen ?? null,
    candleClose: prev?.candleClose ?? null,
    tradeCount: 0,
    lastResult: null,
    lastQuote: prev?.lastQuote ?? null,
});

const AutoTrades = observer(() => {
    const { dashboard, client, run_panel, summary_card, transactions } = useStore();
    const { currency } = client;
    const { active_tab } = dashboard;

    const VALID_TRADE_TYPES: TradeType[] = [
        'DIGITOVER',
        'DIGITUNDER',
        'DIGITEVEN',
        'DIGITODD',
        'DIGITMATCH',
        'DIGITDIFF',
        'CALL',
        'PUT',
        'RUNHIGH',
        'RUNLOW',
    ];
    const loadSaved = (key: string, fallback: string) => {
        try {
            return localStorage.getItem(`auto_trades_${key}`) || fallback;
        } catch {
            return fallback;
        }
    };
    const loadSavedNum = (key: string, fallback: string, min: number, max: number) => {
        const v = loadSaved(key, fallback);
        const n = Number(v);
        return !isNaN(n) && n >= min && n <= max ? v : fallback;
    };
    const loadSavedMarkets = () => {
        try {
            const raw = localStorage.getItem('auto_trades_markets');
            const parsed = raw ? JSON.parse(raw) : null;
            if (Array.isArray(parsed)) {
                const symbols = Array.from(
                    new Set(
                        parsed.filter(
                            (symbol): symbol is string => typeof symbol === 'string' && AUTO_MARKET_LOOKUP.has(symbol)
                        )
                    )
                );
                return symbols;
            }
        } catch {
            // Ignore invalid saved market settings.
        }
        return AUTO_MARKET_SYMBOLS;
    };

    const [stake, setStake] = useState(() => loadSavedNum('stake', '1', 0.01, 100000));
    const [martingale, setMartingale] = useState(() => loadSavedNum('martingale', '2', 1.01, 100));
    const [takeProfit, setTakeProfit] = useState(() => loadSavedNum('takeProfit', '100', 1, 1000000));
    const [stopLoss, setStopLoss] = useState(() => loadSavedNum('stopLoss', '100', 1, 1000000));
    const [tradeType, setTradeType] = useState<TradeType>(() => {
        const v = loadSaved('tradeType', 'DIGITOVER');
        return VALID_TRADE_TYPES.includes(v as TradeType) ? (v as TradeType) : 'DIGITOVER';
    });
    const [barrier, setBarrier] = useState(() => loadSavedNum('barrier', '4', 0, 9));
    const [predictionBeforeLoss, setPredictionBeforeLoss] = useState(() =>
        loadSavedNum('predictionBeforeLoss', '4', 0, 9)
    );
    const [predictionAfterLoss, setPredictionAfterLoss] = useState(() =>
        loadSavedNum('predictionAfterLoss', '5', 0, 9)
    );
    const [streak, setStreak] = useState(() => loadSavedNum('streak', '4', 2, 10));
    const [executionTicks, setExecutionTicks] = useState(() => loadSavedNum('executionTicks', '2', 2, 3));
    const [selectedMarketSymbols, setSelectedMarketSymbols] = useState<string[]>(loadSavedMarkets);
    const selectedMarkets = useMemo(
        () => AUTO_MARKETS.filter(market => selectedMarketSymbols.includes(market.symbol)),
        [selectedMarketSymbols]
    );
    const availableMarkets = useMemo(
        () => AUTO_MARKETS.filter(market => !selectedMarketSymbols.includes(market.symbol)),
        [selectedMarketSymbols]
    );

    const [totalPnl, setTotalPnl] = useState(0);
    const [totalTrades, setTotalTrades] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isConnected, setIsConnected] = useState(false);
    const [isRecoveringData, setIsRecoveringData] = useState(false);
    const isRecoveringDataRef = useRef(false);
    const [showDisclaimer, setShowDisclaimer] = useState(false);
    const [currentStakeDisplay, setCurrentStakeDisplay] = useState(1);
    const [cooldownDisplay, setCooldownDisplay] = useState(0);

    const [marketDisplays, setMarketDisplays] = useState<MarketDisplay[]>(
        selectedMarkets.map(m => ({
            ...m,
            consecutive: 0,
            lastDigits: [],
            directionHistory: [],
            prevQuote: null,
            candleDirection: 0,
            candleOpen: null,
            candleClose: null,
            trading: false,
            lastResult: null,
            tradeCount: 0,
            lastQuote: null,
            currentStake: 1,
            cooldownLeft: 0,
        }))
    );

    const subscriptionsRef = useRef<Record<string, any>>({});
    const candleSubscriptionsRef = useRef<Record<string, any>>({});
    const selectedMarketsRef = useRef<AutoMarket[]>(selectedMarkets);
    const selectedMarketSymbolsRef = useRef<Set<string>>(new Set(selectedMarketSymbols));
    const marketStatesRef = useRef<Record<string, MarketState>>(
        Object.fromEntries(AUTO_MARKETS.map(m => [m.symbol, createMarketState()]))
    );
    const totalPnlRef = useRef(0);
    const totalTradesRef = useRef(0);
    const runningRef = useRef(false);
    const configRef = useRef({ stake: 1, martingale: 2, takeProfit: 100, stopLoss: 100 });
    const tradeTypeRef = useRef<TradeType>('DIGITOVER');
    const barrierRef = useRef(4);
    const predictionBeforeLossRef = useRef(4);
    const predictionAfterLossRef = useRef(5);
    const streakRef = useRef(4);
    const executionTicksRef = useRef(2);
    const globalTradingRef = useRef(false);
    const nextStakeRef = useRef(1);
    const consecutiveLossRef = useRef(0);
    const cooldownTicksRef = useRef(0);
    const lastTickAtRef = useRef(0);
    const restartInFlightRef = useRef(false);
    const subscriptionVersionRef = useRef(0);

    const show_auto = active_tab === DBOT_TABS.AUTO_TRADES;

    useEffect(() => {
        configRef.current = {
            stake: Number(stake) || 1,
            martingale: Math.max(1.01, Number(martingale) || 2),
            takeProfit: Number(takeProfit) || 100,
            stopLoss: Number(stopLoss) || 100,
        };
        try {
            localStorage.setItem('auto_trades_stake', stake);
            localStorage.setItem('auto_trades_martingale', martingale);
            localStorage.setItem('auto_trades_takeProfit', takeProfit);
            localStorage.setItem('auto_trades_stopLoss', stopLoss);
        } catch {
            // Ignore localStorage write failures.
        }
    }, [stake, martingale, takeProfit, stopLoss]);

    useEffect(() => {
        tradeTypeRef.current = tradeType;
        try {
            localStorage.setItem('auto_trades_tradeType', tradeType);
        } catch {
            // Ignore localStorage write failures.
        }
    }, [tradeType]);
    useEffect(() => {
        barrierRef.current = Number(barrier) || 4;
        try {
            localStorage.setItem('auto_trades_barrier', barrier);
        } catch {
            // Ignore localStorage write failures.
        }
    }, [barrier]);
    useEffect(() => {
        predictionBeforeLossRef.current = Math.min(9, Math.max(0, Number(predictionBeforeLoss) || 0));
        try {
            localStorage.setItem('auto_trades_predictionBeforeLoss', predictionBeforeLoss);
        } catch {
            // Ignore localStorage write failures.
        }
    }, [predictionBeforeLoss]);
    useEffect(() => {
        predictionAfterLossRef.current = Math.min(9, Math.max(0, Number(predictionAfterLoss) || 0));
        try {
            localStorage.setItem('auto_trades_predictionAfterLoss', predictionAfterLoss);
        } catch {
            // Ignore localStorage write failures.
        }
    }, [predictionAfterLoss]);
    useEffect(() => {
        streakRef.current = Math.min(10, Math.max(2, Number(streak) || 4));
        try {
            localStorage.setItem('auto_trades_streak', streak);
        } catch {
            // Ignore localStorage write failures.
        }
    }, [streak]);
    useEffect(() => {
        executionTicksRef.current = Math.min(3, Math.max(2, Number(executionTicks) || 2));
        try {
            localStorage.setItem('auto_trades_executionTicks', executionTicks);
        } catch {
            // Ignore localStorage write failures.
        }
    }, [executionTicks]);

    useEffect(() => {
        selectedMarketsRef.current = selectedMarkets;
        selectedMarketSymbolsRef.current = new Set(selectedMarketSymbols);
        selectedMarketSymbols.forEach(symbol => {
            if (!marketStatesRef.current[symbol]) marketStatesRef.current[symbol] = createMarketState();
        });
        try {
            localStorage.setItem('auto_trades_markets', JSON.stringify(selectedMarketSymbols));
        } catch {
            // Ignore localStorage write failures.
        }
    }, [selectedMarketSymbols, selectedMarkets]);

    const handleTradeTypeChange = useCallback((t: TradeType) => {
        setTradeType(t);
        setBarrier(DEFAULT_BARRIER[t]);
        if (usesLossPrediction(t)) {
            setPredictionBeforeLoss(DEFAULT_BARRIER[t]);
            setPredictionAfterLoss(t === 'DIGITOVER' ? '5' : '4');
        }
    }, []);

    const refreshDisplays = useCallback(() => {
        setMarketDisplays(
            selectedMarketsRef.current.map(m => ({
                ...m,
                ...(marketStatesRef.current[m.symbol] || {}),
                currentStake: nextStakeRef.current,
                cooldownLeft: cooldownTicksRef.current,
            }))
        );
        setTotalPnl(totalPnlRef.current);
        setTotalTrades(totalTradesRef.current);
        setCurrentStakeDisplay(nextStakeRef.current);
        setCooldownDisplay(cooldownTicksRef.current);
    }, []);

    useEffect(() => {
        refreshDisplays();
    }, [refreshDisplays, selectedMarketSymbols]);

    const handleAddMarket = useCallback((symbol: string) => {
        if (!AUTO_MARKET_LOOKUP.has(symbol) || runningRef.current) return;
        setSelectedMarketSymbols(current => (current.includes(symbol) ? current : [...current, symbol]));
    }, []);

    const handleRemoveMarket = useCallback((symbol: string) => {
        if (!AUTO_MARKET_LOOKUP.has(symbol) || runningRef.current) return;
        setSelectedMarketSymbols(current => current.filter(item => item !== symbol));
    }, []);

    const handleSelectAllMarkets = useCallback(() => {
        if (!runningRef.current) setSelectedMarketSymbols(AUTO_MARKET_SYMBOLS);
    }, []);

    const handleClearMarkets = useCallback(() => {
        if (!runningRef.current) setSelectedMarketSymbols([]);
    }, []);

    const pushContract = useCallback(
        (data: any) => {
            try {
                transactions.pushTransaction({ ...data, run_id: run_panel.run_id });
                run_panel.onBotContractEvent(data);
                summary_card.onBotContractEvent(data);
            } catch {
                // Ignore observer emit failures.
            }
        },
        [run_panel, summary_card, transactions]
    );

    const getActiveDigitBarrier = useCallback((ct: TradeType) => {
        if (!usesLossPrediction(ct)) return barrierRef.current;

        return consecutiveLossRef.current > 0 ? predictionAfterLossRef.current : predictionBeforeLossRef.current;
    }, []);

    const pollContractResult = (contractId: number): Promise<Record<string, any>> =>
        new Promise(resolve => {
            const check = async () => {
                try {
                    const resp = await (api_base.api as any).send({
                        proposal_open_contract: 1,
                        contract_id: contractId,
                    });
                    const c = resp?.proposal_open_contract;
                    if (!c) {
                        setTimeout(check, 800);
                        return;
                    }
                    pushContract(getContractSnapshot(c));
                    if (c.is_sold) {
                        emitContractSoldStatus(c);
                        resolve(c);
                    } else setTimeout(check, 800);
                } catch {
                    resolve({ profit: 0, is_sold: true });
                }
            };
            check();
        });

    const executeTrade = useCallback(
        async (symbol: string, stakeAmount: number): Promise<number> => {
            const ct = tradeTypeRef.current;
            const bar = getActiveDigitBarrier(ct);

            const params: Record<string, any> = {
                amount: stakeAmount,
                basis: 'stake',
                contract_type: ct,
                currency: currency || 'USD',
                duration: isRunTradeType(ct) ? executionTicksRef.current : 1,
                duration_unit: 't',
                symbol,
            };
            if (BARRIER_NEEDED[ct]) params.barrier = String(bar);

            try {
                const buy = await buyContractForUi({ parameters: params, price: stakeAmount, source: 'AutoTrades' });
                const { contract_id, buy_price, transaction_id } = buy;
                pushContract({
                    buy_price,
                    contract_id,
                    transaction_ids: { buy: transaction_id },
                    date_start: Math.floor(Date.now() / 1000),
                    display_name: symbol,
                    underlying_symbol: symbol,
                    shortcode: `AUTO_${ct}_${symbol}`,
                    contract_type: ct,
                    currency: currency || 'USD',
                });

                const contract = await pollContractResult(contract_id);
                return Number(contract.profit ?? 0);
            } catch (err) {
                console.error('[AutoTrades] executeTrade exception:', err);
                setError(err instanceof Error ? err.message : 'Auto Trades could not purchase this contract.');
                return 0;
            }
        },
        [currency, getActiveDigitBarrier, pushContract, setError]
    );

    const handleAfterTrade = useCallback(
        (symbol: string, profit: number) => {
            const state = marketStatesRef.current[symbol];
            if (!state) return;

            const { martingale: mult, takeProfit: tp, stopLoss: sl, stake: baseStake } = configRef.current;

            totalPnlRef.current = parseFloat((totalPnlRef.current + profit).toFixed(2));
            totalTradesRef.current++;

            const isLoss = profit < 0;

            if (isLoss) {
                nextStakeRef.current = parseFloat((nextStakeRef.current * mult).toFixed(2));
                consecutiveLossRef.current++;
                if (consecutiveLossRef.current >= CONSECUTIVE_LOSSES_FOR_COOLDOWN) {
                    cooldownTicksRef.current = COOLDOWN_TICKS;
                    consecutiveLossRef.current = 0;
                }
            } else {
                nextStakeRef.current = baseStake;
                consecutiveLossRef.current = 0;
            }

            state.lastResult = isLoss ? 'loss' : 'win';
            state.tradeCount++;
            state.trading = false;
            globalTradingRef.current = false;

            refreshDisplays();

            if ((totalPnlRef.current >= tp || totalPnlRef.current <= -sl) && runningRef.current) {
                runningRef.current = false;
                setIsRunning(false);
            }
        },
        [refreshDisplays]
    );

    const isPatternDigit = useCallback(
        (digit: number): boolean => {
            const ct = tradeTypeRef.current;
            const bar = getActiveDigitBarrier(ct);

            if (ct === 'DIGITOVER') return digit <= bar;
            if (ct === 'DIGITUNDER') return digit >= bar;
            if (ct === 'DIGITEVEN') return digit % 2 !== 0;
            if (ct === 'DIGITODD') return digit % 2 === 0;
            if (ct === 'DIGITMATCH') return digit !== bar;
            if (ct === 'DIGITDIFF') return digit === bar;
            return false;
        },
        [getActiveDigitBarrier]
    );

    const tryExecuteSignal = useCallback(
        (symbol: string, state: MarketState, signalReady: boolean) => {
            if (
                runningRef.current &&
                signalReady &&
                !state.trading &&
                !globalTradingRef.current &&
                cooldownTicksRef.current === 0
            ) {
                state.trading = true;
                state.consecutive = 0;
                globalTradingRef.current = true;

                const stakeNow = nextStakeRef.current;
                executeTrade(symbol, stakeNow).then(profit => handleAfterTrade(symbol, profit));
            }
        },
        [executeTrade, handleAfterTrade]
    );

    const handleCandle = useCallback(
        (symbol: string, candle: any) => {
            if (!selectedMarketSymbolsRef.current.has(symbol)) return;

            const state = marketStatesRef.current[symbol];
            if (!state) return;

            const open = Number(candle?.open);
            const close = Number(candle?.close);
            if (!Number.isFinite(open) || !Number.isFinite(close)) return;

            state.candleOpen = open;
            state.candleClose = close;
            state.candleDirection = close > open ? 1 : close < open ? -1 : 0;

            const ct = tradeTypeRef.current;
            const signalReady =
                isRunTradeType(ct) &&
                state.consecutive >= streakRef.current &&
                isRunCandleMatch(ct, state.candleDirection);
            tryExecuteSignal(symbol, state, signalReady);

            refreshDisplays();
        },
        [refreshDisplays, tryExecuteSignal]
    );

    const handleTick = useCallback(
        (symbol: string, tick: any) => {
            if (!selectedMarketSymbolsRef.current.has(symbol)) return;

            const state = marketStatesRef.current[symbol];
            if (!state) return;

            const pip = getMarketPipSize(symbol, AUTO_MARKET_LOOKUP.get(symbol)?.pip ?? 2);
            const quote = tick.quote as number;
            const ct = tradeTypeRef.current;
            const targetLen = streakRef.current;

            state.lastQuote = quote;
            lastTickAtRef.current = Date.now();
            if (isRecoveringDataRef.current) {
                isRecoveringDataRef.current = false;
                setIsRecoveringData(false);
            }

            if (cooldownTicksRef.current > 0) {
                cooldownTicksRef.current = Math.max(0, cooldownTicksRef.current - 1);
            }

            if (IS_DIRECTION_TYPE[ct]) {
                const prev = state.prevQuote;
                const dir: Direction = prev === null ? 0 : quote > prev ? 1 : quote < prev ? -1 : 0;

                state.directionHistory = [...state.directionHistory.slice(-9), dir];
                state.prevQuote = quote;

                if (dir !== 0) {
                    const match = isDirectionMatch(ct, dir);
                    if (match) {
                        state.consecutive = Math.min(state.consecutive + 1, 10);
                    } else {
                        state.consecutive = 0;
                    }
                }
            } else {
                const lastDigit = getLastDigitFromQuote(quote, symbol, pip);
                state.lastDigits = [...state.lastDigits.slice(-9), lastDigit];
                state.prevQuote = quote;

                if (isPatternDigit(lastDigit)) {
                    state.consecutive = Math.min(state.consecutive + 1, 10);
                } else {
                    state.consecutive = 0;
                }
            }

            const signalReady =
                state.consecutive >= targetLen && (!isRunTradeType(ct) || isRunCandleMatch(ct, state.candleDirection));

            if (runningRef.current) {
                const ct = tradeTypeRef.current;
                const bar = getActiveDigitBarrier(ct);
                const mkt = AUTO_MARKET_LOOKUP.get(symbol);
                let condStr = '';
                let digitsStr = '';
                if (IS_DIRECTION_TYPE[ct]) {
                    const dirs = state.directionHistory.slice(-targetLen);
                    digitsStr = `[${dirs.map(d => (d === 1 ? '↑' : d === -1 ? '↓' : '—')).join(', ')}]`;
                    condStr = getDirectionCondition(ct, targetLen);
                } else {
                    const recent = state.lastDigits.slice(-targetLen);
                    digitsStr = `[${recent.join(', ')}]`;
                    if (ct === 'DIGITOVER') condStr = `digits ≤ ${bar} streak ≥ ${targetLen}`;
                    if (ct === 'DIGITUNDER') condStr = `digits ≥ ${bar} streak ≥ ${targetLen}`;
                    if (ct === 'DIGITEVEN') condStr = `consecutive odd digits ≥ ${targetLen}`;
                    if (ct === 'DIGITODD') condStr = `consecutive even digits ≥ ${targetLen}`;
                    if (ct === 'DIGITMATCH') condStr = `digits ≠ ${bar} streak ≥ ${targetLen}`;
                    if (ct === 'DIGITDIFF') condStr = `digits = ${bar} streak ≥ ${targetLen}`;
                }
                conditionNotifierStore.setCondition({
                    market: mkt?.label ?? symbol,
                    condition: condStr,
                    digits: digitsStr,
                    result: signalReady,
                    source: 'auto',
                    timestamp: Date.now(),
                });
            }

            tryExecuteSignal(symbol, state, signalReady);

            refreshDisplays();
        },
        [getActiveDigitBarrier, isPatternDigit, refreshDisplays, tryExecuteSignal]
    );

    const startSubscriptions = useCallback(async () => {
        const subscriptionVersion = subscriptionVersionRef.current;
        const selectedSymbolSet = new Set(selectedMarkets.map(({ symbol }) => symbol));

        Object.entries(subscriptionsRef.current).forEach(([symbol, sub]) => {
            if (!selectedSymbolSet.has(symbol)) {
                try {
                    sub?.unsubscribe?.();
                } catch {
                    // Ignore unsubscribe failures.
                }
                delete subscriptionsRef.current[symbol];
            }
        });

        Object.entries(candleSubscriptionsRef.current).forEach(([symbol, sub]) => {
            if (!selectedSymbolSet.has(symbol)) {
                try {
                    sub?.unsubscribe?.();
                } catch {
                    // Ignore unsubscribe failures.
                }
                delete candleSubscriptionsRef.current[symbol];
            }
        });

        if (selectedMarkets.length === 0) {
            setIsConnected(false);
            return;
        }

        lastTickAtRef.current = Date.now();

        for (const market of selectedMarkets) {
            if (!subscriptionsRef.current[market.symbol]) {
                try {
                    const obs = (api_base.api as any).subscribe({ ticks: market.symbol });
                    const sub = obs.subscribe(
                        (data: any) => {
                            if (subscriptionVersion !== subscriptionVersionRef.current || !show_auto) return;
                            if (data?.error) {
                                if (!isExpectedStreamInterruption(data.error)) {
                                    console.warn(`[AutoTrades] Tick stream error for ${market.symbol}:`, data.error);
                                }
                                if (!isRecoveringDataRef.current) {
                                    isRecoveringDataRef.current = true;
                                    setIsRecoveringData(true);
                                }
                                return;
                            }
                            if (data?.tick?.quote !== undefined) handleTick(market.symbol, data.tick);
                        },
                        (streamError: unknown) => {
                            if (subscriptionVersion !== subscriptionVersionRef.current || !show_auto) return;
                            if (!isExpectedStreamInterruption(streamError)) {
                                console.warn(`[AutoTrades] Tick stream error for ${market.symbol}:`, streamError);
                            }
                            if (!isRecoveringDataRef.current) {
                                isRecoveringDataRef.current = true;
                                setIsRecoveringData(true);
                            }
                        }
                    );
                    subscriptionsRef.current[market.symbol] = sub;
                } catch (err) {
                    if (!isExpectedStreamInterruption(err)) {
                        console.error(`[AutoTrades] Subscribe failed for ${market.symbol}:`, err);
                    }
                }
            }

            if (!candleSubscriptionsRef.current[market.symbol]) {
                try {
                    const obs = (api_base.api as any).subscribe({
                        ticks_history: market.symbol,
                        end: 'latest',
                        count: 2,
                        granularity: FIVE_MINUTE_GRANULARITY,
                        style: 'candles',
                        subscribe: 1,
                    });
                    const sub = obs.subscribe(
                        (data: any) => {
                            if (subscriptionVersion !== subscriptionVersionRef.current || !show_auto) return;
                            if (data?.error) {
                                if (!isExpectedStreamInterruption(data.error)) {
                                    console.warn(`[AutoTrades] Candle stream error for ${market.symbol}:`, data.error);
                                }
                                if (!isRecoveringDataRef.current) {
                                    isRecoveringDataRef.current = true;
                                    setIsRecoveringData(true);
                                }
                                return;
                            }
                            const candle =
                                data?.ohlc ??
                                (Array.isArray(data?.candles) ? data.candles[data.candles.length - 1] : null);
                            if (candle) handleCandle(market.symbol, candle);
                        },
                        (streamError: unknown) => {
                            if (subscriptionVersion !== subscriptionVersionRef.current || !show_auto) return;
                            if (!isExpectedStreamInterruption(streamError)) {
                                console.warn(`[AutoTrades] Candle stream error for ${market.symbol}:`, streamError);
                            }
                            if (!isRecoveringDataRef.current) {
                                isRecoveringDataRef.current = true;
                                setIsRecoveringData(true);
                            }
                        }
                    );
                    candleSubscriptionsRef.current[market.symbol] = sub;
                } catch (err) {
                    if (!isExpectedStreamInterruption(err)) {
                        console.error(`[AutoTrades] 5m candle subscribe failed for ${market.symbol}:`, err);
                    }
                }
            }
        }
        setIsConnected(Object.keys(subscriptionsRef.current).length > 0);
    }, [handleCandle, handleTick, selectedMarkets, show_auto]);

    const stopSubscriptions = useCallback(() => {
        subscriptionVersionRef.current++;
        Object.values(subscriptionsRef.current).forEach(sub => {
            try {
                sub?.unsubscribe?.();
            } catch {
                // Ignore unsubscribe failures.
            }
        });
        subscriptionsRef.current = {};
        Object.values(candleSubscriptionsRef.current).forEach(sub => {
            try {
                sub?.unsubscribe?.();
            } catch {
                // Ignore unsubscribe failures.
            }
        });
        candleSubscriptionsRef.current = {};
        setIsConnected(false);
        isRecoveringDataRef.current = false;
        setIsRecoveringData(false);
    }, []);

    const restartSubscriptions = useCallback(() => {
        if (restartInFlightRef.current) return;
        restartInFlightRef.current = true;
        isRecoveringDataRef.current = true;
        setIsRecoveringData(true);
        stopSubscriptions();
        window.setTimeout(() => {
            if (!show_auto) {
                restartInFlightRef.current = false;
                return;
            }
            startSubscriptions()
                .catch(err => {
                    console.error('[AutoTrades] Data restart failed:', err);
                })
                .finally(() => {
                    restartInFlightRef.current = false;
                    lastTickAtRef.current = Date.now();
                });
        }, 800);
    }, [show_auto, startSubscriptions, stopSubscriptions]);

    const resetSession = useCallback(() => {
        const baseStake = configRef.current.stake;
        nextStakeRef.current = baseStake;
        globalTradingRef.current = false;
        consecutiveLossRef.current = 0;
        cooldownTicksRef.current = 0;

        selectedMarkets.forEach(m => {
            const prev = marketStatesRef.current[m.symbol];
            marketStatesRef.current[m.symbol] = {
                consecutive: 0,
                trading: false,
                lastDigits: prev?.lastDigits ?? [],
                directionHistory: prev?.directionHistory ?? [],
                prevQuote: prev?.prevQuote ?? null,
                candleDirection: prev?.candleDirection ?? 0,
                candleOpen: prev?.candleOpen ?? null,
                candleClose: prev?.candleClose ?? null,
                tradeCount: 0,
                lastResult: null,
                lastQuote: prev?.lastQuote ?? null,
            };
        });
        totalPnlRef.current = 0;
        totalTradesRef.current = 0;
        setTotalPnl(0);
        setTotalTrades(0);
        setCooldownDisplay(0);
        setCurrentStakeDisplay(baseStake);
        setError(null);
        refreshDisplays();
    }, [refreshDisplays, selectedMarkets]);

    const handleRun = useCallback(() => {
        if (!api_base.is_authorized) {
            setError('Please log in to your Deriv account before trading.');
            return;
        }
        if (selectedMarkets.length === 0) {
            setError('Please select at least one market before running Auto Trades.');
            return;
        }
        setError(null);
        resetSession();
        try {
            run_panel.setIsRunning(true);
            run_panel.setRunId(`run-${Date.now()}`);
            run_panel.toggleDrawer(true);
        } catch {
            // Ignore optional run-panel mount failures.
        }
        runningRef.current = true;
        setIsRunning(true);
    }, [resetSession, run_panel, selectedMarkets.length]);

    const stopTrading = useCallback(() => {
        runningRef.current = false;
        globalTradingRef.current = false;
        cooldownTicksRef.current = 0;
        consecutiveLossRef.current = 0;
        Object.values(marketStatesRef.current).forEach(state => {
            state.trading = false;
            state.consecutive = 0;
        });
        setIsRunning(false);
        isRecoveringDataRef.current = false;
        setIsRecoveringData(false);
        setCooldownDisplay(0);
        refreshDisplays();
    }, [refreshDisplays]);

    const handleStop = useCallback(() => {
        stopTrading();
        try {
            run_panel.setIsRunning(false);
            run_panel.setHasOpenContract(false);
        } catch {
            // Ignore optional run-panel cleanup failures.
        }
    }, [run_panel, stopTrading]);

    useEffect(() => {
        if (!show_auto) return undefined;

        globalObserver.register('bot.running', run_panel.onBotRunningEvent);
        globalObserver.register('contract.status', run_panel.onContractStatusEvent);
        globalObserver.register('Error', run_panel.onError);
        globalObserver.register('bot.setPurchaseInProgress', run_panel.SetpurchaseInProgress);
        globalObserver.register('bot.manual_stop', stopTrading);

        return () => {
            globalObserver.unregister('bot.running', run_panel.onBotRunningEvent);
            globalObserver.unregister('contract.status', run_panel.onContractStatusEvent);
            globalObserver.unregister('Error', run_panel.onError);
            globalObserver.unregister('bot.setPurchaseInProgress', run_panel.SetpurchaseInProgress);
            globalObserver.unregister('bot.manual_stop', stopTrading);
        };
    }, [run_panel, show_auto, stopTrading]);

    useEffect(() => {
        if (show_auto) {
            if (api_base.api) {
                startSubscriptions();
            } else {
                const id = setInterval(() => {
                    if (api_base.api) {
                        clearInterval(id);
                        startSubscriptions();
                    }
                }, 1000);
                return () => clearInterval(id);
            }
        } else {
            if (runningRef.current) {
                runningRef.current = false;
                setIsRunning(false);
                try {
                    run_panel.setIsRunning(false);
                } catch {
                    // Ignore optional run-panel stop failures.
                }
            }
            stopSubscriptions();
        }
        return undefined;
    }, [show_auto, startSubscriptions, stopSubscriptions, run_panel]);

    useEffect(() => {
        if (!show_auto || !isConnected) return undefined;

        const id = window.setInterval(() => {
            const has_selected_markets = selectedMarketsRef.current.length > 0;
            const silent_for = Date.now() - lastTickAtRef.current;

            if (has_selected_markets && silent_for > DATA_SILENCE_RESTART_MS) {
                restartSubscriptions();
            }
        }, 5000);

        return () => window.clearInterval(id);
    }, [isConnected, restartSubscriptions, show_auto]);

    useEffect(() => {
        if (!run_panel.is_running && runningRef.current && show_auto) {
            stopTrading();
        }
    }, [run_panel.is_running, show_auto, stopTrading]);

    useEffect(
        () => () => {
            stopTrading();
            try {
                run_panel.setIsRunning(false);
            } catch {
                // Ignore optional run-panel stop failures.
            }
            stopSubscriptions();
        },
        [stopSubscriptions, run_panel, stopTrading]
    );

    if (!show_auto) return null;

    const pnlPositive = totalPnl > 0;
    const pnlNegative = totalPnl < 0;
    const baseStakeNum = Number(stake) || 1;
    const martingaleActive = currentStakeDisplay > baseStakeNum;
    const inCooldown = cooldownDisplay > 0;
    const streakNum = Math.min(10, Math.max(2, Number(streak) || 4));
    const isDirection = IS_DIRECTION_TYPE[tradeType];
    const activeBarrier = getActiveDigitBarrier(tradeType);

    const subtitleTxt = (() => {
        if (tradeType === 'DIGITOVER')
            return `Streak: ${streakNum}+ digits ≤ ${activeBarrier} → ${TRADE_TYPE_LABELS.DIGITOVER} ${activeBarrier}`;
        if (tradeType === 'DIGITUNDER')
            return `Streak: ${streakNum}+ digits ≥ ${activeBarrier} → ${TRADE_TYPE_LABELS.DIGITUNDER} ${activeBarrier}`;
        if (tradeType === 'CALL') return `Streak: ${streakNum}+ consecutive Falling ticks → Rise (CALL)`;
        if (tradeType === 'PUT') return `Streak: ${streakNum}+ consecutive Rising ticks → Fall (PUT)`;
        if (tradeType === 'RUNHIGH')
            return `5m bullish candle + ${streakNum}+ falling ticks → Only Ups (${executionTicks} ticks)`;
        if (tradeType === 'RUNLOW')
            return `5m bearish candle + ${streakNum}+ rising ticks → Only Downs (${executionTicks} ticks)`;
        if (tradeType === 'DIGITEVEN') return `Streak: ${streakNum}+ consecutive Odd digits → Digit Even`;
        if (tradeType === 'DIGITODD') return `Streak: ${streakNum}+ consecutive Even digits → Digit Odd`;
        if (tradeType === 'DIGITMATCH') return `Streak: ${streakNum}+ digits ≠ ${barrier} → Matches ${barrier}`;
        if (tradeType === 'DIGITDIFF') return `Streak: ${streakNum}+ digits = ${barrier} → Differs ${barrier}`;
    })();

    return (
        <div className='auto-trades-page'>
            <ThemedScrollbars className='auto-trades-page__scroll'>
                <div className='auto-trades-page__inner'>
                    {/* Header */}
                    <div className='auto-trades-page__header'>
                        <div>
                            <h1 className='auto-trades-page__title'>Auto Trades</h1>
                            <p className='auto-trades-page__subtitle'>{subtitleTxt}</p>
                        </div>
                        <div className='auto-trades-page__status-dot'>
                            <span
                                className={classNames('auto-trades-status', {
                                    'auto-trades-status--connected': isConnected && !inCooldown,
                                    'auto-trades-status--running': isRunning && !inCooldown,
                                    'auto-trades-status--cooldown': inCooldown,
                                })}
                            />
                            <span className='auto-trades-status__label'>
                                {inCooldown
                                    ? `Cooldown ${cooldownDisplay}t`
                                    : isRunning
                                      ? 'Trading'
                                      : isConnected
                                        ? 'Live data'
                                        : selectedMarketSymbols.length === 0
                                          ? 'No markets'
                                          : 'Connecting…'}
                            </span>
                        </div>
                    </div>

                    {/* Cooldown banner */}
                    {inCooldown && isRunning && (
                        <div className='auto-trades-cooldown'>
                            <span className='auto-trades-cooldown__icon'>⏳</span>
                            <span>
                                Cooldown after 2 consecutive losses — all markets paused for{' '}
                                <strong>{cooldownDisplay}</strong> more ticks
                            </span>
                        </div>
                    )}

                    {!client.is_logged_in && (
                        <div className='auto-trades-page__notice'>
                            Please log in to your Deriv account to execute real trades.
                        </div>
                    )}

                    {error && <div className='auto-trades-page__error'>{error}</div>}

                    <div className='auto-trades-page__body'>
                        {/* Sidebar */}
                        <div className='auto-trades-page__sidebar'>
                            {/* Settings card */}
                            <div className='auto-trades-card'>
                                <h2 className='auto-trades-card__title'>Settings</h2>

                                {/* Contract Type + Barrier + Streak */}
                                <div className='auto-trades-config__group'>
                                    <p className='auto-trades-config__group-label'>Contract Type</p>

                                    {/* Trade type row */}
                                    <div className='auto-trades-config__trade-row'>
                                        <div className='auto-trades-config__field auto-trades-config__field--grow'>
                                            <label>Type</label>
                                            <select
                                                className='auto-trades-config__select'
                                                value={tradeType}
                                                onChange={e => handleTradeTypeChange(e.target.value as TradeType)}
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
                                                    <option value='RUNHIGH'>Only Ups</option>
                                                    <option value='RUNLOW'>Only Downs</option>
                                                </optgroup>
                                            </select>
                                        </div>

                                        {/* Barrier — only for digit Over/Under/Matches/Differs */}
                                        {usesLossPrediction(tradeType) && (
                                            <>
                                                <div className='auto-trades-config__field auto-trades-config__field--narrow'>
                                                    <label>Before loss</label>
                                                    <select
                                                        className='auto-trades-config__select'
                                                        value={predictionBeforeLoss}
                                                        onChange={e => setPredictionBeforeLoss(e.target.value)}
                                                        disabled={isRunning}
                                                    >
                                                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                                            <option key={d} value={String(d)}>
                                                                {d}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className='auto-trades-config__field auto-trades-config__field--narrow'>
                                                    <label>After loss</label>
                                                    <select
                                                        className='auto-trades-config__select'
                                                        value={predictionAfterLoss}
                                                        onChange={e => setPredictionAfterLoss(e.target.value)}
                                                        disabled={isRunning}
                                                    >
                                                        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                                            <option key={d} value={String(d)}>
                                                                {d}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </>
                                        )}

                                        {BARRIER_NEEDED[tradeType] && !usesLossPrediction(tradeType) && (
                                            <div className='auto-trades-config__field auto-trades-config__field--narrow'>
                                                <label>
                                                    {tradeType === 'DIGITMATCH' || tradeType === 'DIGITDIFF'
                                                        ? 'Prediction'
                                                        : 'Digit'}
                                                </label>
                                                <select
                                                    className='auto-trades-config__select'
                                                    value={barrier}
                                                    onChange={e => setBarrier(e.target.value)}
                                                    disabled={isRunning}
                                                >
                                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(d => (
                                                        <option key={d} value={String(d)}>
                                                            {d}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {isRunTradeType(tradeType) && (
                                            <div className='auto-trades-config__field auto-trades-config__field--narrow'>
                                                <label>Ticks</label>
                                                <select
                                                    className='auto-trades-config__select'
                                                    value={executionTicks}
                                                    onChange={e => setExecutionTicks(e.target.value)}
                                                    disabled={isRunning}
                                                >
                                                    <option value='2'>2</option>
                                                    <option value='3'>3</option>
                                                </select>
                                            </div>
                                        )}
                                    </div>

                                    {/* Streak length */}
                                    <div className='auto-trades-config__field' style={{ marginTop: '0.8rem' }}>
                                        <label>
                                            Streak (
                                            {isDirection ? getDirectionStreakLabel(tradeType) : 'matching digits'})
                                        </label>
                                        <div className='auto-trades-config__streak-row'>
                                            <input
                                                className='auto-trades-config__streak-slider'
                                                type='range'
                                                min='2'
                                                max='10'
                                                step='1'
                                                value={streak}
                                                onChange={e => setStreak(e.target.value)}
                                                disabled={isRunning}
                                            />
                                            <span className='auto-trades-config__streak-value'>{streak}</span>
                                        </div>
                                    </div>
                                </div>

                                {/* Money settings */}
                                <div className='auto-trades-config'>
                                    <div className='auto-trades-config__field'>
                                        <label>Stake ({currency || 'USD'})</label>
                                        <Input
                                            type='number'
                                            min='0.35'
                                            step='0.01'
                                            value={stake}
                                            onChange={e => setStake(e.target.value)}
                                            disabled={isRunning}
                                        />
                                    </div>
                                    <div className='auto-trades-config__field'>
                                        <label>Martingale ×</label>
                                        <Input
                                            type='number'
                                            min='1.01'
                                            step='0.5'
                                            value={martingale}
                                            onChange={e => setMartingale(e.target.value)}
                                            disabled={isRunning}
                                        />
                                    </div>
                                    <div className='auto-trades-config__field'>
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
                                    <div className='auto-trades-config__field'>
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

                                <div className='auto-trades-controls'>
                                    {!isRunning ? (
                                        <button
                                            className='auto-trades-controls__run'
                                            onClick={handleRun}
                                            disabled={!client.is_logged_in || selectedMarketSymbols.length === 0}
                                        >
                                            ▶ Run Auto Trades
                                        </button>
                                    ) : (
                                        <button className='auto-trades-controls__stop' onClick={handleStop}>
                                            ■ Stop
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Markets grid */}
                        <div className='auto-trades-markets'>
                            <h2 className='auto-trades-markets__title'>
                                Live Markets ({selectedMarketSymbols.length})
                                {isConnected && <span className='auto-trades-markets__live-badge'>● LIVE</span>}
                                {inCooldown && isRunning && (
                                    <span className='auto-trades-markets__cooldown-badge'>
                                        ⏳ {cooldownDisplay}t cooldown
                                    </span>
                                )}
                            </h2>
                            {selectedMarketSymbols.length === 0 && (
                                <div className='auto-trades-hint'>
                                    Select at least one market to show live quotes and enable Auto Trades.
                                </div>
                            )}
                            <div className='auto-trades-markets__grid'>
                                {marketDisplays.map(m => {
                                    const dots = Math.min(m.consecutive, streakNum);
                                    const candleReady =
                                        !isRunTradeType(tradeType) || isRunCandleMatch(tradeType, m.candleDirection);
                                    const isReady =
                                        ((m.consecutive >= streakNum && candleReady) || m.trading) && !inCooldown;
                                    return (
                                        <div
                                            key={m.symbol}
                                            className={classNames('auto-trades-market', {
                                                'auto-trades-market--ready': isReady && !m.trading && isRunning,
                                                'auto-trades-market--trading': m.trading,
                                                'auto-trades-market--win': m.lastResult === 'win' && !m.trading,
                                                'auto-trades-market--loss': m.lastResult === 'loss' && !m.trading,
                                                'auto-trades-market--cooldown': inCooldown && isRunning,
                                            })}
                                        >
                                            <div className='auto-trades-market__top'>
                                                <div>
                                                    <p className='auto-trades-market__name'>{m.label}</p>
                                                    <p className='auto-trades-market__symbol'>{m.symbol}</p>
                                                </div>
                                                <div className='auto-trades-market__controls'>
                                                    {!isRunning && (
                                                        <button
                                                            className='auto-trades-market__btn auto-trades-market__btn--remove'
                                                            onClick={() => handleRemoveMarket(m.symbol)}
                                                            title='Remove from Auto Trades'
                                                            type='button'
                                                        >
                                                            −
                                                        </button>
                                                    )}
                                                    {inCooldown && isRunning ? (
                                                        <div className='auto-trades-market__badge auto-trades-market__badge--cooldown'>
                                                            ⏳{cooldownDisplay}
                                                        </div>
                                                    ) : (
                                                        <div
                                                            className={classNames('auto-trades-market__badge', {
                                                                'auto-trades-market__badge--ready':
                                                                    isReady && isRunning,
                                                                'auto-trades-market__badge--trading': m.trading,
                                                            })}
                                                        >
                                                            {m.trading
                                                                ? 'BUYING'
                                                                : isReady && isRunning
                                                                  ? 'READY'
                                                                  : m.consecutive > 0
                                                                    ? `${m.consecutive}`
                                                                    : '—'}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Live quote */}
                                            {m.lastQuote !== null && (
                                                <div className='auto-trades-market__quote'>
                                                    {m.lastQuote.toFixed(
                                                        getMarketPipSize(
                                                            m.symbol,
                                                            AUTO_MARKET_LOOKUP.get(m.symbol)?.pip ?? 2
                                                        )
                                                    )}
                                                </div>
                                            )}

                                            {isRunTradeType(tradeType) && (
                                                <div
                                                    className={classNames('auto-trades-market__candle', {
                                                        'auto-trades-market__candle--bullish': m.candleDirection === 1,
                                                        'auto-trades-market__candle--bearish': m.candleDirection === -1,
                                                        'auto-trades-market__candle--waiting': m.candleDirection === 0,
                                                    })}
                                                >
                                                    5m candle: {getCandleDirectionLabel(m.candleDirection)}
                                                </div>
                                            )}

                                            {/* Progress indicators */}
                                            {isRunning && !inCooldown && (
                                                <div className='auto-trades-market__dots'>
                                                    {Array.from({ length: streakNum }).map((_, i) => (
                                                        <div
                                                            key={i}
                                                            className={classNames('auto-trades-market__dot', {
                                                                'auto-trades-market__dot--filled': i < dots,
                                                                'auto-trades-market__dot--ready': i < dots && isReady,
                                                            })}
                                                        />
                                                    ))}
                                                    <span className='auto-trades-market__dots-label'>
                                                        {m.consecutive}/{streakNum}
                                                    </span>
                                                </div>
                                            )}

                                            {/* Digit history (digit modes) */}
                                            {!isDirection && m.lastDigits.length > 0 && (
                                                <div className='auto-trades-market__digits'>
                                                    {m.lastDigits.slice(-5).map((d, idx) => (
                                                        <span
                                                            key={idx}
                                                            className={classNames('auto-trades-market__digit', {
                                                                'auto-trades-market__digit--low': d <= 4,
                                                                'auto-trades-market__digit--high': d > 4,
                                                            })}
                                                        >
                                                            {d}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {/* Direction history (Rise/Fall modes) */}
                                            {isDirection && m.directionHistory.length > 0 && (
                                                <div className='auto-trades-market__digits'>
                                                    {m.directionHistory.slice(-5).map((dir, idx) => (
                                                        <span
                                                            key={idx}
                                                            className={classNames('auto-trades-market__digit', {
                                                                'auto-trades-market__digit--low': dir === 1,
                                                                'auto-trades-market__digit--high': dir === -1,
                                                            })}
                                                        >
                                                            {dir === 1 ? '▲' : dir === -1 ? '▼' : '—'}
                                                        </span>
                                                    ))}
                                                </div>
                                            )}

                                            {m.tradeCount > 0 && (
                                                <div className='auto-trades-market__footer'>
                                                    <span>
                                                        {m.tradeCount} trade{m.tradeCount !== 1 ? 's' : ''}
                                                    </span>
                                                    <span
                                                        className={classNames({
                                                            'auto-trades-market__last-win': m.lastResult === 'win',
                                                            'auto-trades-market__last-loss': m.lastResult === 'loss',
                                                        })}
                                                    >
                                                        {m.lastResult === 'win' ? '✓ Win' : '✗ Loss'}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {!isRunning && availableMarkets.length > 0 && (
                                <div className='auto-trades-markets__available'>
                                    <h3 className='auto-trades-markets__subtitle'>Available markets to add</h3>
                                    <p className='auto-trades-markets__help'>
                                        Removed markets stay here with a plus button until you add them back.
                                    </p>
                                    <div className='auto-trades-markets__grid auto-trades-markets__grid--available'>
                                        {availableMarkets.map(market => (
                                            <button
                                                key={market.symbol}
                                                className='auto-trades-market-add'
                                                onClick={() => handleAddMarket(market.symbol)}
                                                type='button'
                                                title={`Add ${market.label} to Auto Trades`}
                                            >
                                                <span className='auto-trades-market-add__plus'>+</span>
                                                <div className='auto-trades-market-add__info'>
                                                    <p className='auto-trades-market-add__name'>{market.label}</p>
                                                    <p className='auto-trades-market-add__symbol'>{market.symbol}</p>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </ThemedScrollbars>

            {/* Floating Risk Disclaimer */}
            <button className='auto-trades-disclaimer-btn' onClick={() => setShowDisclaimer(true)}>
                ⚠ Risk Disclaimer
            </button>

            {showDisclaimer && (
                <div className='auto-trades-disclaimer-overlay' onClick={() => setShowDisclaimer(false)}>
                    <div className='auto-trades-disclaimer-modal' onClick={e => e.stopPropagation()}>
                        <div className='auto-trades-disclaimer-modal__header'>
                            <span className='auto-trades-disclaimer-modal__icon'>⚠</span>
                            <h3 className='auto-trades-disclaimer-modal__title'>Risk Disclaimer</h3>
                            <button
                                className='auto-trades-disclaimer-modal__close'
                                onClick={() => setShowDisclaimer(false)}
                            >
                                ✕
                            </button>
                        </div>
                        <div className='auto-trades-disclaimer-modal__body'>
                            <p>
                                Deriv offers complex derivatives, such as options and contracts for difference
                                (&ldquo;CFDs&rdquo;). These products may not be suitable for all clients, and trading
                                them puts you at risk. Please make sure that you understand the following risks before
                                trading Deriv products:
                            </p>
                            <ul>
                                <li>You may lose some or all of the money you invest in the trade.</li>
                                <li>
                                    If your trade involves currency conversion, exchange rates will affect your profit
                                    and loss.
                                </li>
                                <li>
                                    You should never trade with borrowed money or with money you cannot afford to lose.
                                </li>
                            </ul>
                        </div>
                        <div className='auto-trades-disclaimer-modal__footer'>
                            <button
                                className='auto-trades-disclaimer-modal__ok'
                                onClick={() => setShowDisclaimer(false)}
                            >
                                I Understand
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default AutoTrades;
