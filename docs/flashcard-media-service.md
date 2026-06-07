# dream2be Flashcard Media Service — Technical Design

## Overview

A backend media provider and cache layer for dream2be flashcard topics — an optional mode that serves kid/infant-friendly photos, illustrations, and videos. Aggregates from multiple free image/video APIs (Pexels, Pixabay, Unsplash), caches approved media in Cloudflare R2, and serves them via a CDN URL. The frontend never calls external APIs directly.

Each flashcard can have both a **static image** and a **short looping video** — for example, "Dog" shows a photo of a dog as the thumbnail, and an autoplaying video of a dog wagging its tail as the interactive card.

---

## Architecture

```
Presentater (KOLI)
     │
     ▼
┌──────────────────┐
│   KOLI API        │  ← Existing backend
│   /v1/flashcards  │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────────────────────┐
│  Media Service (new microservice)         │
│                                           │
│  GET /internal/media/search?q=lion        │
│  GET /internal/media/search?q=lion&type=video
│                                           │
│  1. Check R2 cache (image + video)        │
│  2. If miss → search Pixabay (img+vid)    │
│  3. If miss → search Pexels (img+vid)     │
│  4. Apply safe-content filter             │
│  5. Generate thumbnail from video         │
│  6. Store in R2                           │
│  7. Return CDN URLs                       │
└──────────────────┬────────────────────────┘
                   │
      ┌────────────┴────────────┐
      │                         │
      ▼                         ▼
┌──────────────┐       ┌────────────────┐
│  Pixabay     │       │   Pexels       │
│  (images     │       │  (images +     │
│   + videos)  │       │   videos)      │
└──────────────┘       └────────────────┘
      │                         │
      └────────────┬────────────┘
                   ▼
      ┌─────────────────────────────┐
      │  Cloudflare R2              │
      │  (image + video cache)      │
      │  cdn.koli.co/cards/         │
      └─────────────────────────────┘
                   │
                   ▼
      ┌─────────────────────────────┐
      │  Cloudflare CDN             │
      │  (cached globally)          │
      │  + Cloudflare Stream (opt.) │
      └─────────────────────────────┘
```

---

## Data Model

### Flashcard Concept (curated catalog)

```json
{
  "id": "dog",
  "word": "Dog",
  "category": "animals",
  "imageUrl": "https://cdn.koli.co/cards/dog.jpg",
  "thumbnailUrl": "https://cdn.koli.co/cards/thumbs/dog.jpg",
  "videoUrl": "https://cdn.koli.co/cards/videos/dog.mp4",
  "videoThumbnailUrl": "https://cdn.koli.co/cards/thumbs/dog-video.jpg",
  "mediaType": "both",
  "source": "pixabay",
  "sourceId": "12345",
  "language": "en",
  "translations": {
    "ms": "Anjing",
    "zh": "狗"
  }
}
```

### Media Types

| mediaType | Has image | Has video | Use case                                         |
| --------- | --------- | --------- | ------------------------------------------------ |
| `image`   | ✅        | ❌        | Static flashcards (colors, shapes, numbers)      |
| `video`   | ❌        | ✅        | Animated flashcards (actions like "run", "jump") |
| `both`    | ✅        | ✅        | Best — image thumbnails + interactive video card |

### R2 Storage Layout

```
cdn.koli.co/cards/
├── dog.jpg                    # Full-size image (800×800, max 200KB)
├── dog.avif                   # Next-gen format (smaller, when available)
├── thumbs/dog.jpg             # Thumbnail (200×200, max 30KB)
├── thumbs/dog-video.jpg       # Video poster frame
├── videos/
│   ├── dog.mp4                # Short looping video (max 5s, ~500KB-2MB)
│   └── dog.webm               # WebM alternative for browsers
├── manifest.json              # Full catalog index
└── categories.json            # Category listing
```

---

## API Endpoints

### Public (served to presenter interface)

| Method | Endpoint                                   | Description                                    |
| ------ | ------------------------------------------ | ---------------------------------------------- |
| GET    | `/v1/flashcards/categories`                | List all categories                            |
| GET    | `/v1/flashcards?category=animals&limit=20` | Get cards by category                          |
| GET    | `/v1/flashcards/search?q=elephant`         | Search cards                                   |
| GET    | `/v1/flashcards/{id}`                      | Get single card with translations + media URLs |

