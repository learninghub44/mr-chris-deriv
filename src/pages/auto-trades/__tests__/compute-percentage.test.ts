import { computePercentage, getPercentageSnapshot, isPercentageSignalReady } from '../auto-trades';

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
        const state = buildState(
            Array(100).fill(0),
            { 0: 4, 1: 4, 2: 5, 3: 5, 4: 6, 5: 20, 6: 20, 7: 16, 8: 12, 9: 8 }
        );

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
