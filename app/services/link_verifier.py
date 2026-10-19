import asyncio
import re
import urllib.parse
from typing import Tuple, Optional, List, Dict, Any
import httpx

from app.providers.exa import ExaProvider

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
}


async def check_url_live(url: str, person_name: str = "", company_name: str = "") -> bool:
    if not url or not url.startswith("http") or "linkedin.com/in/" not in url:
        return False
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
            resp = await client.get(url, headers=HEADERS)
            if resp.status_code == 200:
                text_low = resp.text.lower()
                p_parts = [p.lower() for p in person_name.split() if len(p) > 1]
                c_clean = company_name.lower().split()[0] if company_name else ""
                
                # Check if person name appears in the page content
                has_person = all(part in text_low for part in p_parts) if p_parts else True
                has_comp = (c_clean in text_low) if c_clean else True
                
                if has_person and (has_comp or len(p_parts) >= 2):
                    return True
    except Exception:
        pass
    return False


async def verify_person_linkedin(
    candidate_url: Optional[str],
    person_name: str,
    company_name: str,
    exa_provider: Optional[ExaProvider] = None
) -> Tuple[str, bool]:

    clean_p = person_name.strip() if person_name else ""
    clean_c = company_name.strip() if company_name else ""
    cand = str(candidate_url or "").strip()
    p_parts = [p.lower() for p in clean_p.split() if len(p) > 1]
    c_clean = clean_c.lower().split()[0] if clean_c else ""

    # 1. If candidate_url is an individual profile, check if it's already live & verified
    if cand and "linkedin.com/in/" in cand and "search" not in cand:
        is_good = await check_url_live(cand, clean_p, clean_c)
        if is_good:
            return cand, True

    # 2. If candidate link was not working or missing, search Exa for the actual indexed profile
    if exa_provider and clean_p and clean_p.lower() not in ["leadership executive", "executive", "unknown", "n/a", ""]:
        try:
            query = f'"{clean_p}" "{clean_c}" site:linkedin.com/in/'
            results = await exa_provider.search(query, numResults=4)
            for r in results:
                url = r.get("url", "")
                if "linkedin.com/in/" in url and "search" not in url:
                    title_low = r.get("title", "").lower()
                    text_low = (r.get("text", "") or "").lower()
                    
                    # Exact person matching in page title or text
                    has_person = all(part in title_low for part in p_parts) if p_parts else False
                    if not has_person and p_parts:
                        has_person = all(part in text_low for part in p_parts)
                    
                    # Company matching
                    has_comp = (c_clean in text_low) or (c_clean in title_low) if c_clean else True
                    
                    if has_person and has_comp:
                        m = re.search(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/in/[\w\-]+/?", url)
                        clean_url = m.group(0).rstrip("/") if m else url
                        return clean_url, True
        except Exception:
            pass

    # 3. Fallback to clean, functional LinkedIn search URL (never 404s)
    kw = f"{clean_p} {clean_c}".strip() if clean_p else clean_c
    search_url = f"https://www.linkedin.com/search/results/all/?keywords={urllib.parse.quote_plus(kw)}"
    return search_url, False


async def verify_company_linkedin(
    candidate_url: Optional[str],
    company_name: str,
    exa_provider: Optional[ExaProvider] = None
) -> Tuple[str, bool]:
    """Verifies if a company LinkedIn link is valid and matches the company."""
    clean_c = company_name.strip() if company_name else ""
    cand = str(candidate_url or "").strip()
    c_clean = clean_c.lower().split()[0] if clean_c else ""

    if cand and "linkedin.com/company/" in cand:
        try:
            async with httpx.AsyncClient(timeout=5.0, follow_redirects=True) as client:
                resp = await client.get(cand, headers=HEADERS)
                if resp.status_code == 200:
                    return cand, True
        except Exception:
            pass

    if exa_provider and clean_c:
        try:
            query = f'"{clean_c}" site:linkedin.com/company/'
            results = await exa_provider.search(query, numResults=3)
            for r in results:
                url = r.get("url", "")
                if "linkedin.com/company/" in url:
                    t_low = (r.get("title", "") + " " + r.get("text", "")).lower()
                    if c_clean in t_low:
                        m = re.search(r"https?://(?:[a-z]{2,3}\.)?linkedin\.com/company/[\w\-]+/?", url)
                        clean_url = m.group(0).rstrip("/") if m else url
                        return clean_url, True
        except Exception:
            pass

    return f"https://www.linkedin.com/search/results/all/?keywords={urllib.parse.quote_plus(clean_c)}", False


async def batch_verify_prospect_links(
    rows: List[Dict[str, Any]],
    exa_provider: Optional[ExaProvider] = None
) -> List[Dict[str, Any]]:
    """Concurrently verifies and corrects all LinkedIn profile links across prospect rows."""
    if not rows:
        return rows

    async def _verify_single_row(r: Dict[str, Any]) -> Dict[str, Any]:
        row_copy = dict(r)
        comp = row_copy.get("company_name") or row_copy.get("company") or ""
        
        target_keys = ["decision_maker_linkedin", "founder_linkedin", "linkedin_url", "linkedin_profile"]
        person_name = (
            row_copy.get("decision_maker") or 
            row_copy.get("founder_name") or 
            row_copy.get("full_name") or 
            row_copy.get("name") or ""
        )
        
        for k in target_keys:
            if k in row_copy and row_copy[k]:
                cand_url = str(row_copy[k])
                verified_url, is_ok = await verify_person_linkedin(
                    cand_url, person_name, comp, exa_provider
                )
                row_copy[k] = verified_url
                if is_ok:
                    if "contact_status" in row_copy:
                        row_copy["contact_status"] = "QUALIFIED"
                    if "verification_status" in row_copy and row_copy["verification_status"] == "Needs Review":
                        row_copy["verification_status"] = "Verified"
                else:
                    if "contact_status" in row_copy and not row_copy.get("contact_status"):
                        row_copy["contact_status"] = "Needs Review"
        return row_copy

    tasks = [_verify_single_row(r) for r in rows]
    return await asyncio.gather(*tasks)
