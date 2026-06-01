import { buildBestBotsFileUrl, getDomainConfigForHost } from '../config';

describe('DOMAIN_CONFIG', () => {
    it('returns the configured TermicaFX auth and bot folder settings', () => {
        expect(getDomainConfigForHost('termicafx.site')).toMatchObject({
            clientId: '33h4ThjleZotVMiKQ1gE7',
            appId: '124217',
            redirectUri: 'https://termicafx.site/',
            botsFolder: 'optimumtraders.site',
            includeLegacyAppIdInOAuth: true,
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
        expect(getDomainConfigForHost('riskmanagers.site')?.ui.brandName).toBe('Risk Managers');
        expect(getDomainConfigForHost('riskmanagers.site')).toMatchObject({
            redirectUri: 'https://riskmanagers.site/',
            includeLegacyAppIdInOAuth: true,
        });
    });

    it.each([
        ['mrzetuzetu.site', '33gJ6p5dXzASAIobgv9az', '80364', 'Mrzetuzetu'],
        ['masterhunter.site', '33g5WCS5YOFHD3aWLZZjj', '96223', 'Master Hunter'],
        ['tradinghubs.site', '33hi7ev9NiDjWY640JuSw', '122208', 'Trading Hubs'],
        ['mafiahub.site', '331bCUS8izRudblAnSACt', '120589', 'Mafia Hub'],
    ])('returns auth and bot folder settings for %s', (domain, clientId, appId, brandName) => {
        expect(getDomainConfigForHost(domain)).toMatchObject({
            clientId,
            appId,
            redirectUri: `https://${domain}/`,
            botsFolder: domain,
            includeLegacyAppIdInOAuth: true,
            ui: {
                brandName,
            },
            features: {
                autoTrades: true,
                comboTrades: true,
            },
        });
        expect(getDomainConfigForHost(`www.${domain}`)).toMatchObject({
            clientId,
            appId,
            redirectUri: `https://${domain}/`,
            botsFolder: domain,
            includeLegacyAppIdInOAuth: true,
            ui: {
                brandName,
            },
            features: {
                autoTrades: true,
                comboTrades: true,
            },
        });
    });

    it('builds the Best Bots file URL from the configured bot folder', () => {
        expect(buildBestBotsFileUrl('termicafx.site', 'My Bot.xml')).toBe('/termicafx.site/My%20Bot.xml');
    });
});
