# Packet 12 — web_search Backend Investigation

## The problem

`src/alienclaw/bridge/runners/web_search.py` defaults to `https://ddg-webapp-aagd.vercel.app/search` — a Vercel deployment nobody in the AlienClaw project controls. It could disappear without warning. When it disappears, web_search silently returns an error and genomes get fitness=0.0 rather than a meaningful signal.

---

## Options surveyed

### Option 1: DuckDuckGo HTML scraper (direct)

**URL:** `https://html.duckduckgo.com/html/?q={query}`  
**Method:** GET, parse HTML response  
**API key:** None  
**Pros:** No API key, no third-party intermediary  
**Cons:** HTML scraping is fragile (DOM structure can change); requires BeautifulSoup or stdlib html.parser; adds ~100 lines to parse `<a class="result__a">` tags  
**Hermetic-test-friendly:** Yes (ALIENCLAW_SEARCH_URL override still works)  
**Fragility:** HIGH — DDG can change HTML at any time; no versioning  
**Config burden for operators:** None  

### Option 2: DuckDuckGo Instant Answer API

**URL:** `https://api.duckduckgo.com/?q={query}&format=json&no_html=1`  
**Method:** GET, JSON response  
**API key:** None  
**Pros:** No API key; official JSON API; more stable than HTML scrape  
**Cons:** Instant Answer API returns summaries/facts, NOT traditional search results. `RelatedTopics` may have 0 results for many queries. Entirely unsuitable for web_search behavior.  
**Hermetic-test-friendly:** Yes  
**Verdict:** NOT viable for general web search  

### Option 3: Brave Search API

**URL:** `https://api.search.brave.com/res/v1/web/search?q={query}&count={n}`  
**Method:** GET, JSON response  
**API key:** Required (free tier: 2000 queries/month)  
**Pros:** High-quality results; well-maintained JSON API; no scraping  
**Cons:** API key required — operators must register and configure; adds infrastructure burden for every new install  
**Hermetic-test-friendly:** Yes (mock URL still works)  
**Fragility:** LOW (paid API with SLA)  
**Config burden:** HIGH — each operator must register at api.search.brave.com  

### Option 4: SearXNG self-hosted

**URL:** Operator-configured  
**API key:** None (or operator-configured)  
**Pros:** Maximum control; no external dependency; open source  
**Cons:** Requires running a SearXNG instance — Docker or bare metal; significant setup burden for every operator  
**Config burden:** VERY HIGH  
**Verdict:** Appropriate for power users; wrong default for AlienClaw  

### Option 5: Remove default backend — require operator configuration

**Implementation:** Delete the hardcoded Vercel URL. If `ALIENCLAW_SEARCH_URL` is not set, return empty results with `_not_configured: true` in output and fitness=0.5 (neutral).  
**API key:** None  
**Pros:** Removes the uncontrolled dependency entirely; honest — operator must choose their backend; ALIENCLAW_SEARCH_URL override already works in tests; 5 lines of code  
**Cons:** web_search produces no results by default; operators who want web_search must configure it  
**Hermetic-test-friendly:** YES — stub pattern already in use  
**Config burden:** Minimal — set one env var; well-documented in web_search.msb  
**Fragility:** ZERO — no third-party URL  

---

## Decision: Option 5

**Remove the hardcoded Vercel URL. Require ALIENCLAW_SEARCH_URL env var.**

Reasoning:
1. The immediate gap (uncontrolled URL) is fixed with 5 lines of code, not 100.
2. The Vercel wrapper was always meant to be a placeholder. The ALIENCLAW_SEARCH_URL override exists precisely because we knew we'd swap the backend.
3. Adding HTML scraping or requiring API keys adds new fragility or infrastructure burden that is worse than the problem being solved.
4. The right long-term story for web_search is operator-configurable. Option 5 makes that explicit.
5. Evolution and audit still work — web_search with no URL returns a consistent low-fitness result that genomes can't exploit differently.

**Documentation impact:** web_search.msb CAPABILITIES section updated to note that ALIENCLAW_SEARCH_URL must be configured. No PARAMETER_SCHEMA changes needed.

---

## Implementation

Change the default from the Vercel URL to `""` (empty). When no URL is set:
- Return `RunResult(ok=False, error="web_search backend not configured", ...)` with `correctness=0.0`
- OR return `RunResult(ok=True, output={"results": [], "_not_configured": true}, correctness=0.5)`

Going with the error path (ok=False, correctness=0.0) because it's honest — the operation genuinely fails without a backend. Evolution learns to avoid genomes that call web_search when the backend is absent, which is correct behavior.

The stub server pattern in the diagnostics audit (ALIENCLAW_SEARCH_URL set to stub URL) continues working identically.
