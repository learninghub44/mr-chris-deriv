import { useCallback, useEffect, useMemo, useState } from 'react';
import Dialog from '@/components/shared_ui/dialog';
import {
    clearDeferredInstallPrompt,
    getDeferredInstallPrompt,
    isPwaInstalled,
    markPwaInstalled,
    subscribeToInstallPrompt,
    TBeforeInstallPromptEvent,
} from '@/pwa/install-prompt';
import './install-app-button.scss';

const IOS_INSTALL_MESSAGE = 'To install this app on iPhone/iPad, tap Share, then Add to Home Screen.';
const INSTALL_PROMPT_WAIT_MS = 1500;

const isIOSDevice = () => {
    const userAgent = window.navigator.userAgent.toLowerCase();
    const platform = window.navigator.platform.toLowerCase();

    return /iphone|ipad|ipod/.test(userAgent) || (platform === 'macintel' && window.navigator.maxTouchPoints > 1);
};

const InstallAppButton = () => {
    const [installPrompt, setInstallPrompt] = useState<TBeforeInstallPromptEvent | null>(() =>
        getDeferredInstallPrompt()
    );
    const [isInstalled, setIsInstalled] = useState(() => isPwaInstalled());
    const [isModalVisible, setIsModalVisible] = useState(false);
    const [showIOSHelp, setShowIOSHelp] = useState(false);
    const [installNotice, setInstallNotice] = useState('');

    const isiOS = useMemo(() => {
        if (typeof window === 'undefined') return false;
        return isIOSDevice();
    }, []);

    useEffect(() => {
        const syncInstallState = () => {
            const installed = isPwaInstalled();
            const prompt = getDeferredInstallPrompt();

            setIsInstalled(installed);
            setInstallPrompt(prompt);

            if (installed) {
                setIsModalVisible(false);
                setShowIOSHelp(false);
                setInstallNotice('');
                return;
            }

            if (prompt || isiOS) {
                setIsModalVisible(true);
            }
        };

        syncInstallState();

        const unsubscribe = subscribeToInstallPrompt(syncInstallState);
        const fallbackTimer = window.setTimeout(() => {
            if (!isPwaInstalled() && !getDeferredInstallPrompt() && !isiOS) {
                setInstallNotice(
                    'The browser install prompt is still preparing. If your address bar shows Install, use it there, or keep this popup open and try Accept again.'
                );
                setIsModalVisible(true);
            }
        }, INSTALL_PROMPT_WAIT_MS);

        return () => {
            window.clearTimeout(fallbackTimer);
            unsubscribe();
        };
    }, [isiOS]);

    const handleInstallClick = useCallback(async () => {
        if (isiOS && !installPrompt) {
            setShowIOSHelp(true);
            setInstallNotice(IOS_INSTALL_MESSAGE);
            return;
        }

        if (!installPrompt) {
            setInstallNotice(
                'The browser has not made the install prompt available yet. If the Install button is visible in the address bar, use it there, or refresh once after the page finishes loading.'
            );
            return;
        }

        try {
            setInstallNotice('Your browser install confirmation is opening. Click Install there to finish.');
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;

            clearDeferredInstallPrompt();
            setInstallPrompt(null);

            if (choice.outcome === 'accepted') {
                markPwaInstalled();
                setIsInstalled(true);
                setIsModalVisible(false);
                return;
            }

            setInstallNotice(
                'Installation was not completed. This popup will return after refresh until the app is installed.'
            );
        } catch (error) {
            console.error('Risk managers install prompt failed:', error);
            setInstallNotice('The install prompt could not open. Use the browser Install button in the address bar.');
        }
    }, [installPrompt, isiOS]);

    const handleDeny = useCallback(() => {
        setIsModalVisible(false);
        setShowIOSHelp(false);
    }, []);

    if (isInstalled) return null;

    return (
        <Dialog
            cancel_button_text='Deny'
            className='install-app-modal'
            confirm_button_text={isiOS && showIOSHelp ? 'Done' : 'Accept'}
            dismissable={false}
            is_mobile_full_width={false}
            is_visible={isModalVisible}
            login={() => undefined}
            onCancel={handleDeny}
            onConfirm={isiOS && showIOSHelp ? handleDeny : handleInstallClick}
            portal_element_id='modal_root'
            title='Install Risk managers'
        >
            <div className='install-app-modal__content'>
                <p className='install-app-modal__message'>
                    Install Risk managers on this device for a faster app-like trading experience.
                </p>
                {isiOS && (
                    <p className='install-app-modal__hint'>
                        {showIOSHelp
                            ? IOS_INSTALL_MESSAGE
                            : 'iPhone and iPad installation opens from Safari Share options.'}
                    </p>
                )}
                {!isiOS && (
                    <p className='install-app-modal__hint'>
                        Choose Accept to open your browser install prompt, or Deny to continue in the browser.
                    </p>
                )}
                {installNotice && <p className='install-app-modal__notice'>{installNotice}</p>}
            </div>
        </Dialog>
    );
};

export default InstallAppButton;
