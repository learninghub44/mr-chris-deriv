import {
    computePercentage,
    getPercentageSnapshot,
    getPredictionForLastOutcome,
    isPercentageSignalReady,
    normalizeAiAutoTradePlan,
    parseAiAutoTradeStrategy,
} from '../auto-trades';

describe('computePercentage', () => {
    it('should correctly calculate the percentage', () => {
        expect(computePercentage(100, 50)).toBe(50);
        expect(computePercentage(200, 50)).toBe(25);
        expect(computePercentage(10, 1)).toBe(10);
    });

    it('should handle zero baseAmount safely', () => {
        expect(computePercentage(0, 50)).toBe(0);
    });

    it('should handle NaN inputs safely', () => {
        expect(computePercentage(NaN, 50)).toBe(0);
        expect(computePercentage(100, NaN)).toBe(0);
        expect(computePercentage(NaN, NaN)).toBe(0);
    });

    it('should round to 2 decimal places', () => {
        expect(computePercentage(3, 1)).toBe(33.33);
        expect(computePercentage(7, 2)).toBe(28.57);
    });

    it('should handle negative values if they occur', () => {
        expect(computePercentage(100, -50)).toBe(-50);
    });
});

describe('percentage mode trade calculations', () => {
    const buildState = (digitHistory: number[], digitPercentages: Record<number, number>, extra = {}) =>
        ({
            digitHistory,
            digitPercentages,
            directionSampleHistory: [],
            confidenceScore: 90,
            ...extra,
        }) as any;

    it('calculates Digit Over and Under against the selected barrier', () => {
        const state = buildState(Array(100).fill(0), {
            0: 4,
            1: 4,
            2: 5,
            3: 5,
            4: 6,
            5: 20,
            6: 20,
            7: 16,
            8: 12,
            9: 8,
        });

        expect(getPercentageSnapshot('DIGITOVER' as any, state, 4)).toMatchObject({
            primaryLabel: 'Over 4',
            primaryPercentage: 76,
            secondaryPercentage: 24,
            confidence: 90,
            sampleSize: 100,
        });
        expect(getPercentageSnapshot('DIGITUNDER' as any, state, 5)).toMatchObject({
            primaryLabel: 'Under 5',
            primaryPercentage: 24,
            secondaryPercentage: 76,
        });
    });

    it('does not execute percentage signals until enough samples are collected', () => {
        const state = buildState(
            Array(99).fill(7),
            { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 99, 8: 0, 9: 0 },
            { confidenceScore: 100 }
        );

        expect(isPercentageSignalReady('DIGITOVER' as any, state, 4)).toBe(false);
    });

    it('executes percentage signals when percentage, confidence, and sample size are valid', () => {
        const state = buildState(
            Array(100).fill(7),
            { 0: 1, 1: 1, 2: 1, 3: 1, 4: 1, 5: 20, 6: 20, 7: 20, 8: 20, 9: 15 },
            { confidenceScore: 92 }
        );

        expect(isPercentageSignalReady('DIGITOVER' as any, state, 4)).toBe(true);
    });
});

describe('Over/Under prediction selection', () => {
    const baseConfig = {
        prediction_before_loss: 4,
        prediction_after_loss: 7,
        fallback_barrier: 2,
    };

    it('uses Prediction Before Loss after a previous win', () => {
        expect(
            getPredictionForLastOutcome({
                trade_type: 'DIGITOVER',
                last_result: 'win',
                ...baseConfig,
            })
        ).toBe(4);
    });

    it('uses Prediction After Loss after a previous loss', () => {
        expect(
            getPredictionForLastOutcome({
                trade_type: 'DIGITUNDER',
                last_result: 'loss',
                ...baseConfig,
            })
        ).toBe(7);
    });

    it('uses Prediction Before Loss for the first trade before any previous outcome exists', () => {
        expect(
            getPredictionForLastOutcome({
                trade_type: 'DIGITOVER',
                last_result: null,
                ...baseConfig,
            })
        ).toBe(4);
    });

    it('keeps non Over/Under contracts on the normal barrier value', () => {
        expect(
            getPredictionForLastOutcome({
                trade_type: 'DIGITMATCH',
                last_result: 'loss',
                ...baseConfig,
            })
        ).toBe(2);
    });
});

describe('parseAiAutoTradeStrategy', () => {
    it('understands an Over strategy with after-loss prediction, ticks, and V25 market', () => {
        const result = parseAiAutoTradeStrategy(
            'I want to trade over 1 and in case of a loss over 3 using 1 tick only on V25 index'
        );

        expect(result.settings).toMatchObject({
            tradeType: 'DIGITOVER',
            predictionBeforeLoss: '1',
            predictionAfterLoss: '3',
            analysisTicks: '1',
            selectedMarketSymbols: ['R_25'],
            strategyMode: 'STANDARD',
        });
        expect(result.warnings).toHaveLength(0);
    });

    it('maps one-second volatility requests to 1HZ symbols', () => {
        const result = parseAiAutoTradeStrategy('Only trade over 4 on volatility 25 1s using 2 ticks');

        expect(result.settings).toMatchObject({
            tradeType: 'DIGITOVER',
            predictionBeforeLoss: '4',
            analysisTicks: '2',
            selectedMarketSymbols: ['1HZ25V'],
        });
    });

    it('understands direction strategies and risk settings', () => {
        const result = parseAiAutoTradeStrategy('Rise on V50 with streak 5 stake 2 martingale 3 take profit 20 stop loss 10');

        expect(result.settings).toMatchObject({
            tradeType: 'CALL',
            selectedMarketSymbols: ['R_50'],
            streak: '5',
            stake: '2',
            martingale: '3',
            takeProfit: '20',
            stopLoss: '10',
        });
    });

    it('normalizes OpenAI strategy plans before applying settings', () => {
        const result = normalizeAiAutoTradePlan({
            settings: {
                tradeType: 'DIGITOVER',
                predictionBeforeLoss: '1',
                predictionAfterLoss: '99',
                analysisTicks: '3',
                selectedMarketSymbols: ['R_25', 'BOOM500'],
                stake: '2',
                strategyMode: 'PERCENTAGE',
            },
            summary: ['Use over 1'],
            warnings: [],
            unsupportedCapabilities: ['BOOM500 market is not supported by Auto Trades.'],
            source: 'openai',
        });

        expect(result.settings).toMatchObject({
            tradeType: 'DIGITOVER',
            predictionBeforeLoss: '1',
            analysisTicks: '3',
            selectedMarketSymbols: ['R_25'],
            stake: '2',
            strategyMode: 'PERCENTAGE',
        });
        expect(result.settings.predictionAfterLoss).toBeUndefined();
        expect(result.unsupportedCapabilities).toEqual(['BOOM500 market is not supported by Auto Trades.']);
    });
});
