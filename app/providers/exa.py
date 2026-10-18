import os 
import httpx
import asyncio
import typing
import re
from urllib.parse import urlparse
from dotenv import load_dotenv

load_dotenv()

class ExaProvider:
    def __init__(self, api_key: typing.Optional[str] = None):
        self.api_key = api_key or os.getenv("EXA_API_KEY")
        if not self.api_key:
            raise ValueError("EXA_API_KEY not configured in environment")
        self.base_url = "https://api.exa.ai/search"

    async def search(self, query: str, numResults: int = 10):
        headers = {
            "x-api-key": self.api_key,
            "Content-Type": "application/json"
        }

        payload = {
            "query": query,
            "numResults": numResults,
            "type": "neural",
            "contents": {
                "text": {"maxCharacters": 10000},
                "highlights": {
                    "numSentences": 5,
                    "highlightsPerUrl": 5
                }
            },
            "useAutoprompt": True
        }

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(self.base_url, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
            results = data.get("results", [])
            return self._filter_results(results)

    def _filter_results(
        self, results: list, company_name: typing.Optional[str] = None, domain: typing.Optional[str] = None
    ) -> list:
        clean_results = []
        seen_urls = set()

        lang_pattern = re.compile(r'/(zh|zh-hans|zh-hant|zh-cn|it|fr|es|de|ja|ko|ru|pt|nl|pl|ar)/', re.IGNORECASE)

        comp_clean = re.sub(r'[^a-zA-Z0-9]', '', company_name).lower() if company_name else ""
        dom_clean = domain.lower().replace("www.", "").split(".")[0] if domain else ""

        for r in results:
            url = r.get("url", "")
            if not url or url in seen_urls:
                continue

            parsed = urlparse(url)
            path = parsed.path.lower()

            if path.endswith(('.txt', '.xml', '.json', '.yaml', '.yml', '.csv', '.rss')):
                continue

            if lang_pattern.search(path):
                continue

            if company_name:
                title = r.get("title") or ""
                text = r.get("text") or ""
                highlights = " ".join(r.get("highlights") or [])
                blob = f"{url} {title} {text} {highlights}".lower()
                blob_clean = re.sub(r'[^a-zA-Z0-9]', '', blob)

                has_company = bool(re.search(r'\b' + re.escape(company_name.lower()) + r'\b', blob)) or (comp_clean and comp_clean in blob_clean)
                has_domain = bool(dom_clean and len(dom_clean) >= 3 and dom_clean in blob)

                if not (has_company or has_domain):
                    continue

            seen_urls.add(url)
            clean_results.append(r)

        return clean_results

    async def research_company(self, company_name: str, website: typing.Optional[str] = None):
        domain = website.replace("http://", "").replace("https://", "").split("/")[0].lower() if website else ""
        
        query_overview = f'"{company_name}" ({domain}) official company overview newsroom products services'
        query_growth = f'"{company_name}" ({domain}) announcements acquisitions newsroom valuation funding expansion 2025 2026'
        query_leadership_exec = f'"{company_name}" ({domain}) ("Co-Founder" OR "Founder" OR "CEO" OR "CMO" OR "Chief Executive")'
        query_leadership_tech = f'"{company_name}" CTO OR "Chief Technology Officer" OR "Co-Founder" ({domain})'
        query_tech = f'"{company_name}" ({domain}) engineering blog tech stack architecture programming languages'
        query_market = f'"{company_name}" ({domain}) customers target market enterprise clients ICP'

        overview_res, growth_res, lead_exec_res, lead_tech_res, tech_res, market_res = await asyncio.gather(
            self.search(query_overview, numResults=6),
            self.search(query_growth, numResults=6),
            self.search(query_leadership_exec, numResults=5),
            self.search(query_leadership_tech, numResults=5),
            self.search(query_tech, numResults=5),
            self.search(query_market, numResults=4),
        )

        combined_leadership = []
        seen_lead = set()
        for r in (lead_exec_res + lead_tech_res):
            u = r.get("url")
            if u and u not in seen_lead:
                seen_lead.add(u)
                combined_leadership.append(r)

        return {
            "overview": self._filter_results(overview_res, company_name, domain),
            "growth": self._filter_results(growth_res, company_name, domain),
            "leadership": self._filter_results(combined_leadership, company_name, domain),
            "tech": self._filter_results(tech_res, company_name, domain),
            "market": self._filter_results(market_res, company_name, domain),
        }
