# API Integration and Error-Handling Notes

## Overview
This document outlines how the prototype integrates external data providers, handles API downtime and missing credentials, and normalizes findings into verified GTM intelligence.

---

## 1. Exa Search Integration

### Purpose
Exa is our web intelligence engine. Instead of relying on static databases, we query Exa's neural search to retrieve recent news, executive changes, funding rounds, and verified customer case studies.

### Query Strategy and Disambiguation
To avoid pulling irrelevant articles or confusing similarly named companies, we scope each query with the company name and root domain. We run parallel queries targeting distinct intelligence vectors:
- **Company Overview:** Core product positioning and primary business model.
- **Growth and Funding:** Recent capital raises, valuations, hiring trends, and expansions.
- **Current Leadership:** Active founders, CEO, CTO, and executive leadership (excluding former personnel).
- **Target Market and Clients:** ICP profile, case studies, and enterprise customer references.
- **Technology Stack:** Engineering blog posts, job listings, and documentation mentioning tooling.

### Noise Filtering and Provenance
- **Domain scoping:** Queries filter out sitemaps, robots.txt files, and non-canonical localized subpaths (such as `/zh/` or `/de/`).
- **Source balancing:** Results balance direct company announcements with independent reporting from business presses (TechCrunch, Bloomberg, CNBC) to maintain objective claims.
- **Attribution:** Every factual statement retains its source URL for auditability.

### Error Handling
- Network timeouts and connection drops are handled using `httpx` timeouts (30s) and status checks.
- If Exa returns sparse or empty results for a niche query, the pipeline logs the issue and falls back to broader domain searches rather than crashing.

---

## 2. Moldset Integration and Fallback Handling

### Provider Status
Production credentials and official documentation for Moldset were not included in the project brief. To keep the pipeline functional and modular, we implemented an adapter pattern in `app/providers/moldset.py`.

### Fallback Architecture
We deliberately avoid injecting fake or synthetic enrichment data:
- **When credentials are missing:** The adapter returns a clean fallback status. The frontend surfaces an informative notice: *"Moldset enrichment unavailable: API credentials are not configured. Publicly available information is still shown; proprietary enrichment fields remain unavailable."*
- **When credentials are provided:** Setting `MOLDSET_API_KEY` in the environment activates live POST requests to the enrichment endpoint without changing any core pipeline logic.
- **Decoupled execution:** The failure or absence of Moldset never blocks Exa research or LLM synthesis.

---

## 3. Gemini Synthesis and Multi-Model Failover

### Role
The synthesizer normalizes unstructured web snippets into structured JSON matching the 12 target schema fields.

### Rate-Limit and Quota Resilience
Google Gemini's free tier has strict RPM and daily quota limits. To prevent 429 quota exhaustion errors during continuous testing, we built an automatic failover pool:
- Primary: `gemini-3.5-flash` (1,500 requests per day on free tier)
- Secondary: `gemini-3.7-flash`
- Tertiary: `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.8-flash`

If a model returns a 429 quota error or rate-limit error, the adapter catches the exception, logs the event, and transparently switches to the next available model in milliseconds.

### Strict Handling of Missing Fields
The synthesizer is constrained by prompt rules and schema validators:
- Never fabricate numbers or metrics.
- If revenue, valuation, or client names are undisclosed, the field is left empty or explicitly labeled "Not publicly disclosed."
- Every data point receives an explicit confidence classification:
  - `verified`: Corroborated with direct source links.
  - `provider-reported`: Enriched by a dedicated provider adapter.
  - `inferred`: Reasoned strategic hypotheses (such as GTM angles or estimated headcount bands).
  - `unavailable`: Data could not be confirmed from available sources.

---

## 4. Error Handling Summary

| Scenario | Component | System Behavior |
|---|---|---|
| Invalid domain or empty query | API Gateway (`routes.py`) | Returns HTTP 422 with a clear validation message |
| Exa API rate limit or outage | `ExaProvider` | Logs error, catches HTTP status, returns empty result set gracefully |
| Moldset unconfigured or down | `MoldsetProvider` | Flags status as unconfigured, bypasses provider, serves Exa web facts |
| Gemini 429 quota limit | `AISynthesizer` | Automatically fails over to the next candidate model in the pool |
| Unverifiable company fact | Normalization layer | Marks field confidence as "unavailable" with no fake numbers |
| Downstream client export | Frontend (`app.js`) | Direct client-side JSON export from memory without re-querying backend |
