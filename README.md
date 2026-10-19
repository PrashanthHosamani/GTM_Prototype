# Outmate — AI-Native GTM Intelligence & Prospecting Platform

A full-stack, AI-native Go-To-Market (GTM) intelligence and prospecting platform inspired by Orange Slice, Clay, and modern revenue intelligence engines.

Built for the Outmate technical assessment, this platform combines **Prompt-to-Spreadsheet Prospecting** (discovering matching B2B accounts via natural language ICP prompts, live web neural search, dynamic column synthesis, and verified leadership enrichment) with **12-Field Account Dossiers** (evidence-backed deep-dive company research with strict source provenance).

live : https://gtm-prototype.onrender.com/

---

## Key Capabilities

### 1. Prompt-to-Spreadsheet Prospector
- **Natural Language ICP Querying**: Describe your target ICP in plain English (e.g., *"Find 10 fast-growing US Fintech startups with over $20M in funding"* or *"Find B2B SaaS companies that use HubSpot and are hiring SDRs"*).
- **100% Live Neural Web Search**: Discovers genuine, active companies using Exa neural search across real-time web disclosures, news, and filings. Zero hardcoded mock data.
- **Dynamic Prompt-Tailored Columns**: Columns and attributes adapt on the fly based on the specific query criteria (e.g., CRM stack, headcount bands, funding rounds, decision-makers, cold outreach angles).
- **Conversational Follow-Up & Enrichment**: Continue the conversation naturally (*"Find the founders and CEOs of these companies"*, *"Add pricing model column"*, *"Filter to companies with >100 employees"*).
- **Interactive Spreadsheet UI**: Formula bar, cell inspection modal, sort/filter controls, and 1-click export to CSV & Google Sheets format.
- **Session & Search History**: Automatic session persistence with a slide-out search history drawer for instant recall.

### 2. Active Link Verification & Provenance
- **Live HTTP Status Validation**: The built-in `LinkVerifier` performs asynchronous HEAD/GET requests with redirect resolution to ensure official website URLs return healthy HTTP 200 responses.
- **Executive Profile Sanitization**: Decision-maker LinkedIn profiles and official contact URLs are strictly verified and cleaned, filtering out dead links, broken paths, and hallucinated URLs.
- **Source Audit Trail**: Every data point and qualification signal is accompanied by clickable source links for human-in-the-loop auditability.

### 3. 12-Field Account Dossiers
- **Comprehensive Pre-Call Intelligence**: Executive leadership, business model, verified customer proofs, financial telemetry, operational pain points, and high-conversion cold outreach hooks.
- **Multi-Model AI Failover**: Gemini synthesis with automatic fallback across model tiers (`gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-1.5-flash`) to ensure zero downtime.
- **Personnel Safety Filter**: Automatically filters out former employees, past interns, and stale executive mentions.

---

## Architecture

```
[Browser Client / Frontend] (HTML5, Vanilla CSS, JS)
         │
         ├──► POST /api/prospect           (New ICP prompt search)
         ├──► POST /api/prospect/followup  (Enrichment & transformation)
         ├──► GET  /api/prospect/session/* (Session restoration)
         └──► POST /api/research           (12-Field company dossier)
         │
         ▼
[FastAPI Gateway] (app/api/routes.py)
         │  • Pydantic schema validation & session routing
         ▼
[Agent Orchestrator & Services]
         │
         ├──► [Prospect Service] (app/services/prospect_service.py)
         │       • Intent analysis & criteria extraction
         │       • Exa neural company discovery
         │       • Dynamic spreadsheet assembly & audit synchronization
         │
         ├──► [Research Service] (app/services/research_service.py)
         │       • 12-field pre-call dossier generation
         │       • Personnel safety filtering (ex-employees, past interns)
         │
         ├──► [External Providers]
         │       • Exa Neural Search (app/providers/exa.py)
         │       • Moldset Enrichment Adapter (app/providers/moldset.py)
         │
         ├──► [AI Synthesizer] (app/services/ai_synthesizer.py)
         │       • Structured Gemini schema extraction
         │       • Multi-model failover pool
         │
         ├──► [Link Verifier] (app/services/link_verifier.py)
         │       • Asynchronous HTTP URL verification & redirect resolution
         │       • LinkedIn profile sanitization & domain matching
         │
         └──► [SQLite Session Store] (app/db/session_store.py)
                 • Conversational message history & sheet state persistence
```

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

