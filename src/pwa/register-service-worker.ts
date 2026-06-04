const SERVICE_WORKER_URL = '/sw.js';
const UPDATE_CHECK_INTERVAL = 60 * 60 * 1000;

export const registerServiceWorker = () => {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker
            .register(SERVICE_WORKER_URL, { scope: '/' })
            .then(registration => {
                registration.update();

                window.setInterval(() => {
                    registration.update();
                }, UPDATE_CHECK_INTERVAL);
            })
            .catch(error => {
                console.error('Risk managers service worker registration failed:', error);
            });
    });
};
