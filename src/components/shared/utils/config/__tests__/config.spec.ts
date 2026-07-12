import { TextEncoder } from 'util';
import { buildBestBotsFileUrl, generateOAuthURL, getDomainConfig, getDomainConfigForHost } from '../config';

describe('DOMAIN_CONFIG', () => {
    it('returns the configured Mr Chris auth and bot folder settings', () => {
        expect(getDomainConfigForHost('mr-chris-deriv.vercel.app')).toMatchObject({
            clientId: '33NNVvIyYD0iFQM4vlZJn',
            appId: '33NNVvIyYD0iFQM4vlZJn',
            redirectUri: 'https://mr-chris-deriv.vercel.app/',
            botsFolder: 'optimumtraders.site',
            canonicalHost: 'mr-chris-deriv.vercel.app',
            includeLegacyAppIdInOAuth: false,
            useLegacyOAuthLogin: false,
            ui: {
                brandName: 'Mr Chris',
                primaryColor: '#0080ff',
                secondaryColor: '#0b0d12',
                accentColor: '#4fa8ff',
            },
        });
    });

    it('falls back to the default Mr Chris UI for localhost / unregistered hosts', () => {
        const domainConfig = getDomainConfig('localhost');
        expect(domainConfig.ui).toMatchObject({
            brandName: 'Mr Chris',
            primaryColor: '#0080ff',
            secondaryColor: '#0b0d12',
            accentColor: '#4fa8ff',
        });
    });

    it('builds the Best Bots file URL from the configured bot folder', () => {
        expect(buildBestBotsFileUrl('optimumtraders.site', 'My Bot.xml')).toBe('/optimumtraders.site/My%20Bot.xml');
    });

    it('uses the working OAuth2 PKCE login wiring for mr-chris-deriv.vercel.app', async () => {
        const originalAppEnv = process.env.APP_ENV;
        const cryptoMock = {
            getRandomValues: (array: Uint8Array) => array.fill(1),
            subtle: {
                digest: jest.fn().mockResolvedValue(new Uint8Array(32).fill(2).buffer),
            },
        };
        const domainConfig = getDomainConfigForHost('mr-chris-deriv.vercel.app');

        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: cryptoMock,
        });
        Object.defineProperty(globalThis, 'TextEncoder', {
            configurable: true,
            value: TextEncoder,
        });
        process.env.APP_ENV = 'production';
        expect(domainConfig).toBeDefined();

        const oauthUrl = await generateOAuthURL(undefined, domainConfig!);
        const url = new URL(oauthUrl);

        expect(url.origin + url.pathname).toBe('https://auth.deriv.com/oauth2/auth');
        expect(url.searchParams.get('client_id')).toBe('33NNVvIyYD0iFQM4vlZJn');
        expect(url.searchParams.get('redirect_uri')).toBe('https://mr-chris-deriv.vercel.app/');
        expect(url.searchParams.get('response_type')).toBe('code');
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');

        process.env.APP_ENV = originalAppEnv;
    });
});
