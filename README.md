# Outmate — AI-Powered GTM Research Prototype

A working prototype for automated B2B company research and data enrichment, inspired by Orange Slice and Clay.

I built this project for the Outmate technical assessment to demonstrate how an AI-native GTM platform can turn a simple company name and website into an evidence-backed company research dossier.

live : https://gtm-prototype.onrender.com/

---

## What It Does

When evaluating prospects, sales teams typically spend 15 to 20 minutes manually searching across company websites, news articles, LinkedIn, and funding databases. This prototype automates that discovery workflow in around 20 to 30 seconds:

- Runs targeted neural web searches using Exa across multiple angles (company overview, recent funding, executive leadership, tech stack, and customer references).
- Connects to an external enrichment provider (Moldset) through an adapter. If credentials are not configured, it handles the missing provider gracefully without fabricating fake data.
- Synthesizes findings using Google Gemini with an automatic multi-model failover pool to prevent rate limits or daily quota exhaustion on the free tier.
- Verifies leadership data by filtering out former employees, past interns, and stale executives.
- Cites source URLs for every factual claim so users can click through and verify the evidence.
- Provides a clean, responsive web interface with live progress tracking and 1-click JSON export.

---

## How It Works

```
[User / Browser Client]
         │
         │  POST /api/research {"name": "Stripe", "website": "stripe.com"}
         ▼
[FastAPI Gateway] (app/api/routes.py)
         │  Validates input data with Pydantic
         ▼
[Research Orchestrator] (app/services/research_service.py)
         │
         ├──► [Exa Neural Search] (app/providers/exa.py)
         │       • Scoped queries with exact company name and domain
         │       • News, funding, leadership, tech stack, and customers
         │       • Strips out sitemaps, robots.txt, and localized mirror pages
         │
         ├──► [Moldset Adapter] (app/providers/moldset.py)
         │       • Dispatches live requests if MOLDSET_API_KEY is present
         │       • Returns explicit fallback notice if unconfigured
         │
         ▼
[AI Synthesizer] (app/services/ai_synthesizer.py)
         │  Multi-model pool (Gemini 3.5 Flash → 3.7 Flash → 3.5 Lite)
         │  Extracts 12 structured fields and assigns confidence levels
         ▼
[Personnel Safety Filter] (app/services/research_service.py)
         │  Rejects former employees, ex-founders, and past interns
         ▼
[Structured Company Dossier]
         │  Returned to frontend with full source audit trail
         ▼
[Frontend UI & JSON Export] (http://localhost:8000)
```

<img width="958" height="1990" alt="image" src="https://github.com/user-attachments/assets/ae65d452-bf46-4811-ab34-a0bc121d44cf" />

---

## Getting Started

### Prerequisites
- Python 3.11 or higher (or Docker)
- Exa API Key from [exa.ai](https://exa.ai)
- Gemini API Key from [Google AI Studio](https://aistudio.google.com)

### 1. Environment Setup

Clone the repository and set up your `.env` file:

```bash
git clone https://github.com/outmate/gtm-research-prototype.git
cd gtm-research-prototype
```

Create a `.env` file in the root directory:

```env
EXA_API_KEY=your_exa_api_key_here
GEMINI_API_KEY=your_gemini_api_key_here

# Optional: Set this if you have Moldset access
# MOLDSET_API_KEY=your_moldset_api_key_here
```

### 2. Run with Python

```bash
# Install dependencies
pip install -r requirements.txt

# Start the development server
uvicorn app.main:app --reload --port 8000
```

Once running, open:
- Dashboard: [http://localhost:8000](http://localhost:8000)
- Interactive API Docs: [http://localhost:8000/docs](http://localhost:8000/docs)
- Health Check: [http://localhost:8000/api/health](http://localhost:8000/api/health)

### 3. Run with Docker

```bash
# Build the image
docker build -t outmate-prototype .

# Run the container
docker run -p 8000:8000 --env-file .env outmate-prototype
```

---

## Running Tests

I wrote automated unit tests with `pytest` covering the health check endpoint, input validation, and schema structure:

```bash
PYTHONPATH=. pytest tests/
```

---

## API Reference

### POST `/api/research`
Takes a target company name and website, runs live web discovery and enrichment, and returns a structured GTM dossier.

**Request:**
```json
{
  "name": "Orange Slice",
  "website": "https://orangeslice.ai",
  "reasearch_objective": "Evaluate whether this company could be a good prospect for a B2B GTM service."
}
```

**Response Fields:**
- `company_name`: Verified company name.
- `website`: Official website URL.
- `company_description`: Sourced 3–4 sentence executive overview.
- `industry`: Business domain or category.
- `target_market`: Primary customer profile and ICP.
- `employee_size`: Estimated headcount band with source date.
- `funding_info`: Capital raised, recent rounds, and valuation context.
- `recent_growth_signals`: Date-stamped expansions, funding rounds, or product launches.
- `potential_gtm_opportunity`: Practical outreach angles based on their current stage.
- `decision_makers`: Current active founders and executive leadership.
- `official_contact_pages`: Direct links to contact, support, or about pages.
- `firmographics`: Headquarters, business model, and documented tech stack.
- `field_confidence`: Reliability ratings (`verified`, `inferred`, `provider-reported`, `unavailable`).
- `source_urls`: List of all source URLs referenced during research.

### GET `/api/health`
Returns the status of the service and indicates whether external API keys are detected:

```json
{
  "status": "healthy",
  "exa_configured": true,
  "moldset_configured": false,
  "version": "0.1.0",
  "timestamp": "2026-10-19T02:00:00Z"
}
```

---

## Project Structure

```
outmate-gtm-prototype/
├── app/
│   ├── api/
│   │   └── routes.py             # API route handlers (/api/research, /api/health)
│   ├── providers/
│   │   ├── exa.py                # Exa neural web search with exact query scoping
│   │   └── moldset.py            # Moldset adapter with clean fallback handling
│   ├── schemas/
│   │   ├── company.py            # Pydantic schemas for the 12 company fields
│   │   └── __init__.py
│   ├── services/
│   │   ├── research_service.py   # Pipeline orchestrator & leadership filtering
│   │   ├── ai_synthesizer.py     # Gemini synthesis with multi-model failover
│   │   └── __init__.py
│   └── main.py                   # FastAPI app entry point & static files
├── frontend/
│   ├── index.html                # Research dashboard interface
│   ├── style.css                 # Clean CSS styling
│   └── app.js                    # UI state handling and progress tracking
├── tests/
│   └── test_api.py               # API & schema unit tests
├── Dockerfile                    # Container build configuration
├── example_output.json           # Example research output (Stripe)
├── requirements.txt              # Python dependencies
└── README.md
```

---

## Known Limitations and Next Steps

- **Single Company Ingestion:** The prototype is currently designed for single-company lookups. A natural next step is adding CSV and Google Sheets bulk uploads using background job queues (Redis and Celery).
- **Caching Layer:** Caching research results by canonical domain for 7 to 14 days would prevent redundant API calls for common companies and keep costs down.
- **Provider Waterfall:** Expanding `MoldsetProvider` into a multi-provider waterfall (e.g., Clearbit, Apollo, PDL) would improve coverage when a single provider has gaps.