### Internal (admin/ingestion only)

| Method | Endpoint                                   | Description                                   |
| ------ | ------------------------------------------ | --------------------------------------------- |
| GET    | `/internal/media/search?q=lion`            | Search all sources, return best image + video |
| GET    | `/internal/media/search?q=lion&type=video` | Search only video sources                     |
| GET    | `/internal/media/search?q=lion&type=image` | Search only image sources                     |
| POST   | `/internal/media/approve`                  | Approve media → move to curated catalog       |
| POST   | `/internal/media/ingest`                   | Batch ingest a list of concepts               |
| POST   | `/internal/media/regenerate-thumb`         | Regenerate video thumbnail for a card         |

---

## Caching Strategy

### Two-Tier Cache

**Tier 1: In-Memory (hot cache)**

- LRU cache with 1000 entries
- TTL: 1 hour for API search results
- TTL: 24 hours for approved/curated media URLs
- Avoids DB/R2 reads for frequently accessed cards

**Tier 2: Cloudflare R2 (cold cache)**

- Persistent media store — images and videos stored once, served forever
- Cloudflare CDN edge caching for global low latency
- Cache-Control:
  - Images: `public, max-age=31536000, immutable`
  - Videos: `public, max-age=31536000, immutable` (never re-fetched)
  - Thumbnails: `public, max-age=604800` (weekly refresh)

### Cache Flow

```
Request: GET /internal/media/search?q=lion
  │
  ├─ Tier 1 hit? → Return cached result
  │
  └─ Tier 1 miss?
      ├─ R2 has lion.jpg + lion.mp4? → Return CDN URLs
      └─ R2 miss?
          ├─ Search Pixabay (images + videos)
          ├─ Search Pexels (images + videos)
          ├─ Apply safe-content filter
          ├─ Download best image + best video
          ├─ Generate 200×200 thumbnail
          ├─ Extract video poster frame → thumbnail
          ├─ Upload to R2
          │   ├─ cards/lion.jpg
          │   ├─ cards/thumbs/lion.jpg
          │   ├─ cards/videos/lion.mp4
          │   └─ cards/thumbs/lion-video.jpg
          ├─ Update Tier 1 cache
          └─ Return CDN URLs
```

### Cache Invalidation

- **Manual:** Admin panel → force re-fetch a concept (image + video separately)
- **Auto:** On media approval → invalidate Tier 1 cache for that card
- **Batch:** On catalog rebuild → clear entire Tier 1 cache
- **Video-specific:** If a better video source is found, invalidate only the video URL

---

## Video Optimization

### Constraints

| Property     | Target                      | Reason                                                                      |
| ------------ | --------------------------- | --------------------------------------------------------------------------- |
| Duration     | 3–5 seconds                 | Short enough for attention spans, long enough to show the action            |
| Resolution   | 640×360 or 480×270          | Mobile-friendly, fast loading                                               |
| File size    | ≤ 2 MB                      | Won't delay card flips on mobile data                                       |
| Format       | MP4 (H.264) + WebM (VP9)    | Wide browser/device support                                                 |
| Audio        | None                        | Baby flashcards don't need background audio; word pronunciation is separate |
| Loop         | Seamless                    | Card should auto-loop for continuous engagement                             |
| Poster frame | First frame or middle frame | Shown while video loads                                                     |

### Video Processing Pipeline

```
Source video (Pexels/Pixabay, any length)
  │
  ▼
┌──────────────────┐
│ 1. Download       │
│ 2. Trim to 5s     │  Pick the best 5-second segment
│ 3. Resize to 640w │  Maintain aspect ratio
│ 4. Encode H.264   │  MP4 container, CRF 23
│ 5. Encode VP9     │  WebM container (for browsers)
│ 6. Extract frame  │  Pick frame at 50% position as poster
│ 7. Generate thumb │  200×200 from poster frame
│ 8. Upload to R2   │  /cards/videos/{id}.mp4
└──────────────────┘
```

### ffmpeg Pipeline (for automated ingestion)

