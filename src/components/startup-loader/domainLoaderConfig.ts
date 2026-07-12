export interface DomainLoaderConfig {
    siteName: string;
    domain: string;
    welcomeText: string;
    subtitle: string;
    logo?: string;
    primaryColor: string;
    secondaryColor: string;
    accentColor: string;
    backgroundColor: string;
    loaderText: string;
    footerText: string;
    fallingSymbols: string[];
    duration: number;
    messages: string[];
}

const DEFAULT_MESSAGES = [
    'Initializing secure environment...',
    'Connecting to trading services...',
    'Loading market analysis tools...',
    'Synchronizing live data...',
    'Preparing your dashboard...',
    'Launching application...',
];

// Colors sampled from the Chris Tech (CT) logo: vivid blue + near-black.
const MR_CHRIS_LOADER_COLORS = {
    primaryColor: '#0080ff',
    secondaryColor: '#0b0d12',
    accentColor: '#4fa8ff',
    backgroundColor: '#05070c',
} as const;

const createLoaderConfig = (
    domain: string,
    siteName: string,
    colors: Pick<DomainLoaderConfig, 'primaryColor' | 'secondaryColor' | 'accentColor' | 'backgroundColor'>,
    subtitle = 'Chris Tech Trading Platform'
): DomainLoaderConfig => ({
    siteName,
    domain,
    welcomeText: `Welcome to ${siteName}`,
    subtitle,
    logo: undefined,
    ...colors,
    loaderText: 'Preparing your trading environment',
    footerText: `Powered by ${siteName}`,
    fallingSymbols: ['$', '\u20AC', '\u00A3', '\u20BF'],
    duration: 6000,
    messages: DEFAULT_MESSAGES,
});

export const domainLoaderConfig: Record<string, DomainLoaderConfig> = {
    'mr-chris-deriv.vercel.app': createLoaderConfig(
        'mr-chris-deriv.vercel.app',
        'Mr Chris',
        MR_CHRIS_LOADER_COLORS
    ),
    localhost: createLoaderConfig('localhost', 'Mr Chris', MR_CHRIS_LOADER_COLORS, 'Testing Environment'),
};

export const defaultLoaderConfig: DomainLoaderConfig = {
    siteName: 'Mr Chris',
    domain: typeof window !== 'undefined' ? window.location.hostname : 'unknown',
    welcomeText: 'Welcome to Mr Chris',
    subtitle: 'Preparing your trading experience',
    logo: undefined,
    primaryColor: '#0080ff',
    secondaryColor: '#0b0d12',
    accentColor: '#4fa8ff',
    backgroundColor: '#05070c',
    loaderText: 'Initializing application',
    footerText: 'Secure Trading Environment',
    fallingSymbols: ['$', '\u20AC', '\u00A3'],
    duration: 6000,
    messages: DEFAULT_MESSAGES,
};
