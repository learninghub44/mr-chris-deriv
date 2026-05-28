import { buildBestBotsFileUrl, getDomainConfigForHost } from '../config';

describe('DOMAIN_CONFIG', () => {
    it('returns the configured TermicaFX auth and bot folder settings', () => {
        expect(getDomainConfigForHost('termicafx.site')).toMatchObject({
            clientId: '33h4ThjleZotVMiKQ1gE7',
            appId: '124217',
            redirectUri: 'https://termicafx.site/',
            botsFolder: 'optimumtraders.site',
            features: {
                botIdeas: false,
                scanner: false,
                printPopups: false,
                autoTrades: false,
                comboTrades: false,
            },
        });
    });

    it('keeps Bot Ideas and Scanner enabled on Risk Managers', () => {
        expect(getDomainConfigForHost('riskmanagers.site')?.features).toMatchObject({
            botIdeas: true,
            scanner: true,
            printPopups: true,
            autoTrades: true,
            comboTrades: true,
        });
    });

    it.each([
        ['mrzetuzetu.site', '80364', '33gJ6p5dXzASAIobgv9az'],
        ['masterhunter.site', '96223', '33g5WCS5YOFHD3aWLZZjj'],
        ['tradinghubs.site', '122208', '33hi7ev9NiDjWY640JuSw'],
        ['mafiahub.site', '120589', '331bCUS8izRudblAnSACt'],
    ])('wires %s to its legacy app ID and new OAuth client ID', (host, appId, clientId) => {
        expect(getDomainConfigForHost(host)).toMatchObject({
            appId,
            clientId,
            redirectUri: `https://${host}/`,
            botsFolder: 'optimumtraders.site',
            features: {
                autoTrades: true,
                comboTrades: true,
            },
        });
        expect(getDomainConfigForHost(`www.${host}`)).toMatchObject({ appId, clientId });
    });

    it('builds the Best Bots file URL from the configured bot folder', () => {
        expect(buildBestBotsFileUrl('termicafx.site', 'My Bot.xml')).toBe('/termicafx.site/My%20Bot.xml');
    });
});