```bash
# Trim to 5s, resize to 640px wide, compress
ffmpeg -i source.mp4 -t 5 -vf "scale=640:-2" -c:v libx264 -crf 23 -preset medium \
  -an -movflags +faststart output.mp4

# WebM alternative
ffmpeg -i source.mp4 -t 5 -vf "scale=640:-2" -c:v libvpx-vp9 -crf 30 -b:v 0 \
  -an output.webm

# Extract poster frame at 50% duration
ffmpeg -i source.mp4 -ss 00:00:02.5 -vframes 1 -vf "scale=640:-2" poster.jpg
```

---

## Video Sources

| Source             | Video API Endpoint                                           | Rate Limit | Quality                             | Best For                                               |
| ------------------ | ------------------------------------------------------------ | ---------- | ----------------------------------- | ------------------------------------------------------ |
| **Pixabay Videos** | `https://pixabay.com/api/videos?key=...&q=dog`               | 100 req/s  | Up to 1920×1080, varies by uploader | **Primary** — includes cartoons/animated illustrations |
| **Pexels Videos**  | `https://api.pexels.com/videos/search?query=dog&per_page=15` | 200 req/hr | Curated, high quality, mostly 1080p | Real-action video fallback                             |

### Pixabay Video API

```javascript
// Search Pixabay for videos
const url = `https://pixabay.com/api/videos?key=${KEY}&q=${query}&safesearch=true&per_page=20`;

// Response includes videos array with: id, pageURL, tags, duration, videos[]
// videos.large.url → 1920px
// videos.medium.url → 1280px
// videos.small.url → 640px (recommended for mobile)
// videos.tiny.url → 320px
```

### Pexels Video API

```javascript
// Search Pexels for videos (requires PEXELS_API_KEY)
const url = `https://api.pexels.com/videos/search?query=${query}&per_page=15&orientation=landscape`;
const res = await fetch(url, { headers: { Authorization: PEXELS_API_KEY } });

