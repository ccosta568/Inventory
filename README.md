# Author Inventory

Angular 17 PWA for tracking books and event sales, wired to an existing AWS HTTP API (`/books`) backed by DynamoDB.

## How it talks to AWS

- `src/environments/*.ts` contains `apiBaseUrl`. By default it points to your deployed API Gateway stage (`https://012c4578g2.execute-api.us-east-1.amazonaws.com/prod`). Update it if you deploy to a different stage.
- `BookApiService` issues `GET /books` and `POST /books` requests. The Lambda already expects/returns items shaped like `{ pk: "BOOK#<id>", sk: "METADATA", title, author, createdAt }`. The service normalizes those into the UI-friendly `Book` model.
- Only book creation is sent to the API; adjustments, prices, and notes are stored locally (offline-first) so you can continue working at shows even when you lose signal.

If you add more routes later (`PUT /books/{id}`, `/books/{id}/adjust-stock`, events, etc.), extend `BookApiService` and `InventoryStoreService` accordingly.

## Development workflow

```bash
npm install
npm start           # Angular dev server on http://localhost:4200
```

The app immediately reads from the remote `/books` endpoint (if reachable) and keeps a copy in `localStorage`. When offline, it falls back to the cached copy and queues any new book creations until the connection returns (press “Sync now” in the UI to retry manually).

## Feature overview

- **Inventory dashboard** – add titles (title + author required for the backend), adjust counts locally, and view sync status.
- **Show mode** – fast +1/-1 UI for logging sales during events. Logged events remain local so you always have a history even if the backend only stores books.
- **Reports** – lightweight rollups (total on hand, total sold, best sellers) derived from the local cache.
- **Offline/PWA** – service worker caches the shell, and all inventory/event data is stored in `localStorage`. You can install it on iOS/Android via the included manifest and icons.

## Configuration

| File | Purpose |
| --- | --- |
| `src/environments/environment.ts` | `apiBaseUrl` (HTTP API base URL, including stage). Leave the Cognito block empty unless you later add auth. |
| `src/app/services/book-api.service.ts` | Update mapping logic if your DynamoDB attributes change (e.g., you add `copiesOnHand` server-side). |
| `src/app/services/inventory-store.service.ts` | Central offline store. This is where you’d wire new API endpoints (events, adjustments, etc.) if/when they exist. |

## Extending the backend later

The repo still contains a more advanced `serverless.yml` and backend TypeScript code under `backend/` if you decide to migrate off the simple Lambda/HTTP API you have today. For now they’re optional—everything runs against the existing `/books` endpoint described at the top.

---

Need help adding new Lambda routes (e.g., `/books/{id}`, `/events`), integrating Cognito, or auto-deploying via GitHub Actions? Reach out and we can re-enable the serverless stack that ships with this repo.*** End Patch
