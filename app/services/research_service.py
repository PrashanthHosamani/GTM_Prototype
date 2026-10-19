import time
import typing
from datetime import datetime, timezone
from app.schemas.company import (
    ResearchInput, CompanyIntelligence, ResearchResponse,
    SourceEvidence, GrowthSignal, DecisionMaker
)
from app.providers.exa import ExaProvider
from app.providers.moldset import MoldsetProvider
from app.services.ai_synthesizer import AISynthesizer


class ResearchService:
    def __init__(
        self,
        exa_provider: typing.Optional[ExaProvider] = None,
        moldset_provider: typing.Optional[MoldsetProvider] = None,
        ai_synthesizer: typing.Optional[AISynthesizer] = None,
    ):
        self.exa = exa_provider or ExaProvider()
        self.moldset = moldset_provider or MoldsetProvider()
        try:
            self.ai = ai_synthesizer or AISynthesizer()
        except ValueError:
            self.ai = None

    async def execute_research(self, input_data: ResearchInput) -> ResearchResponse:
        start_time = time.time()
        name = input_data.name.strip()
        website = input_data.website.strip() if input_data.website else None
        objective = input_data.reasearch_objective

        warnings = []
        errors = []
        providers_used = []

        try:
            exa_data = await self.exa.research_company(name, website)
            providers_used.append("exa")
        except Exception as e:
            return ResearchResponse(
                success=False,
                data=None,
                errors=[f"Exa research failed: {str(e)}"],
                warnings=[],
                research_duration_seconds=round(time.time() - start_time, 2),
                providers_used=["exa"],
                timestamp=datetime.now(timezone.utc)
            )

        moldset_status = await self.moldset.enrich_company(name, website)
        moldset_enrichment = moldset_status.get("enrichment", {})
        moldset_is_fallback = moldset_status.get("is_fallback", True)
        moldset_message = moldset_status.get("message", "")
        if moldset_is_fallback:
            providers_used.append("moldset (fallback adapter)")
            if moldset_message:
                warnings.append(f"Moldset: {moldset_message}")
        else:
            providers_used.append("moldset")

        if self.ai:
            try:
                report_data = await self.ai.synthesize_report(
                    company_name=name,
                    website=website,
                    research_objective=objective,
                    raw_exa_data=exa_data,
                    moldset_enrichment=moldset_enrichment,
                )
                providers_used.append("gemini-ai")
            except Exception as e:
                warnings.append(f"AI synthesis error: {str(e)}")
                report_data = self._basic_extraction(name, website, exa_data)
        else:
            warnings.append("AI synthesizer not configured (GEMINI_API_KEY missing)")
            report_data = self._basic_extraction(name, website, exa_data)

        intelligence = self._build_intelligence(report_data, name, website)

        return ResearchResponse(
            success=True,
            data=intelligence,
            warnings=warnings,
            errors=errors,
            research_duration_seconds=round(time.time() - start_time, 2),
            providers_used=providers_used,
            timestamp=datetime.now(timezone.utc)
        )

    def _build_intelligence(self, report: dict, name: str, website: typing.Optional[str]) -> CompanyIntelligence:
        signals = []
        for s in report.get("recent_growth_signals", []):
            if isinstance(s, dict):
                signals.append(GrowthSignal(
                    signal=s.get("signal", ""),
                    signal_type=s.get("signal_type", "expansion"),
                    date=s.get("date"),
                    source_url=s.get("source_url"),
                ))

        leaders = []
        for dm in report.get("decision_makers", []):
            if isinstance(dm, dict) and dm.get("name"):
                name = dm["name"].strip()
                role = (dm.get("role") or "Executive").strip()
                source_url = dm.get("source_url")
                role_lower = role.lower()
                if any(x in role_lower for x in ["former", "past", "ex-", "intern", "previously"]):
                    continue
                leaders.append(DecisionMaker(
                    name=name,
                    role=role,
                    source_url=source_url,
                ))

        sources = []
        for src in report.get("source_urls", []):
            if isinstance(src, dict) and src.get("url"):
                sources.append(SourceEvidence(
                    url=src["url"],
                    title=src.get("title"),
                    snippet=src.get("snippet"),
                    published_date=src.get("published_date"),
                ))

        return CompanyIntelligence(
            company_name=report.get("company_name", name),
            website=report.get("website", website),
            official_contact_pages=report.get("official_contact_pages", []),
            company_description=report.get("company_description"),
            industry=report.get("industry"),
            target_market=report.get("target_market"),
            employee_size=report.get("employee_size"),
            employee_size_source=report.get("employee_size_source"),
            funding_info=report.get("funding_info"),
            recent_growth_signals=signals,
            potential_gtm_opportunity=report.get("potential_gtm_opportunity"),
            decision_makers=leaders,
            source_urls=sources,
            field_confidence=report.get("field_confidence", {}),
            firmographics=report.get("firmographics", {}),
            research_metadata=report.get("research_metadata", {}),
        )

    def _basic_extraction(self, name: str, website: typing.Optional[str], exa_data: dict) -> dict:
        overview_results = exa_data.get("overview", [])
        growth_results = exa_data.get("growth", [])
        leadership_results = exa_data.get("leadership", [])
        tech_results = exa_data.get("tech", [])

        top_snippet = None
        if overview_results and overview_results[0].get("highlights"):
            top_snippet = overview_results[0]["highlights"][0]

        signals = []
        for item in growth_results:
            if item.get("highlights"):
                signals.append({
                    "signal": item["highlights"][0][:250],
                    "signal_type": "funding" if "fund" in item["highlights"][0].lower() else "expansion",
                    "date": item.get("publishedDate"),
                    "source_url": item.get("url"),
                })

        leaders = []
        for item in leadership_results:
            if item.get("title"):
                leaders.append({
                    "name": item["title"].split("–")[0].split("-")[0].strip()[:60],
                    "role": "Executive",
                    "source_url": item.get("url"),
                })

        source_urls = []
        for group in [overview_results, growth_results, leadership_results, tech_results]:
            for item in group:
                if item.get("url"):
                    source_urls.append({
                        "url": item["url"],
                        "title": item.get("title"),
                        "snippet": item.get("highlights", [None])[0][:200] if item.get("highlights") else None,
                        "published_date": item.get("publishedDate"),
                    })

        return {
            "company_name": name,
            "website": website,
            "company_description": top_snippet[:400] if top_snippet else None,
            "industry": None,
            "target_market": None,
            "employee_size": None,
            "funding_info": None,
            "recent_growth_signals": signals[:5],
            "potential_gtm_opportunity": f"Evaluate {name} as a potential prospect based on analyzed public market signals.",
            "decision_makers": leaders[:5],
            "official_contact_pages": [],
            "source_urls": source_urls[:10],
            "firmographics": {
                "headquarters": None,
                "company_type": None,
                "business_model": None,
                "technologies": [],
                "source_provider": "Public company research · Exa",
                "moldset_status": "Unavailable — Moldset API not configured",
                "moldset_configured": False,
                "enrichment_notice": "Moldset enrichment unavailable: API credentials aren't configured. Publicly available information is still shown; proprietary enrichment fields remain unavailable."
            },
            "field_confidence": {"company_name": "verified", "note": "AI synthesis unavailable — basic extraction only"},
            "research_metadata": {"mode": "basic_extraction"},
        }
