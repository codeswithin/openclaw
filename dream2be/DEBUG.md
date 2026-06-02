# Debug Mode (Presenter Page)

Append `?debug` to the presenter page URL to show debug info on each dream card:

```
https://dream2be-agi.surge.sh/present.html?debug
https://dream2be.surge.sh/present.html?debug
```

## What it shows

- **Large dream number** (top-right of each card) — the sequential `#id` assigned by the server
- **Timestamp** (below the dream text) — `HH:MM:SS.mmm` in 24-hour local time, showing exactly when the server received the dream

## How it works

The URL is checked client-side:

```js
const isDebug = location.search.includes('debug');
```

When `true`, the `addDream()` function injects extra HTML into each dream card. The timestamps and IDs are rendered from the same data the normal view uses — nothing is faked or extra-requested from the server.

## Why

Useful for:
- Verifying real-time latency (compare the timestamp against your watch)
- Tracking dream ordering / dropped packets
- Testing / QA on the live feed