// Response includes: id, width, height, duration, video_files[]
// video_file[].link → download URL
// video_file[].quality → 'hd', 'sd', 'hls'
// video_file[].width/height → resolution
```

---

## Safe-Content Filtering

Since this is for babies, filtering is critical — even more so for video.

### Filter Rules

1. **Block by category:** Exclude categories: `people`, `sexuality`, `health`, `fashion`, `weaponry`, `music`
2. **Block by keyword:** Filter results containing: `naked`, `blood`, `gun`, `knife`, `alcohol`, `cigarette`, `war`, `violence`, `kiss`, `romantic`
3. **Block by NSFW flag:** Both APIs provide NSFW flags — always exclude
4. **Minimum resolution:** Reject images < 400×400, reject videos < 480×270
5. **Video duration limit:** Reject videos shorter than 1s or longer than 60s (too short/long for cards)
6. **Aspect ratio:** Reject extremely tall/wide (> 2:1 ratio)
7. **Manual approval gate:** Every piece of media must be approved before appearing in the curated catalog

### Automatic Search-Phase Filtering

```javascript
async function searchMedia(query, options = {}) {
  const { type = "all" } = options;
  const promises = [];

  if (type === "all" || type === "image") {
    promises.push(pixabay.searchImages(query));
    promises.push(pexels.searchImages(query));
  }
  if (type === "all" || type === "video") {
    promises.push(pixabay.searchVideos(query));
    promises.push(pexels.searchVideos(query));
  }

  const results = await Promise.allSettled(promises);

  return results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .filter((media) => {
      if (media.type === "image") {
        return media.width >= 400 && media.height >= 400;
      }
      if (media.type === "video") {
        return (
          media.duration >= 1 && media.duration <= 60 && media.width >= 480 && media.height >= 270
        );
      }
      return false;
    })
    .filter((media) => !media.tags?.some((t) => BLOCKED_TAGS.has(t.toLowerCase())))
    .filter((media) => media.nsfw !== true)
    .slice(0, 20);
}
```

---

## Media Sources Summary

| Source       | Images | Videos | Free Tier  | Content Types                                    | Best For                                                                            |
| ------------ | ------ | ------ | ---------- | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| **Pixabay**  | ✅ API | ✅ API | 100 req/s  | Photos, illustrations, vectors, cartoons, videos | **Primary source** — only source with both images AND videos, includes cartoon mode |
| **Pexels**   | ✅ API | ✅ API | 200 req/hr | High-quality photos + videos                     | Real-photo + real-action video fallback                                             |
| **Unsplash** | ✅ API | ❌     | 50 req/hr  | Premium photos                                   | Photo-only supplement                                                               |

**Pixabay is the single best source** because it's the only major free API that provides **both images and videos** with generous rate limits, safe content, and illustration/cartoon support.

---

## Deployment

### Option A: Cloudflare Worker (Recommended)

```javascript
// workers/flashcard-media-service.js
export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/v1/flashcards")) {
      return handleFlashcardRequest(request);
    }

    if (url.pathname.startsWith("/internal/media")) {
      return handleMediaSearch(request);
    }
  },
};
```

**Benefits:**

- Zero server management
- R2 binding for media storage
- Cloudflare Stream (optional) for advanced video delivery with adaptive bitrate
- Free tier: 100k requests/day

### Option B: Express Endpoint on KOLI Backend

```
POST /api/flashcards/media/search
POST /api/flashcards/media/approve
GET  /api/flashcards/catalog
```

Video processing happens via `ffmpeg` spawned as a subprocess, or via a dedicated video processing service.

---

## Curated Catalog (Pre-Build, ~500-1000 Concepts)

### Categories with Video Priority

| #   | Category   | Concepts | Video Priority | Example Concepts                                                  |
| --- | ---------- | -------- | -------------- | ----------------------------------------------------------------- |
| 1   | Animals    | 100+     | **High**       | dog (wagging tail), cat (meowing), bird (flying), fish (swimming) |
| 2   | Actions    | 50+      | **High**       | run, jump, eat, drink, sleep, swim, fly                           |
| 3   | Vehicles   | 30+      | **High**       | car (driving), train (moving), airplane (flying), boat (sailing)  |
| 4   | Food       | 60+      | Medium         | apple, banana, milk, bread                                        |
| 5   | Body Parts | 20+      | Low            | hand, eye, nose, ear                                              |
| 6   | Household  | 50+      | Medium         | chair, table, cup, spoon                                          |
| 7   | Nature     | 40+      | Medium         | sun, moon, star, tree, flower                                     |
| 8   | Colors     | 12       | Low            | red, blue, green, yellow                                          |
| 9   | Shapes     | 10       | Low            | circle, square, triangle, star                                    |
| 10  | Numbers    | 10       | Low            | one, two, three...                                                |
| 11  | Alphabet   | 26       | Low            | A-Z with example words                                            |

### Catalog JSON Structure

```json
{
  "version": 2,
  "updatedAt": "2026-06-07T00:00:00Z",
  "languages": ["en", "ms", "zh"],
  "categories": {
    "animals": {
      "label": { "en": "Animals", "ms": "Haiwan", "zh": "动物" },
      "icon": "🐾",
      "cards": ["dog", "cat", "elephant"]
    },
    "actions": {
      "label": { "en": "Actions", "ms": "Tindakan", "zh": "动作" },
      "icon": "🏃",
      "cards": ["run", "jump", "eat"]
    }
  },
  "cards": {
    "dog": {
      "word": { "en": "Dog", "ms": "Anjing", "zh": "狗" },
      "imageUrl": "https://cdn.koli.co/cards/dog.jpg",
      "videoUrl": "https://cdn.koli.co/cards/videos/dog.mp4",
      "mediaType": "both",
      "source": "pixabay",
      "category": "animals"
    },
    "run": {
      "word": { "en": "Run", "ms": "Lari", "zh": "跑" },
      "imageUrl": "https://cdn.koli.co/cards/run.jpg",
      "videoUrl": "https://cdn.koli.co/cards/videos/run.mp4",
      "mediaType": "video",
      "source": "pexels",
      "category": "actions"
    }
  }
}
```

---

## Implementation Phases

### Phase 1: Manual Curated Catalog — Images Only (MVP)

- Pre-select 200-300 concepts
- Manually search + download from Pixabay
- Upload to R2 directly
- Serve static catalog from JSON
- No live API calls needed
- **Time:** 1-2 days

### Phase 2: Add Live Search + R2 Cache

- Implement `GET /internal/media/search`
- Integrate Pixabay (images)
- Integrate Pexels (images) as fallback
- Implement Tier 1 + Tier 2 caching
- **Time:** 2-3 days

### Phase 3: Video Support

- Add Pixabay video API integration
- Add Pexels video API integration
- Implement ffmpeg video processing pipeline
- Video R2 storage + CDN delivery
- Thumbnail/poster frame generation
- Add `videoUrl` and `mediaType` to data model
- **Time:** 3-4 days

### Phase 4: Approval Pipeline

- Admin approval UI
- Batch ingest from search results
- Auto-resize and thumbnail generation
- Multi-language translation support
- **Time:** 2-3 days

---

## Key Design Decisions

- **R2 over S3**: Cloudflare R2 has no egress fees, integrates seamlessly with Cloudflare Workers/CDN. Since KOLI already uses Cloudflare Workers for media uploads, this is the natural fit.
- **Curated catalog over live search**: Pre-approved media guarantees quality and safety. Live search is only for content ingestion, never for runtime app behavior.
- **Pixabay as primary source**: It's the only major free API that provides both images AND videos with cartoon/illustration content ideal for babies.
- **Short looping videos**: 3-5 second clips without audio. Audio (word pronunciation) is a separate track managed by the presenter interface.
- **No API keys on mobile**: All API calls go through the backend. Mobile app only sees CDN URLs.
- **Translations in the catalog**: Store translations alongside each card so the same image/video can serve multiple languages without re-fetching.
- **Separate video pipeline**: Video processing (trimming, resizing, poster extraction) is more complex than image processing. Phase 3 keeps it isolated.

## Appendix: API Rate Limits & Licensing Notes

### Shared Quotas (Photos + Videos)

Both Pixabay and Pexels treat images and videos as **the same API quota** — they share a single rate limit bucket per API key.

| Provider    | Endpoints                                         | Default Rate Limit                    | Best For                                |
| ----------- | ------------------------------------------------- | ------------------------------------- | --------------------------------------- |
| **Pixabay** | `/api/` (images) + `/api/videos/` (videos)        | **100 requests / 60s** (per key)      | Photos, illustrations, cartoons, videos |
| **Pexels**  | `/v1/search` (photos) + `/videos/search` (videos) | **200 requests / hour**, 20,000/month | High-quality photos + videos            |

```javascript
// Pixabay — both count toward the same 100 req/min limit
GET /api/?q=dog           // image search
GET /api/videos/?q=dog    // video search

