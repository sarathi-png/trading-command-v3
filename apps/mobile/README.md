# Trading Command — mobile

Expo (React Native + TypeScript) client for the Trading Command V3 API. It is a
separate app with its own install and lockfile: the repository root is a Next.js
deployment and deliberately does not treat `apps/mobile` as a workspace.

## What it does

- Signs in with the operator password (`API_PASSWORD`) and keeps a 12-hour
  signed bearer session in the device keychain. The password itself is never
  stored.
- Shows system status and the watchlist, with honest freshness labels
  (`FRESH`, `STALE`, `AS OF UNAVAILABLE`).
- Reads paper positions, orders and fills, and places **paper-only** market
  orders after an explicit confirmation.
- Receives TradingView signals in a foreground-polled inbox. Opening a signal
  fills the paper ticket; nothing is ever placed automatically.
- Defaults to the paper workspace on every launch.

## What it deliberately does not do

- **No live order entry.** There is no live ticket, no arming flow and no
  exchange credentials on the device. The live workspace is read-only.
- **No charts.** Charting is deferred to the v3/M3 milestone.
- **No push notifications.** The inbox polls every 15 seconds while the app is
  in the foreground.
- **No offline cache.** Missing data renders as `unavailable`, never as zero.
- **No Pine execution.** TradingView alerts arrive through the server webhook;
  Pine Script is never run by this app.

## Run it

The API must be running and must include `POST /api/auth/mobile` (added in the
mobile backend phase). From the repository root:

```sh
npm run dev
```

Then, in another terminal:

```sh
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=http://localhost:3000 npx expo start
```

Or copy `.env.example` to `.env.local` and edit the URL there.

Open the project in Expo Go (or a development build) and sign in with the
operator password.

`EXPO_PUBLIC_API_URL` is inlined into the JavaScript bundle, so it may only hold
a public URL — never a password or exchange key.

| Target                | URL                              |
| --------------------- | -------------------------------- |
| iOS simulator         | `http://localhost:3000`          |
| Android emulator      | `http://10.0.2.2:3000`           |
| Physical device       | `http://<your-LAN-IP>:3000`      |
| Deployed API          | `https://trading-command-v3.vercel.app` (only once that deployment exposes `/api/auth/mobile`) |

The default when the variable is unset is `http://localhost:3000`.

## Verify

```sh
cd apps/mobile
npm run typecheck
npm run lint
npm test
```

`npm test` compiles the platform-free modules (`src/api/client.ts`,
`src/lib/*`) and runs them with `node --test`. The screens are verified by the
TypeScript compiler and a real Metro bundle:

```sh
npx expo export --platform ios
```

No production build or deployment is performed from this directory.

## Layout

```
app/                 expo-router routes (login, tabs: home / trade / inbox)
src/api/             typed fetch client, response types, health probe
src/auth/            SecureStore session persistence
src/lib/             formatting, signal→ticket intent, status labels
src/state/           session, workspace, settings, signals, intent providers
src/ui/              theme and shared components
tests/               node:test suites for the platform-free modules
```

## Safety notes

- Paper orders send `x-tc-workspace: paper`. The settings route intentionally
  omits the workspace header because the server rejects mode changes that carry
  one; switching to PAPER is an explicit, confirmed action on the trade screen.
- Every order carries a `client_order_id`. The id is generated once per ticket
  and reused on retry, so a timed-out request cannot double-fill. Signal
  tickets use `sig:<signal-id>`.
- A 401 or an expired session clears the keychain entry and returns to login.
