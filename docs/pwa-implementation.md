# Risk managers PWA implementation

## Project setup

This project uses React with Rsbuild/Rspack. It does not use Vite, so `vite-plugin-pwa` is not installed. PWA support is implemented with root public assets and a manual service worker.

## Files

- `public/manifest.webmanifest`: PWA manifest.
- `public/sw.js`: root-scope service worker.
- `public/offline.html`: safe offline fallback.
- `public/icons/*`: Android, iOS, desktop, and maskable icons.
- `src/pwa/register-service-worker.ts`: browser service worker registration.
- `src/components/install-app-button/*`: reusable install UI.
- `src/components/layout/header/header.tsx`: header placement for the install control.
- `index.html`: PWA, Apple, viewport, and theme metadata.

## Manifest

The manifest identifies the installed app as:

- Name: Risk managers
- Short name: Risk managers
- Description: Web-based trading platform by Mr Duke
- Theme color: `#0f172a`
- Background color: `#000000`
- Display mode: `standalone`
- Orientation: `portrait`
- Start URL: `/`
- Scope: `/`

## Caching policy

Only static application assets are cached:

- JavaScript bundles
- CSS
- images
- fonts
- icons
- the app shell navigation response
- offline fallback page

The service worker does not cache sensitive trading data. Requests are forced to the network if they are cross-origin, use an `Authorization` header, or include sensitive trading/auth terms such as:

- `/api`
- `/oauth`
- `/callback`
- `/front-channel.html`
- `authorize`
- `balance`
- `account`
- `token`
- `buy`
- `sell`
- `statement`
- `proposal`
- `proposal_open_contract`
- `portfolio`
- `profit_table`
- `transaction`

WebSocket traffic is not cached by service workers. If the app is offline, trading must stop or wait for reconnection.

## Offline fallback

When a navigation request fails, users see:

`You are offline. Please reconnect to continue trading safely.`

## Install UI

The `InstallAppButton` component listens for `beforeinstallprompt` and shows an `Install App` button only when supported. It hides itself after installation.

For iPhone and iPad, programmatic installation is not available, so the component shows:

`To install this app on iPhone/iPad, tap Share, then Add to Home Screen.`

## Local testing

Run:

```bash
npm run build
npm run serve
```

Then open:

```text
http://localhost:8443
```

Chrome allows service workers on localhost. For non-local domains, HTTPS is required.

## Chrome DevTools verification

1. Open DevTools.
2. Go to Application > Manifest.
3. Confirm the manifest loads and all icons return `200`.
4. Go to Application > Service Workers.
5. Confirm `/sw.js` is registered with scope `/`.
6. Go to Application > Cache Storage.
7. Confirm no tokens, balances, account details, or trade history are stored.
8. Run Lighthouse and check installability/PWA warnings.

## Platform install instructions

Android:

- Open the site in Chrome or Edge.
- Tap Install app or Add to Home screen.
- The in-app `Install App` button can trigger the prompt when the browser supports it.

iPhone/iPad:

- Open the site in Safari.
- Tap Share.
- Tap Add to Home Screen.

Windows/macOS:

- Open the site in Chrome or Edge.
- Use the address-bar install icon or the in-app `Install App` button when available.

## Production checklist

- Serve every domain over HTTPS.
- Confirm `/manifest.webmanifest` returns `200`.
- Confirm `/sw.js` returns `200` from the root path.
- Confirm icon files return `200` and match the required sizes.
- Keep OAuth redirect URLs registered for every production domain.
- Confirm installed app launches at `/`.
- Confirm Cache Storage contains no private account data.
- Test offline behavior before enabling live trading from an installed app.
