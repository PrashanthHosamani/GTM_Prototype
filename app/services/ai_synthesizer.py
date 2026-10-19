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
            "gemini-3.8-flash",
            "gemini-flash-latest",
            "gemini-flash-lite-latest",
            "gemini-3.5-flash-lite"
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

        prompt = f"""You are a senior GTM intelligence analyst at a B2B research firm. Your job is to produce a rigorous, evidence-based company intelligence report purely from the web research data provided below. Accuracy, source fidelity, and strict provenance are paramount.

COMPANY TO RESEARCH: {company_name}
WEBSITE: {website or 'Not provided'}
RESEARCH OBJECTIVE: {objective_text}
{firmographic_context}

RAW RESEARCH DATA (Collected live from web search):
{raw_context}

STRICT EVIDENCE & EXTRACTION RULES:
1. PURE SOURCE FIDELITY: Extract facts ONLY from the raw research data provided above. Never invent, extrapolate, or hallucinate facts, dates, headcounts, or links. If a data point is not substantiated in the research data, set it to null or specify that it is unverified.
2. CURRENT LEADERSHIP: Extract ONLY current, active leadership (Founders, Co-Founders, CEO, CTO, CMO, C-suite executives). Strictly EXCLUDE any past/former employees, ex-employees, or past interns. Each decision maker must link to the specific source URL where their role is documented.
3. VERIFIABLE FIRMOGRAPHICS:
   - headquarters: Primary location or dual headquarters substantiated by newsroom, about page, or press. Include source URL and set confidence to 'verified' or 'inferred'.
   - company_type: 'Privately held' or 'Publicly traded' if confirmed by authoritative sources, else null.
   - business_model: Concise business model derived from official disclosures.
   - technologies: Array of publicly documented technologies supported by engineering blogs, job postings, or docs in the research data. ONLY include technologies with concrete source evidence.
4. GROWTH SIGNALS & EXACT DATES: Extract notable corporate milestones (funding rounds, acquisitions, partnerships, product launches) with exact dates (YYYY-MM-DD) and primary source URLs from the research data.
5. GROUNDED GTM ANALYSIS: Formulate a disciplined, research-based hypothesis explaining whether this company could be a fit for B2B GTM services based on its business model and growth trajectory, explicitly noting that further validation is required.
6. SOURCE TRACEABILITY: Every verified field and signal must cite the exact URL from the research data that substantiates it.

Return ONLY valid JSON in this exact structure (no markdown, no code fences):
{{
    "company_name": "{company_name}",
    "website": "canonical website URL or null",
    "company_description": "concise 2-3 sentence description based on source evidence",
    "industry": "Industry / Vertical or null",
    "target_market": "target customer segment or null",
    "employee_size": "Headcount estimate with reporting date or null",
    "employee_size_source": "Source URL or null",
    "funding_info": "Valuation or funding history summary with dates or null",
    "recent_growth_signals": [
        {{
            "signal": "Clear factual description of the growth signal",
            "signal_type": "funding | acquisition | partnership | product_launch | expansion",
            "date": "YYYY-MM-DD or null",
            "source_url": "Direct source URL from research data"
        }}
    ],
    "potential_gtm_opportunity": "Disciplined hypothesis based on business model and scale",
    "decision_makers": [
        {{
            "name": "Full Name",
            "role": "Exact Title from source",
            "source_url": "URL where this person's role appears"
        }}
    ],
    "official_contact_pages": ["List of official contact or newsroom URLs found in data"],
    "firmographics": {{
        "headquarters": "Location or null",
        "headquarters_source": "Source URL or null",
        "headquarters_confidence": "verified | inferred | unavailable",
        "company_type": "Privately held | Publicly traded | null",
        "company_type_source": "Source URL or null",
        "company_type_confidence": "verified | inferred | unavailable",
        "business_model": "Business model or null",
        "business_model_source": "Source URL or null",
        "business_model_confidence": "verified | inferred | unavailable",
        "technologies": ["Array of verified technologies"],
        "technologies_source": "Source URL or null",
        "technologies_confidence": "verified | inferred | unavailable"
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
