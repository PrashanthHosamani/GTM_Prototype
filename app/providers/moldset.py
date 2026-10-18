import os
import typing
import httpx
from dotenv import load_dotenv

load_dotenv()


class MoldsetProvider:
    def __init__(self, api_key: typing.Optional[str] = None):
        self.api_key: typing.Optional[str] = api_key or os.getenv("MOLDSET_API_KEY")
        self.base_url: str = os.getenv("MOLDSET_BASE_URL", "https://api.moldset.com/v1")
        self.is_configured: bool = bool(self.api_key)

    async def enrich_company(self, company_name: str, website: typing.Optional[str] = None) -> dict:
        if not self.is_configured:
            return {
                "configured": False,
                "is_fallback": True,
                "provider": "moldset_fallback",
                "message": (
                    "Moldset API credentials not configured. "
                    "Public company research is displayed from Exa; proprietary enrichment fields remain unavailable."
                ),
                "enrichment": {
                    "enrichment_status": "Unavailable — Moldset API not configured",
                    "provenance": "unavailable",
                    "configured": False
                }
            }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                res = await client.post(
                    f"{self.base_url}/enrich/company",
                    headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                    json={"name": company_name, "domain": website}
                )
                if res.status_code == 200:
                    data = res.json()
                    return {
                        "configured": True,
                        "is_fallback": False,
                        "provider": "moldset",
                        "enrichment": {
                            **data.get("enrichment", data),
                            "enrichment_status": "Live Enrichment",
                            "provenance": "provider-reported"
                        }
                    }
                else:
                    return {
                        "configured": True,
                        "is_fallback": True,
                        "provider": "moldset_fallback",
                        "message": f"Moldset API returned status {res.status_code}.",
                        "enrichment": {
                            "headquarters": None,
                            "company_type": None,
                            "technologies": [],
                            "business_model": None,
                            "enrichment_status": f"Unavailable — API error {res.status_code}",
                            "provenance": "unavailable"
                        }
                    }
        except Exception as e:
            return {
                "configured": True,
                "is_fallback": True,
                "provider": "moldset_fallback",
                "message": f"Moldset API connection failed: {str(e)}.",
                "enrichment": {
                    "headquarters": None,
                    "company_type": None,
                    "technologies": [],
                    "business_model": None,
                    "enrichment_status": "Unavailable — Connection failed",
                    "provenance": "unavailable"
                }
            }
