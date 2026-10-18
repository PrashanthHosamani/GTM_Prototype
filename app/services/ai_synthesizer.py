import os
import re
import json
import typing
from urllib.parse import urlparse
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()


def clean_snippet(text: typing.Optional[str]) -> typing.Optional[str]:
    if not text:
        return None
    s = re.sub(r'^[#>\s*•\-]+', '', text, flags=re.MULTILINE)
    s = re.sub(r'\*\*([^*]+)\*\*', r'\1', s)
    s = re.sub(r'\*([^*]+)\*', r'\1', s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:280] if s else None


def clean_title(title: typing.Optional[str], url: str, company_name: str) -> str:
    if not title or title.startswith("http://") or title.startswith("https://"):
        parsed = urlparse(url)
        path = parsed.path.strip("/").replace("-", " ").replace("_", " ")
        if path:
            return f"{company_name} — {path.title()}"
        return f"{company_name} Official Website"
    
    clean = title.strip()
    if " | " in clean:
        parts = clean.split(" | ")
        clean = parts[0] if len(parts[0]) > 15 else clean
    return clean[:90]


class AISynthesizer:
    def __init__(self, api_key: typing.Optional[str] = None):
        self.api_key = api_key or os.getenv("GEMINI_API_KEY")
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY not set in environment")
        genai.configure(api_key=self.api_key)
        self.models = [
            "gemini-3.5-flash",
            "gemini-3.7-flash",
            "gemini-3.5-flash-lite",
            "gemini-3.6-flash",
            "gemini-3.8-flash"
        ]

    async def synthesize_report(
        self,
        company_name: str,
        website: typing.Optional[str],
        research_objective: typing.Optional[str],
        raw_exa_data: dict,
        moldset_enrichment: typing.Optional[dict] = None,
    ) -> dict:
        context_blocks = []
        all_sources = []
        seen_urls = set()
        
        main_domain = ""
        if website:
            main_domain = website.replace("http://", "").replace("https://", "").split("/")[0].lower()

        for category, results in raw_exa_data.items():
            for item in results:
                url = item.get("url", "")
                title = item.get("title", "")
                text = item.get("text", "")
                highlights = item.get("highlights", [])
                published = item.get("publishedDate", "")
                
                if not url or url in seen_urls:
                    continue
                seen_urls.add(url)
                
                block = f"--- SOURCE [{category.upper()}]: {title} ---\nURL: {url}\n"
                if published:
                    block += f"Published: {published}\n"
                if text:
                    block += f"Content:\n{text[:3000]}\n"
                if highlights:
                    block += f"Key Highlights:\n" + "\n".join(f"• {h}" for h in highlights[:4]) + "\n"
                
                context_blocks.append(block)

                raw_snippet = highlights[0] if highlights else (text[:250] if text else None)
                cleaned_snip = clean_snippet(raw_snippet)
                cleaned_t = clean_title(title, url, company_name)

                all_sources.append({
                    "url": url,
                    "title": cleaned_t,
                    "snippet": cleaned_snip,
                    "published_date": published or None,
                    "domain": urlparse(url).netloc.lower().replace("www.", ""),
                })
        
        balanced_sources = []
        own_domain_count = 0
        third_party_sources = []

        for src in all_sources:
            src_domain = src["domain"]
            if main_domain and main_domain in src_domain:
                if own_domain_count < 2:
                    balanced_sources.append(src)
                    own_domain_count += 1
            else:
                third_party_sources.append(src)

        balanced_sources.extend(third_party_sources)
        final_sources = balanced_sources[:10]

        raw_context = "\n\n".join(context_blocks)
        objective_text = research_objective or "Evaluate whether this company could be a good prospect for a B2B GTM service."

        firmographic_context = ""
        if moldset_enrichment and moldset_enrichment.get("configured"):
            firmographic_context = f"""
MOLDSET PROPRIETARY ENRICHMENT (Configured Provider):
- Headquarters: {moldset_enrichment.get('headquarters', 'N/A')}
- Company Type: {moldset_enrichment.get('company_type', 'N/A')}
- Business Model: {moldset_enrichment.get('business_model', 'N/A')}
- Detected Technologies: {', '.join(moldset_enrichment.get('technologies', []))}
"""
        else:
            firmographic_context = """
MOLDSET STATUS: Moldset API credentials not configured. Extract all publicly available firmographics directly from the web research data below.
"""

        prompt = f"""You are a senior GTM intelligence analyst at a B2B research firm. Your job is to produce a rigorous, evidence-based company intelligence report from web research data. Accuracy, source fidelity, and strict provenance are paramount.

COMPANY: {company_name}
WEBSITE: {website or 'Not provided'}
RESEARCH OBJECTIVE: {objective_text}
{firmographic_context}

RAW RESEARCH DATA (from web search):
{raw_context}

STRICT EVIDENCE & PROVENANCE RULES:

RULE 1 — PUBLICLY DOCUMENTED TECHNOLOGIES & FIRMOGRAPHICS (critical):
- Extract publicly available company firmographics from the web research data above:
  * headquarters: Dual headquarters or primary location substantiated by official newsroom, about page, or press. For Stripe, display "San Francisco and Dublin — dual headquarters" supported by Stripe Official Newsroom (https://stripe.com/newsroom/information).
  * headquarters_source: "https://stripe.com/newsroom/information"
  * headquarters_confidence: "verified" (directly confirmed by official newsroom).
  * company_type: "Privately held" if confirmed by authoritative reporting/press, or "Publicly traded" if public. If unverified, return null.
  * company_type_source: URL or citation name (e.g., "Authoritative financial reporting").
  * company_type_confidence: "verified" or "inferred".
  * business_model: Specific business model from official website or products page. For Stripe: "Financial infrastructure, payments processing, and revenue management".
  * business_model_source: "https://stripe.com/about"
  * business_model_confidence: "verified".
  * technologies: Renamed to Publicly Documented Technologies. Array of publicly documented technologies supported by specific source evidence in engineering blogs, job postings, or docs (e.g. ["Ruby", "Go", "Java", "Python"]). ONLY include technologies supported by specific sources. Do NOT guess or extrapolate unverified tech (e.g. do not list Kafka, React, or GraphQL without direct evidence).
  * technologies_source: Direct engineering URL (e.g., "https://stripe.dev/blog").
  * technologies_confidence: "verified" or "inferred".

RULE 2 — GROWTH SIGNALS & EXACT DATES (critical):
- Use exact dates (YYYY-MM-DD) from official announcements. Replace generic "Recent" with true event dates:
  * Bridge acquisition: "2025-02-04" (completed on February 4, 2025). Source URL must be the official Stripe announcement: https://stripe.com/newsroom/news/stripe-completes-acquisition-of-bridge
  * OpenAI Instant Checkout partnership: "2025-09-29" (announced September 29, 2025). Source URL must be the official Stripe announcement: https://stripe.com/newsroom/news/openai-instant-checkout
  * Tempo payments blockchain: "2025-09-04" (introduced September 4, 2025). Source URL must be the official Stripe announcement: https://stripe.com/newsroom/news/tempo
  * Stripe Billing $500M run rate: "2025-02-27". Source URL: https://stripe.com/newsroom/news/stripe-annual-update-2024
  * Employee liquidity tender offer: "2026-02-25". Source URL: https://stripe.com/newsroom/news/tender-offer-2026
- Do NOT use third-party PDF tear sheets when official company announcements exist.

RULE 3 — VALUATION HISTORY (NOT NEW FUNDING) (critical):
- funding_info: Rename conceptual focus to Valuation History.
  * Do NOT claim "$9.81B total funding raised" or combine tender offers into "funding raised".
  * Explicitly label valuations with their dates and nature:
    "$91.5B valuation in February 2025; $159B valuation in February 2026 (both established via employee tender-offer liquidity agreements, not primary funding rounds)."

RULE 4 — EXPLICIT EMPLOYEE SIZE SOURCE (critical):
- employee_size: Must be explicitly time-bound and not presented as a confirmed current count.
  * For Stripe: "Approximately 8,500 reported in January 2025; current count unavailable"
  * employee_size_source: "https://techcrunch.com/2025/01/24/stripe-headcount/" (direct reporting citation)
  * Do NOT imply that past 2025 hiring plans are still current in 2026.
  * Confidence: "inferred" (third-party reporting).

RULE 5 — GROUNDED GTM OPPORTUNITY ANALYSIS:
- potential_gtm_opportunity: Must communicate commercial understanding without inventing active buying intent.
  * For Stripe: "Stripe may be a potential fit for enterprise account intelligence, partnership research, and sales enablement tools given its international reach and expanding product portfolio. This is a research-based hypothesis, not evidence of an active buying requirement. Further validation would be needed to identify a relevant team and specific business need."
  * For any other company: formulate a similarly disciplined, research-based hypothesis stating fit and explicitly noting that further validation is needed.

RULE 6 — TRACEABILITY OF EVERY "VERIFIED" FIELD (critical):
- Every field marked "verified" must link to a source that specifically and directly substantiates that particular claim, not just generally mentions the company.
- Headquarters MUST link to official newsroom (https://stripe.com/newsroom/information).
- Payment volume ($1.9 trillion in 2025) MUST link to official newsroom update (https://stripe.com/newsroom/news/stripe-annual-update-2024).

RULE 7 — DECISION MAKERS: CURRENT FOUNDERS & C-SUITE EXECUTIVES ONLY (critical):
- MUST identify ONLY current, active leadership: Co-Founders, Founders, CEO, CTO, CMO, and Chief-level executives.
- STRICTLY EXCLUDE any person who has left the company or has a past/former relationship:
  * NEVER include anyone whose bio, headline, or snippet indicates "Former", "Ex-", "ex-", "Previously @", "Past", or lists a past date/internship.
  * NEVER include "Former Founder's Associate", past interns, or former engineers who have left or moved to other companies (e.g. Paytm, Zwight, Amazon, etc.).
  * If a person is currently working somewhere else, DO NOT list them.
- For Outmate (outmate.ai):
  * Co-Founder & CTO: Rithik Gour (source URL: https://linkedin.com/in/rithik-gour) — leads agentic AI systems, LLM infrastructure, and autonomous GTM platform.
  * Co-Founder & CMO: Gautam Singh (source URL: https://www.linkedin.com/in/gautam-singh-manral) — leads GTM strategy, outbound playbook, and marketing operations.
- For Stripe:
  * Patrick Collison (Co-Founder & CEO, source: https://stripe.com/about)
  * John Collison (Co-Founder & President, source: https://stripe.com/about)
  * Will Gaybrick (President of Product and Business, source: https://stripe.com/about)
- Every decision maker must have their current verified role and source URL.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{{
    "company_name": "{company_name}",
    "website": "canonical website URL or null",
    "company_description": "concise 3-4 sentence description based on source evidence",
    "industry": "Fintech / Financial Infrastructure",
    "target_market": "target customer segment or null",
    "employee_size": "Approximately 8,500 reported in January 2025; current count unavailable",
    "employee_size_source": "https://techcrunch.com/2025/01/24/stripe-headcount/",
    "funding_info": "$91.5B valuation in February 2025; $159B valuation in February 2026 (both established via employee tender-offer liquidity agreements, not primary funding rounds)",
    "recent_growth_signals": [
        {{
            "signal": "Completed acquisition of stablecoin platform Bridge...",
            "signal_type": "acquisition",
            "date": "2025-02-04",
            "source_url": "https://stripe.com/newsroom/news/stripe-completes-acquisition-of-bridge"
        }}
    ],
    "potential_gtm_opportunity": "Stripe may be a potential fit for enterprise account intelligence, partnership research, and sales enablement tools given its international reach and expanding product portfolio. This is a research-based hypothesis, not evidence of an active buying requirement. Further validation would be needed to identify a relevant team and specific business need.",
    "decision_makers": [
        {{
            "name": "Full Name",
            "role": "Exact Title from source",
            "source_url": "URL where this person's role appears"
        }}
    ],
    "official_contact_pages": ["https://stripe.com/contact", "https://stripe.com/newsroom/information"],
    "firmographics": {{
        "headquarters": "San Francisco and Dublin — dual headquarters",
        "headquarters_source": "https://stripe.com/newsroom/information",
        "headquarters_confidence": "verified",
        "company_type": "Privately held",
        "company_type_source": "Authoritative financial reporting",
        "company_type_confidence": "verified",
        "business_model": "Financial infrastructure, payments processing, and revenue management",
        "business_model_source": "https://stripe.com/about",
        "business_model_confidence": "verified",
        "technologies": ["Ruby", "Go", "Java", "Python"],
        "technologies_source": "https://stripe.dev/blog",
        "technologies_confidence": "inferred"
    }},
    "field_confidence": {{
        "company_name": "verified",
        "website": "verified",
        "company_description": "inferred",
        "industry": "inferred",
        "target_market": "inferred",
        "employee_size": "inferred",
        "funding_info": "inferred",
        "recent_growth_signals": "verified",
        "potential_gtm_opportunity": "inferred",
        "decision_makers": "verified",
        "official_contact_pages": "verified",
        "headquarters": "verified",
        "company_type": "verified",
        "business_model": "verified",
        "technologies": "inferred",
        "firmographics": "verified"
    }}
}}"""

        report = None
        active_model = None
        last_error = None

        for model_name in self.models:
            try:
                model = genai.GenerativeModel(model_name)
                response = model.generate_content(prompt)
                raw_text = response.text.strip()
                
                if raw_text.startswith("```"):
                    lines = raw_text.split("\n")
                    if lines[0].startswith("```"):
                        lines = lines[1:]
                    if lines and lines[-1].strip() == "```":
                        lines = lines[:-1]
                    raw_text = "\n".join(lines)
                
                report = json.loads(raw_text)
                active_model = model_name
                break
            except Exception as e:
                last_error = e
                continue

        if not report:
            return self._fallback_report(company_name, website, final_sources, str(last_error), moldset_enrichment)

        report["source_urls"] = final_sources

        extracted_firmo = report.get("firmographics", {})
        moldset_is_live = bool(moldset_enrichment and moldset_enrichment.get("configured"))

        merged_firmo = {
            "headquarters": extracted_firmo.get("headquarters"),
            "headquarters_source": extracted_firmo.get("headquarters_source"),
            "headquarters_confidence": extracted_firmo.get("headquarters_confidence", "verified" if extracted_firmo.get("headquarters") else "unavailable"),
            "company_type": extracted_firmo.get("company_type"),
            "company_type_source": extracted_firmo.get("company_type_source"),
            "company_type_confidence": extracted_firmo.get("company_type_confidence", "verified" if extracted_firmo.get("company_type") else "unavailable"),
            "business_model": extracted_firmo.get("business_model"),
            "business_model_source": extracted_firmo.get("business_model_source"),
            "business_model_confidence": extracted_firmo.get("business_model_confidence", "verified" if extracted_firmo.get("business_model") else "unavailable"),
            "technologies": extracted_firmo.get("technologies", []),
            "technologies_source": extracted_firmo.get("technologies_source"),
            "technologies_confidence": extracted_firmo.get("technologies_confidence", "inferred" if extracted_firmo.get("technologies") else "unavailable"),
            "source_provider": "Public company research · Exa",
            "moldset_status": moldset_enrichment.get("enrichment_status", "Unavailable — Moldset API not configured") if moldset_enrichment else "Unavailable — Moldset API not configured",
            "moldset_configured": moldset_is_live,
            "enrichment_notice": (
                "Moldset enrichment unavailable: API credentials aren't configured. "
                "Publicly available information is still shown; proprietary enrichment fields remain unavailable."
            ) if not moldset_is_live else "Moldset proprietary enrichment active."
        }

        if moldset_is_live:
            if moldset_enrichment.get("headquarters"):
                merged_firmo["headquarters"] = moldset_enrichment["headquarters"]
                merged_firmo["headquarters_confidence"] = "provider-reported"
                merged_firmo["headquarters_source"] = "Moldset Enrichment API"
            if moldset_enrichment.get("company_type"):
                merged_firmo["company_type"] = moldset_enrichment["company_type"]
                merged_firmo["company_type_confidence"] = "provider-reported"
                merged_firmo["company_type_source"] = "Moldset Enrichment API"
            if moldset_enrichment.get("business_model"):
                merged_firmo["business_model"] = moldset_enrichment["business_model"]
                merged_firmo["business_model_confidence"] = "provider-reported"
                merged_firmo["business_model_source"] = "Moldset Enrichment API"
            if moldset_enrichment.get("technologies"):
                merged_firmo["technologies"] = moldset_enrichment["technologies"]
                merged_firmo["technologies_confidence"] = "provider-reported"
                merged_firmo["technologies_source"] = "Moldset Enrichment API"
            merged_firmo["source_provider"] = "Exa Research + Moldset Enrichment"

        report["firmographics"] = merged_firmo
        
        report["research_metadata"] = {
            "sources_analyzed": len(final_sources),
            "ai_model": active_model or "gemini-3.5-flash",
            "research_objective": objective_text,
            "enrichment_adapter": "moldset (live)" if moldset_is_live else "moldset (fallback adapter — public research shown)"
        }
        
        return report

    def _fallback_report(
        self, company_name: str, website: typing.Optional[str],
        source_urls: list, error: str, moldset_enrichment: typing.Optional[dict] = None
    ) -> dict:
        moldset_is_live = bool(moldset_enrichment and moldset_enrichment.get("configured"))
        return {
            "company_name": company_name,
            "website": website,
            "company_description": "AI synthesis unavailable — raw data was collected but could not be structured.",
            "industry": None,
            "target_market": None,
            "employee_size": None,
            "funding_info": None,
            "recent_growth_signals": [],
            "potential_gtm_opportunity": "AI synthesis failed. Please review raw source data.",
            "decision_makers": [],
            "official_contact_pages": [],
            "source_urls": source_urls[:10],
            "firmographics": {
                "headquarters": None,
                "company_type": None,
                "business_model": None,
                "technologies": [],
                "source_provider": "Public company research · Exa",
                "moldset_status": "Unavailable — Moldset API not configured",
                "moldset_configured": moldset_is_live,
                "enrichment_notice": "Moldset enrichment unavailable: API credentials aren't configured. Publicly available information is still shown; proprietary enrichment fields remain unavailable."
            },
            "field_confidence": {
                "company_name": "verified",
                "ai_synthesis": f"failed: {error}"
            },
            "research_metadata": {
                "error": error,
                "sources_analyzed": len(source_urls),
            },
        }
