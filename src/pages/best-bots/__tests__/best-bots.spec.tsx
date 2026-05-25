jest.mock('@/external/bot-skeleton', () => ({
    load: jest.fn(),
    save_types: { LOCAL: 'local' },
}));

jest.mock('@/hooks/useStore', () => ({
    useStore: jest.fn(),
}));

import { getBestBotsForFolder } from '../best-bots';

describe('Best Bots domain catalogs', () => {
    it('uses Termica-branded names for the TermicaFX folder', () => {
        const bots = getBestBotsForFolder('termicafx.site');

        expect(bots).toHaveLength(15);
        expect(bots.every(bot => bot.name.toLowerCase().includes('termica'))).toBe(true);
        expect(bots[0]).toMatchObject({
            name: 'Termica Pro Bot',
            file: 'D1-BY MR.DUKE(+254702490526).xml',
        });
    });

    it('keeps the original Risk Managers bot names for the Risk Managers folder', () => {
        const bots = getBestBotsForFolder('riskmanagers.site');

        expect(bots).toHaveLength(15);
        expect(bots.every(bot => bot.name === bot.file.replace(/\.xml$/, ''))).toBe(true);
        expect(bots[0]).toMatchObject({
            name: 'D1-BY MR.DUKE(+254702490526)',
            file: 'D1-BY MR.DUKE(+254702490526).xml',
        });
    });

    it('does not leak another domain catalog for an unknown folder', () => {
        expect(getBestBotsForFolder('future-domain.site')).toEqual([]);
    });
});
