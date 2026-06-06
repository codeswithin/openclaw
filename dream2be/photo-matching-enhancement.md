# Photo Matching Enhancement Proposal

## Current Problem

The photo matching works in a 3-step pipeline:

```
Dream text → extract keywords → pick best category → use category's search term → Pexels API
```

**The issue:** Specific words like "lion" or "fish" get mapped to the broad `animal` category, which uses `CATEGORY_SEARCH_TERMS['animal'] = 'wildlife animal pets nature'`. This generic query returns whatever Pexels decides is "wildlife" — mostly mammals, rarely matching the specific animal.

**Examples:**
| Dream text | Current category | Pexels search | Result |
|---|---|---|---|
| "I want to see a lion" | animal | `wildlife animal pets nature` | 🐶 random animal (not lion) |
| "I love swimming with fish" | animal | `wildlife animal pets nature` | 🐕 furry animal (not fish) |
| "I want to climb Mount Everest" | mountain | `mountain adventure hiking` | ✅ decent match |

The problem only exists when a **specific noun** gets downgraded to a **generic category search**.

---

## Proposed Solution: Direct Keyword Querying

**Add a `SPECIFIC_KEYWORDS` map that bypasses the category-level search term when the dream contains a specific noun.**

When a dream contains "lion", search Pexels directly for `"lion"` (or `"lion animal"` for context) instead of the generic `"wildlife animal pets nature"`.

### How It Works

```
Dream text → extract keywords → check SPECIFIC_KEYWORDS first
                                  ├── match → use direct Pexels query (e.g. "lion")
                                  └── no match → fall back to category-based search (existing behavior)
```

### The Mapping

```javascript
const SPECIFIC_KEYWORDS = {
  // Animals that need direct matching (not generic "animal")
  lion: "lion animal",
  tiger: "tiger animal",
  elephant: "elephant animal",
  giraffe: "giraffe animal",
  zebra: "zebra animal",
  dolphin: "dolphin ocean",
  whale: "whale ocean",
  shark: "shark underwater",
  fish: "fish underwater",
  butterfly: "butterfly insect",
  owl: "owl bird",
  eagle: "eagle bird",
  penguin: "penguin bird",
  snake: "snake reptile",
  turtle: "turtle reptile",
  horse: "horse animal",
  cat: "cat animal",
  dog: "dog animal",
  panda: "panda bear",
  wolf: "wolf animal",
  fox: "fox animal",
  monkey: "monkey animal",
  rabbit: "rabbit animal",
  bear: "bear animal",
  dragon: "dragon fantasy art",
  unicorn: "unicorn fantasy art",

  // Food items
  pizza: "pizza food",
  cake: "cake dessert",
  chocolate: "chocolate dessert",
  coffee: "coffee drink",
  ice_cream: "ice cream dessert",
  bread: "bread bakery",

  // Music instruments
  guitar: "guitar music",
  piano: "piano music",
  drum: "drums music",
  violin: "violin music",

  // Sports-equipment
  football: "football soccer sport",
  basketball: "basketball sport",
  tennis: "tennis sport",
  yoga: "yoga fitness",
  bicycle: "bicycle cycling",

  // Tech-specific
  rocket: "rocket space launch",
  robot: "robot technology",
  computer: "computer technology",
  phone: "smartphone technology",
};
```

### Algorithm Change

In `extractDreamCategory()`, instead of just returning a category name, also return the specific matched word:

```javascript
function extractDreamCategory(text) {
  // ... existing word extraction ...
  // Also track which specific word had the highest-confidence match
  return { category: bestCat, specificWord: bestWord };
}
```

Then in `getPhotoForDream()`:

```javascript
async function getPhotoForDream(text) {
  const result = extractDreamCategory(text);
  if (!result) return null;

  // If a specific keyword is matched, use its direct query
  if (result.specificWord && SPECIFIC_KEYWORDS[result.specificWord]) {
    return await getPhotoForQuery(SPECIFIC_KEYWORDS[result.specificWord], result.specificWord);
  }

  // Fall back to category-based search (existing behavior)
  return await getPhotoForCategory(result.category);
}
```

And add a new function that caches by specific keyword (not just category):

```javascript
async function getPhotoForQuery(query, cacheKey) {
  // Check cache by specific keyword
  const now = Date.now();
  const cached = photoCache.get(cacheKey);
  const cacheAge = photoCacheTimestamps.get(cacheKey) || 0;
  if (cached && cached.length > 0 && now - cacheAge < PHOTO_CACHE_TTL) {
    return cached[Math.floor(Math.random() * cached.length)];
  }

  const photos = await fetchPexelsPhotos(query);
  if (photos.length === 0) return null;

  photoCache.set(cacheKey, photos);
  photoCacheTimestamps.set(cacheKey, now);
  return photos[Math.floor(Math.random() * photos.length)];
}
```

---

## Comparison

| Dream text                   | Current result                             | With enhancement              |
| ---------------------------- | ------------------------------------------ | ----------------------------- |
| "I want to see a lion"       | Random animal from generic wildlife search | 🦁 Actual lion photo          |
| "I love swimming with fish"  | Random furry animal                        | 🐠 Fish/underwater photo      |
| "I want to climb a mountain" | Mountain photo (unchanged)                 | ✅ Same (no specific keyword) |
| "I wish I could play guitar" | Random music/instrument photo              | 🎸 Actual guitar photo        |
| "I want to eat pizza"        | Generic food photo                         | 🍕 Pizza photo                |

---

## Edge Cases Handled

1. **Multiple specific keywords** — Only the highest-scoring specific keyword is used (same scoring logic as category selection)
2. **Dream text has both specific and abstract words** — e.g., "I want to swim with dolphins in the ocean" → matches "dolphin" → searches `"dolphin ocean"` instead of generic `"wildlife animal pets nature"`
3. **Fallback + backward compatibility** — If no specific keyword matches, the existing category-based search still works
4. **Cache per-keyword** — `"lion"` cache is separate from `"dolphin"` cache, so specific photos stay fresh for each animal

---

## Implementation Effort

- ~30 lines of new code (the SPECIFIC_KEYWORDS map)
- ~5 lines changed in `extractDreamCategory()` to return the matched word
- ~10 lines for the new `getPhotoForQuery()` function
- ~5 lines changed in `getPhotoForDream()`

**Total: ~50 lines, self-contained, zero side effects.**
