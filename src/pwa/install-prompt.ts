export type TBeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

export const PWA_INSTALLED_STORAGE_KEY = 'risk_managers_pwa_installed';

const INSTALL_PROMPT_CHANGED = 'risk-managers-install-prompt-changed';

let deferredInstallPrompt: TBeforeInstallPromptEvent | null = null;
let hasSetupInstallPromptCapture = false;
const installPromptEvents = new EventTarget();

const emitInstallPromptChange = () => {
    installPromptEvents.dispatchEvent(new Event(INSTALL_PROMPT_CHANGED));
};

export const isStandaloneDisplay = () => {
    if (typeof window === 'undefined') return false;

    return (
        window.matchMedia('(display-mode: standalone)').matches ||
        Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone)
    );
};

export const isPwaInstalled = () => {
    if (typeof window === 'undefined') return false;

    return isStandaloneDisplay() || window.localStorage.getItem(PWA_INSTALLED_STORAGE_KEY) === 'true';
};

export const markPwaInstalled = () => {
    window.localStorage.setItem(PWA_INSTALLED_STORAGE_KEY, 'true');
    deferredInstallPrompt = null;
    emitInstallPromptChange();
};

export const getDeferredInstallPrompt = () => deferredInstallPrompt;

export const clearDeferredInstallPrompt = () => {
    deferredInstallPrompt = null;
    emitInstallPromptChange();
};

export const subscribeToInstallPrompt = (callback: () => void) => {
    installPromptEvents.addEventListener(INSTALL_PROMPT_CHANGED, callback);

    return () => installPromptEvents.removeEventListener(INSTALL_PROMPT_CHANGED, callback);
};

export const setupInstallPromptCapture = () => {
    if (typeof window === 'undefined' || hasSetupInstallPromptCapture) return;

    hasSetupInstallPromptCapture = true;

    window.addEventListener('beforeinstallprompt', event => {
        if (isPwaInstalled()) return;

        event.preventDefault();
        deferredInstallPrompt = event as TBeforeInstallPromptEvent;
        emitInstallPromptChange();
    });

    window.addEventListener('appinstalled', () => {
        markPwaInstalled();
    });
};
