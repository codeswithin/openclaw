# dream2be — Features & Roadmap

> **Light your dream and watch it soar.** A real-time dream-sharing app with a vision-board presentation feed.

---

## ✅ Current Features

### Submit Page (`index.html`)
- **Dream input** — Textarea for typing your dream (max 20 words, 200 chars)
- **Glass candle animation** — Animated wax candle with flickering flame that lights up on submit
- **Confirmation modal** — Previews the dream before submitting, with Cancel / Light it options
- **Spark burst effect** — Particle explosion animation when a dream is submitted
- **Ambient spark particles** — Rising ember-like particles on the background canvas
- **Success message** — Randomized inspirational quote after submitting
- **Socket.io integration** — Real-time submission to the dream server
- **Word limit enforcement** — Live word counter, stops at 20 words
- **Responsive design** — Works on mobile and desktop

### Presenter Page (`present.html`)
- **Live dream wall** — Real-time vision board where dreams appear as glowing cards
- **Adaptive card sizing** — Font and icon sizes adjust based on number of visible cards
- **Starfield background** — Canvas-drawn night sky with dense dim stars and occasional bright ones
- **Color-coded cards** — Each dream gets a unique hue derived from its text (12-hue palette)
- **Glow effects** — Icon glow, text glow, card border glow — all color-matched
- **Spark burst on new dream** — Full-screen particle explosion when a new dream arrives
- **Stats bar** — Live count of dreams and connected viewers
- **Connection status** — Green/offline dot indicator
- **Time-ago display** — Relative timestamps that update every 15s
- **Clock calibration** — Server-side clock sync for accurate timestamps
- **History catch-up** — Loads recent dreams on connect
- **Debug mode** — Append `?debug` to show dream IDs and timestamps on each card
- **Decorative float dots** — Tiny colored accents that drift around the wall
- **PWA support** — Installable as a standalone app on mobile/desktop
- **Max visible limit** — Caps at 50 dreams, removes oldest to keep feed fresh

### Server (`dream-server.js`)
- **HTTPS** — Secure WebSocket + REST over Let's Encrypt TLS
- **Socket.io** — Real-time bidirectional dream submission and broadcasting
- **REST endpoints** — `/health`, `/time`, `/dreams?since=N`
- **Dream history** — Stores up to 200 recent dreams in memory
- **Peer tracking** — Counts connected presenters and submitters
- **Vote system** — Dreams can receive votes (basic implementation)
- **Word-limit enforcement** — Server-side 20-word truncation (preserves newlines)
- **Profanity filtering** — Blocks vulgar/obscene language; sends rejection event to submitter

### Platform
- **PWA manifest** — Both pages have manifest.json + service worker
- **PWA install prompt** — `beforeinstallprompt` handler with install button on presenter page
- **Viewport meta tags** — iOS safe-area, status bar, etc.
- **Service worker** — Basic caching for offline support

---

## 🚧 In Development / Planned

### Content Moderation
- [x] **Server-side profanity filter** — Word-list based, rejects on submit
- [ ] **Censored replacement option** — Let admins choose between reject vs censor-and-post
- [ ] **Client-side filter feedback** — Show rejection message on submit page
- [ ] **Report button** — Allow viewers to flag inappropriate dreams
- [ ] **Admin moderation dashboard** — Review flagged dreams, remove from feed

### User Experience
- [ ] **Custom emoji picker** — Let submitters choose their dream icon
- [ ] **Sound effects** — Subtle chime on dream submission / arrival
- [ ] **Dark/light mode** — Auto-toggle based on system preference
- [ ] **Animation toggle** — Option to reduce motion for accessibility
- [ ] **Dream sharing** — Share a specific dream via URL (`/dream?id=42`)
- [ ] **Screen reader support** — ARIA labels and semantic HTML improvements

### Feed & Discovery
- [ ] **Categories / tags** — Dreams auto-tagged by sentiment or keywords
- [ ] **Trending dreams** — Highlight most upvoted dreams
- [ ] **Search** — Search past dreams by keyword
- [ ] **Archive view** — Browse older dreams beyond the 200 limit

### Technical
- [ ] **Database persistence** — Replace in-memory storage with SQLite / PostgreSQL
- [ ] **Rate limiting** — Prevent spam submissions per session/IP
- [ ] **Admin auth** — Simple token-based auth for moderation endpoints
- [ ] **Metrics / analytics** — Track dream counts, active times, peak usage
- [ ] **Webhook integration** — Post new dreams to Discord / Slack
- [ ] **Docker deployment** — Containerized for easier hosting
- [ ] **CI/CD** — Auto-deploy on git push

### Social
- [ ] **Dream reactions** — Emoji reactions beyond basic votes
- [ ] **Dream threads** — Reply to a dream (conversation-style)
- [ ] **User profiles** — Optional handle/avatar for submitters
- [ ] **Daily digest** — Email or push notification of the day's dreams

---

## Architecture

```
┌─────────────┐     WebSocket      ┌──────────────┐
│  index.html  │ ◄──────────────►  │              │
│  (submitter) │                   │  dream-server │
└─────────────┘                    │  (Node.js)   │
                                   │              │
┌─────────────┐     WebSocket      │  HTTPS/SSL   │
│ present.html│ ◄──────────────►  │  :3003       │
│ (presenter) │                   │              │
└─────────────┘                    └──────────────┘
         │                              │
         │ HTTP REST                    │
         ▼                              ▼
    GET /dreams?since=N           GET /health
                                  GET /time
```

**Current stack:** Node.js + Express + Socket.io + Let's Encrypt

---

## Staging & Deployment

- **Submit page:** `https://dream2be.surge.sh`
- **Presenter page:** `https://dream2be-agi.surge.sh/present.html`
- **API server:** `wss://api.dream2be.emyx.us:3003`
- **Local server:** PM2-managed, auto-restarts