# Start the application server
uvicorn app.main:app --reload --port 8000
```

Once running, access:
- **Platform Web App**: [http://localhost:8000](http://localhost:8000)
- **Prompt Prospector View**: [http://localhost:8000/?view=prospect](http://localhost:8000/?view=prospect)
- **Company Dossier View**: [http://localhost:8000/?view=deep](http://localhost:8000/?view=deep)
- **Interactive OpenAPI Docs**: [http://localhost:8000/docs](http://localhost:8000/docs)
- **Health Check**: [http://localhost:8000/api/health](http://localhost:8000/api/health)

### 3. Run with Docker

```bash
# Build the Docker image
docker build -t outmate-prototype .

# Run the container
docker run -d -p 8000:8000 --name outmate-container --env-file .env outmate-prototype
```

---

## Running Tests

Automated tests verify endpoint contracts, schema validation, live link verification, personnel safety filtering, and state synchronization:

```bash
PYTHONPATH=. pytest tests/test_api.py -v
```

**Test Suite Coverage:**
- `test_health_check`: Service status and provider discovery
- `test_schema_validation`: Input validation and error handling
- `test_moldset_fallback_decoupling`: Graceful fallback without mock hallucination
- `test_prospect_schema`: Dynamic spreadsheet row/column schema adherence
- `test_data_quality_normalization`: Clean URL extraction and formatting
- `test_intent_routing_company_vs_people`: Intelligent prompt routing
- `test_fictional_and_anonymous_rejection`: Quality filter for verified accounts
- `test_headcount_qualification_bounds`: Headcount band validation
- `test_disqualified_industries`: Out-of-ICP industry rejection
- `test_linkedin_url_sanitization`: Verified executive URL validation
- `test_crm_evidence_explicit_mention`: Tech stack evidence qualification
- `test_missing_decision_maker_prevents_qualification`: Decision-maker integrity
- `test_synchronized_summary_and_audit_counts`: Summary vs table consistency
- `test_new_search_vs_followup_intent_disambiguation`: Conversational state routing

---

## API Reference

### POST `/api/prospect`
Discovers matching companies from natural language prompt, extracts dynamic columns, and returns an interactive spreadsheet.

**Request:**
```json
{
  "prompt": "Find 10 B2B SaaS companies with 50-500 employees that use HubSpot or Salesforce",
  "session_id": "session_1792440000"
}
```

### POST `/api/prospect/followup`
Applies conversational enrichment, column addition, or row filtering on top of an existing sheet.

**Request:**
```json
{
  "prompt": "Find the founders and decision makers for these companies",
  "session_id": "session_1792440000",
  "current_columns": [...],
  "current_rows": [...]
}
```

### POST `/api/research`
Generates a comprehensive 12-field pre-call research dossier for a specific company name and website.

**Request:**
```json
{
  "name": "Orange Slice",
  "website": "https://orangeslice.ai",
  "research_objective": "Evaluate whether this company could be a good prospect for a B2B GTM service."
}
```

### GET `/api/health`
Returns system status, active version, and configuration detection for external providers.

---

## Project Structure

```
outmate-gtm-prototype/
├── app/
│   ├── api/
│   │   └── routes.py             # Route handlers (/api/prospect, /api/research, /api/health)
│   ├── db/
│   │   ├── session_store.py      # SQLite session history & message persistence
│   │   └── __init__.py
│   ├── providers/
│   │   ├── exa.py                # Exa neural web search with exact scoping
│   │   ├── moldset.py            # Moldset adapter with clean fallback handling
│   │   └── __init__.py
│   ├── schemas/
│   │   ├── company.py            # 12-field dossier Pydantic models
│   │   ├── prospect.py           # Dynamic spreadsheet & copilot models
│   │   └── __init__.py
│   ├── services/
│   │   ├── agent_orchestrator.py # Conversational follow-up & enrichment coordinator
│   │   ├── ai_synthesizer.py     # Gemini synthesis with multi-model failover
│   │   ├── link_verifier.py      # Async HTTP link & LinkedIn URL verification
│   │   ├── prospect_service.py   # ICP extraction, Exa search, & table assembly
│   │   ├── research_service.py   # 12-field dossier pipeline & leadership safety
│   │   └── __init__.py
│   └── main.py                   # FastAPI app entry point & static file mounting
├── frontend/
│   ├── index.html                # Unified GTM dashboard (Prospector & Dossier)
│   ├── style.css                 # Responsive stylesheet & locked vertical chat layout
│   └── app.js                    # Dynamic sheet rendering, cell inspector, & state
├── tests/
│   └── test_api.py               # 16 automated test suites
├── Dockerfile                    # Production container build definition
├── requirements.txt              # Pinned Python dependencies
└── README.md
```
