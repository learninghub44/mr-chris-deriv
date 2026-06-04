const STATIC_CACHE = 'risk-managers-static-v1';
const APP_SHELL_CACHE = 'risk-managers-shell-v1';
const OFFLINE_URL = '/offline.html';

const CORE_ASSETS = [
    OFFLINE_URL,
    '/manifest.webmanifest',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/icons/apple-touch-icon.png',
    '/icons/maskable-icon-512x512.png',
];

const SENSITIVE_PATH_PARTS = [
    '/api',
    '/oauth',
    '/callback',
    '/front-channel.html',
    'authorize',
    'balance',
    'account',
    'token',
    'buy',
    'sell',
    'statement',
    'proposal',
    'proposal_open_contract',
    'portfolio',
    'profit_table',
    'transaction',
];

const SENSITIVE_QUERY_PARTS = ['token', 'oauth', 'code', 'state', 'account', 'balance', 'loginid', 'authorize'];

const isSameOrigin = url => url.origin === self.location.origin;

const isSensitiveRequest = request => {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();
    const search = url.search.toLowerCase();

    if (!isSameOrigin(url)) return true;
    if (request.headers.has('Authorization')) return true;
    if (SENSITIVE_PATH_PARTS.some(part => pathname.includes(part))) return true;
    if (SENSITIVE_QUERY_PARTS.some(part => search.includes(part))) return true;

    return false;
};

const isStaticAsset = request => {
    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase();
    const staticDestinations = ['script', 'style', 'image', 'font', 'worker'];

    return (
        isSameOrigin(url) &&
        (staticDestinations.includes(request.destination) ||
            pathname.startsWith('/assets/') ||
            pathname.startsWith('/js/') ||
            pathname.startsWith('/static/') ||
            /\.(?:css|js|png|jpg|jpeg|svg|webp|gif|ico|woff2?|ttf)$/i.test(pathname))
    );
};

const cacheFirstStatic = async request => {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    const response = await fetch(request);
    if (response && response.ok) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(request, response.clone());
    }

    return response;
};

const networkFirstNavigation = async request => {
    try {
        const response = await fetch(request);
        if (response && response.ok) {
            const cache = await caches.open(APP_SHELL_CACHE);
            cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        return (
            (await caches.match(request)) ||
            (await caches.match('/')) ||
            (await caches.match(OFFLINE_URL)) ||
            new Response('You are offline. Please reconnect to continue trading safely.', {
                status: 503,
                statusText: 'Service Unavailable',
                headers: { 'Content-Type': 'text/plain' },
            })
        );
    }
};

self.addEventListener('install', event => {
    event.waitUntil(
        caches
            .open(STATIC_CACHE)
            .then(cache => cache.addAll(CORE_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches
            .keys()
            .then(cacheNames =>
                Promise.all(
                    cacheNames
                        .filter(cacheName => ![STATIC_CACHE, APP_SHELL_CACHE].includes(cacheName))
                        .map(cacheName => caches.delete(cacheName))
                )
            )
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    const { request } = event;

    if (request.method !== 'GET') return;

    if (isSensitiveRequest(request)) {
        event.respondWith(fetch(request));
        return;
    }

    if (request.mode === 'navigate') {
        event.respondWith(networkFirstNavigation(request));
        return;
    }

    if (isStaticAsset(request)) {
        event.respondWith(cacheFirstStatic(request));
    }
});