// Pexels — both count toward the same 200 req/hr limit
GET /v1/search?query=dog          // photo search
GET /videos/search?query=dog      // video search
```

### Why Pixabay Wins for Baby Flashcards

| Feature               | Pixabay                      | Pexels                       |
| --------------------- | ---------------------------- | ---------------------------- |
| Photos                | ✅ Yes                       | ✅ Yes                       |
| Illustrations         | ✅ Yes                       | ⚠️ Limited                   |
| Cartoons              | ✅ Yes                       | ⚠️ Limited                   |
| Kid-friendly drawings | ✅ Common                    | ❌ Less common               |
| Videos                | ✅ Yes                       | ✅ Yes                       |
| Rate limit            | 100 req/min                  | 200 req/hr                   |
| API key               | Same key for images + videos | Same key for photos + videos |

### Realistic API Usage

For a flashcard feature, the API is only called during **initial content ingestion**, not during runtime app usage. The typical flow:

```
Pixabay API
    ↓
Import images + videos once (~500-1000 concepts)
    ↓
Store in Cloudflare R2
    ↓
Serve from CDN forever (zero API calls)
```

In this architecture, you might only make **a few hundred API requests total** while building your library. Rate limits are unlikely to be an issue.

### Licensing & Caching Requirements

**Pixabay** requires:

- ✅ Caching API results is allowed and encouraged
- ❌ Permanent hotlinking of image/video URLs is discouraged — serve from your CDN instead
- ✅ Downloaded media can be used permanently after download

**Pexels** requires:

- ✅ Downloaded photos/videos can be stored and used permanently
- ❌ Do not proxy or hotlink directly — download and serve from your CDN

### Key Takeaway

Pixabay's free tier is **more than sufficient** for a library of 500-1,000 baby flashcards. The combination of illustrations, cartoons, and photos — all from a single API with generous rate limits — makes it the clear choice.

Pexels serves as a quality fallback for real-photo concepts (animals, nature, vehicles) where Pixabay's results may be thin or lack variety.
