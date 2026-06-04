import { useCallback, useEffect, useMemo, useState } from 'react';
import './install-app-button.scss';

type TBeforeInstallPromptEvent = Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const IOS_INSTALL_MESSAGE = 'To install this app on iPhone/iPad, tap Share, then Add to Home Screen.';

const isStandaloneDisplay = () =>
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone);

const isIOSDevice = () => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const platform = window.navigator.platform.toLowerCase();

    return /iphone|ipad|ipod/.test(userAgent) || (platform === 'macintel' && window.navigator.maxTouchPoints > 1);
};

const InstallAppButton = () => {
    const [installPrompt, setInstallPrompt] = useState<TBeforeInstallPromptEvent | null>(null);
    const [isInstalled, setIsInstalled] = useState(false);
    const [showIOSHelp, setShowIOSHelp] = useState(false);

    const isiOS = useMemo(() => {
        if (typeof window === 'undefined') return false;
        return isIOSDevice();
    }, []);

    useEffect(() => {
        setIsInstalled(isStandaloneDisplay());

        const handleBeforeInstallPrompt = (event: Event) => {
            event.preventDefault();
            setInstallPrompt(event as TBeforeInstallPromptEvent);
        };

        const handleAppInstalled = () => {
            setInstallPrompt(null);
            setIsInstalled(true);
            setShowIOSHelp(false);
        };

        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        window.addEventListener('appinstalled', handleAppInstalled);

        return () => {
            window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
            window.removeEventListener('appinstalled', handleAppInstalled);
        };
    }, []);

    const handleInstallClick = useCallback(async () => {
        if (isiOS && !installPrompt) {
            setShowIOSHelp(value => !value);
            return;
        }

        if (!installPrompt) return;

        await installPrompt.prompt();
        const choice = await installPrompt.userChoice;

        if (choice.outcome === 'accepted') {
            setIsInstalled(true);
        }

        setInstallPrompt(null);
    }, [installPrompt, isiOS]);

    if (isInstalled || (!installPrompt && !isiOS)) return null;

    return (
        <div className='install-app'>
            <button className='install-app__button' type='button' onClick={handleInstallClick}>
                Install App
            </button>
            {isiOS && showIOSHelp && <p className='install-app__hint'>{IOS_INSTALL_MESSAGE}</p>}
        </div>
    );
};

export default InstallAppButton;
