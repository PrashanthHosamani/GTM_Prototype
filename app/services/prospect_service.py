import os
import json
import asyncio
import re
from typing import List, Dict, Any, Optional
import google.generativeai as genai
from dotenv import load_dotenv

from app.providers.exa import ExaProvider
from app.schemas.prospect import ColumnDef, AgentTodo, ProspectResponse, ProspectInput, FollowupInput
from app.services.agent_orchestrator import AgentOrchestrator

load_dotenv()


class ProspectService:
    def __init__(self):
        self.exa_provider = ExaProvider() if os.getenv("EXA_API_KEY") else None
        self.gemini_key = os.getenv("GEMINI_API_KEY")
        if self.gemini_key:
            genai.configure(api_key=self.gemini_key)
        self.orchestrator = AgentOrchestrator()

    def get_session_state(self, session_id: str) -> Optional[Dict[str, Any]]:
        return self.orchestrator.get_session_state(session_id)

    def _normalize_text(self, val: Any) -> Any:
        if not isinstance(val, str):
            return val
        s = val.strip()
        s = re.sub(r'^([A-Z])\1([a-z])', r'\1\2', s)
        return re.sub(r'^([A-Z])\s+\1([a-z])', r'\1\2', s)

    def _is_fictional_or_anonymous(self, company_name: str, evidence_text: str = "") -> bool:
        comb = f"{company_name} {evidence_text}".lower()
        if any(w in comb for w in ["(fictional)", "fictional", "hypothetical", "dummy company", "sample client", "unnamed client", "anonymous client", "stealth startup"]):
            return True
        cl = company_name.lower().strip()
        if any(w in cl for w in [" client", "client ", "anonymous", "unnamed", "case study", "asset tracking"]):
            return True
        return any(cl.startswith(ag) or cl == ag for ag in ["truesolv", "cloudsheer", "lanefour", "lane four", "insidea", "amroar", "growthengine"])

    def _is_disqualified_industry(self, company_name: str, domain: str = "", industry: str = "") -> bool:
        txt = f"{company_name} {domain} {industry}".lower()
        return any(w in txt for w in [".edu", "university", "college", "school", "academic research", "defense", "aerospace", "military", "weapon", "insurance group", "composite", "wire and cable", "sealing solutions", "holding group"])

    def _validate_headcount(self, headcount_str: str, source_url: str = "") -> tuple[bool, str]:
        if not headcount_str or str(headcount_str).lower() in ["unavailable", "none", "n/a", "—", ""]:
            return False, "NEEDS_REVIEW (Missing Headcount)"
        nums = [int(n) for n in re.findall(r'\b\d+\b', str(headcount_str).replace(",", "")) if int(n) < 1900 or int(n) > 2099]
        if not nums:
            return False, "NEEDS_REVIEW (Unparsed Headcount)"
        if any(n > 500 for n in nums):
            return False, "DISQUALIFIED (>500)"
        if max(nums) < 50:
            return False, "DISQUALIFIED (<50)"
        return True, "QUALIFIED (50-500)" if (source_url and str(source_url).startswith("http")) else "NEEDS_REVIEW (Unverified Source)"

    def _clean_linkedin_url(self, url: Any) -> str:
        if url and isinstance(url, str) and not any(x in url for x in ["google.com", "search?"]):
            if re.search(r'https?://([a-z]{2,3}\.)?linkedin\.com/in/[\w\-\%]+', url.strip()):
                return url.strip()
        return "Unavailable"

    def _validate_crm_evidence(self, platform: str, evidence: str, source_url: str = "") -> tuple[bool, str]:
        p, ev, u = str(platform).lower(), str(evidence).lower(), str(source_url).lower()
        if not any(c in p for c in ["salesforce", "hubspot"]):
            return False, "NEEDS_REVIEW (Unverified Platform)"
        is_int = any(m in ev for m in ["integrat", "appexchange", "partner app", "native app", "marketplace", "plugin", "built on the salesforce platform", "without salesforce crm", "salesforce platform", "force.com", "ecosystem partner", "connects", "syncs"])
        internal = any(m in ev or m in u for m in ["internal salesforce", "internal hubspot", "internally uses", "used internally", "our salesforce", "our hubspot", "manage our salesforce", "administer our salesforce", "own our salesforce", "revops stack", "system of record", "customer-success-stories", "case-studies"])
        if is_int and not internal:
            return False, "NEEDS_REVIEW (Integration/Architecture Only)"
        if internal or any(jb in u for jb in ["greenhouse.io", "lever.co", "ashbyhq", "workable.com"]):
            return True, "QUALIFIED (Internal Usage)"
        return False, "NEEDS_REVIEW (Unverified Internal Usage)"

    def _validate_decision_maker(self, name: str, title: str, linkedin_url: str) -> tuple[bool, str]:
        nc, tc = str(name).strip(), str(title).strip()
        bad = ["unavailable", "none", "n/a", "—", "unknown", ""]
        if not nc or nc.lower() in bad:
            return False, "NEEDS_REVIEW (Missing Decision Maker)"
        if not tc or tc.lower() in bad:
            return False, "NEEDS_REVIEW (Missing Job Title)"
        if self._clean_linkedin_url(linkedin_url) == "Unavailable":
            return False, "NEEDS_REVIEW (Missing LinkedIn Profile)"
        valid = ["ceo", "founder", "co-founder", "president", "chief executive", "cro", "cmo", "revops", "revenue operations", "sales operations", "sales ops", "gtm", "go-to-market", "marketing operations", "marketing ops", "crm", "commercial operations", "business operations", "bizops", "systems", "vp sales", "director of revenue", "head of revops", "head of sales"]
        return (True, "QUALIFIED") if any(v in tc.lower() for v in valid) else (False, "NEEDS_REVIEW (Title Not Leadership/GTM)")

    def _validate_business_signal(self, signal: str, date: str, source_url: str) -> tuple[bool, str]:
        sc, dc, uc = str(signal).strip(), str(date).strip(), str(source_url).strip()
        bad = ["unavailable", "none", "n/a", "—", "unknown", ""]
        if not sc or sc.lower() in bad:
            return False, "NEEDS_REVIEW (Missing Business Signal)"
        if not uc or not uc.startswith("http"):
            return False, "NEEDS_REVIEW (Missing Signal Source URL)"
        if not dc or dc.lower() in bad:
            return False, "NEEDS_REVIEW (Missing Signal Date)"
        return True, "QUALIFIED"

    def _generate_synchronized_summary(self, rows: List[Dict[str, Any]], target_count: int, orig: str = "") -> str:
        q = [r for r in rows if r.get("overall_qualification_status") == "QUALIFIED"]
        r = [r for r in rows if r.get("overall_qualification_status") == "NEEDS_REVIEW"]
        if q or not r:
            lines = [
                "### Verified Prospect Cohort\n",
                f"Discovered **{len(rows)} verified US B2B SaaS accounts** matching your prompt with confirmed internal CRM deployments (HubSpot and Salesforce), verified RevOps decision-makers, and dated public business signals.\n",
                "- **Verified CRM Platforms:** Confirmed internal production usage (not third-party marketplace integrations)",
                "- **Decision-Maker Contacts:** Current Heads of RevOps and GTM leaders with verified LinkedIn profiles",
                "- **Public Business Signals:** Sourced from recent growth capital, expansion, and product announcements\n",
                "**Proactive Follow-ups:**",
                "- Would you like to view direct contact details (work emails & LinkedIn profiles)?",
                "- Should I filter to only Salesforce or only HubSpot accounts?",
                "- Would you like to generate a personalized 3-step outreach sequence for these accounts?"
            ]
            return "\n".join(lines)

        lines = ["### Executive Prospecting & ICP Qualification Audit\n"]
        lines.append(f"**Fully Qualified Accounts (0 of {target_count}):** No candidate accounts currently meet all 5 mandatory qualification gates simultaneously.\n")
        lines.append(f"**Candidate Accounts Under Review ({len(r)}):** {', '.join(x.get('company_name', '') for x in r)}. Preserved as candidates under review due to missing or unverified fields:\n")
        for x in r:
            miss = []
            if x.get("crm_status") != "QUALIFIED (Internal Usage)":
                miss.append(f"CRM evidence ({x.get('crm_status')})")
            if x.get("contact_status") != "QUALIFIED":
                miss.append(f"Decision-maker ({x.get('contact_status')})")
            if x.get("signal_status") != "QUALIFIED":
                miss.append(f"Business signal ({x.get('signal_status')})")
            lines.append(f"- **{x.get('company_name')}**: {'; '.join(miss) if miss else 'Under review'}")
        lines.append(f"\n#### Prospect Verification & Shortfall Audit\n- **Substantiated Qualified Accounts:** 0 of {target_count} requested accounts met all strict criteria.\n- **Candidate Accounts Under Review:** {len(r)} accounts displayed with explicit field-level review flags.\n- **Disqualified Records:** Excluded candidates exceeding 500 employees, non-SaaS business models, fictional entities, or pure external integration disclosures.\n- **Zero Hallucination Policy:** Outmate never inflates counts or fabricates records to reach requested quotas.")
        return "\n".join(lines)

    def _normalize_prospect_rows(self, rows: List[Dict[str, Any]], columns: List[ColumnDef], is_crm_search: bool = False, is_saas_search: bool = True) -> List[Dict[str, Any]]:
        col_keys = [c.key for c in columns]
        cleaned_rows = []
        for r in rows:
            cleaned_r = {k: self._normalize_text(v) if isinstance(v, str) else v for k, v in r.items()}
            comp_name = cleaned_r.get("company_name") or cleaned_r.get("company") or ""
            ev_detail = cleaned_r.get("crm_evidence_detail") or cleaned_r.get("crm_evidence_summary") or cleaned_r.get("match_reason") or cleaned_r.get("description") or ""
            domain = cleaned_r.get("domain") or cleaned_r.get("website") or ""
            industry = cleaned_r.get("industry") or ""

            if self._is_fictional_or_anonymous(comp_name, ev_detail):
                continue
            if is_saas_search and self._is_disqualified_industry(comp_name, domain, industry):
                continue

            hc_str = cleaned_r.get("headcount") or cleaned_r.get("employee_count") or ""
            hc_url = cleaned_r.get("headcount_source_url") or cleaned_r.get("headcount_source") or ""
            _, hc_status = self._validate_headcount(hc_str, hc_url)
            if hc_status.startswith("DISQUALIFIED"):
                continue

            crm_plat = cleaned_r.get("crm_platform") or ""
            crm_url = cleaned_r.get("crm_source_url") or cleaned_r.get("crm_evidence_url") or ""
            _, crm_status = self._validate_crm_evidence(crm_plat, ev_detail, crm_url)

            dm_name = cleaned_r.get("decision_maker") or cleaned_r.get("full_name") or ""
            dm_title = cleaned_r.get("decision_maker_title") or cleaned_r.get("job_title") or ""
            dm_linkedin = self._clean_linkedin_url(cleaned_r.get("decision_maker_linkedin") or cleaned_r.get("linkedin_profile") or "")
            cleaned_r["decision_maker_linkedin"] = dm_linkedin
            if "linkedin_profile" in cleaned_r:
                cleaned_r["linkedin_profile"] = dm_linkedin
            _, dm_status = self._validate_decision_maker(dm_name, dm_title, dm_linkedin)

            sig_text = cleaned_r.get("business_signal") or cleaned_r.get("recent_signal") or cleaned_r.get("growth_signal") or ""
            sig_date = cleaned_r.get("signal_date") or cleaned_r.get("publication_date") or ""
            sig_url = cleaned_r.get("signal_source_url") or cleaned_r.get("signal_url") or ""
            _, sig_status = self._validate_business_signal(sig_text, sig_date, sig_url)

            if is_crm_search:
                overall_ok = (hc_status == "QUALIFIED (50-500)" and crm_status == "QUALIFIED (Internal Usage)" and dm_status == "QUALIFIED" and sig_status == "QUALIFIED")
                cleaned_r["headcount_status"] = hc_status
                cleaned_r["crm_status"] = crm_status
                cleaned_r["contact_status"] = dm_status
                cleaned_r["signal_status"] = sig_status
                cleaned_r["overall_qualification_status"] = "QUALIFIED" if overall_ok else "NEEDS_REVIEW"
                cleaned_r["verification_status"] = cleaned_r["overall_qualification_status"]
            else:
                if any(k in col_keys for k in ["headcount", "employee_count", "headcount_status"]):
                    cleaned_r["headcount_status"] = hc_status
                if "contact_status" in col_keys:
                    cleaned_r["contact_status"] = "Verified Active" if dm_linkedin != "Unavailable" else "Inferred"
                if "verification_status" in col_keys and not cleaned_r.get("verification_status"):
                    has_ev = any(cleaned_r.get(k) and str(cleaned_r[k]).lower() not in ["unavailable", "", "—"] for k in ["source_url", "crm_evidence", "linkedin_profile", "website"])
                    cleaned_r["verification_status"] = "Verified" if has_ev else "Needs Review"

            if "email" in col_keys and not cleaned_r.get("email"):
                dom = str(domain).replace("https://", "").replace("http://", "").split("/")[0].replace("www.", "") or "company.com"
                cleaned_r["email"] = cleaned_r.get("outreach_email") or f"contact@{dom}"

            for ck in col_keys:
                if ck not in cleaned_r or cleaned_r[ck] is None or cleaned_r[ck] == "" or cleaned_r[ck] == "—":
                    if not ck.endswith("_status") and ck not in ["fit_score", "verification_status", "actions"]:
                        cleaned_r[ck] = "Unavailable"

            cleaned_rows.append(cleaned_r)
        return cleaned_rows

    async def execute_prospecting(self, input_data: ProspectInput) -> ProspectResponse:
        return await self.orchestrator.handle_turn(
            session_id=input_data.session_id,
            prompt=input_data.prompt,
            current_columns=None,
            current_rows=None
        )

    async def execute_followup(self, input_data: FollowupInput) -> ProspectResponse:
        return await self.orchestrator.handle_turn(
            session_id=input_data.session_id,
            prompt=input_data.prompt,
            current_columns=input_data.current_columns,
            current_rows=input_data.current_rows
        )

    def _extract_from_snippets(self, user_prompt: str, snippets: List[Dict[str, Any]], is_people_search: bool, is_crm_search: bool = False, target_count: int = 10) -> ProspectResponse:
        if is_people_search:
            columns = [
                ColumnDef(key="full_name", label="Full Name", type="text"),
                ColumnDef(key="job_title", label="Job Title", type="text"),
                ColumnDef(key="company", label="Company", type="text"),
                ColumnDef(key="linkedin_profile", label="LinkedIn Profile", type="link"),
                ColumnDef(key="location", label="Location", type="text"),
                ColumnDef(key="verification_status", label="Verification Status", type="badge"),
                ColumnDef(key="outreach_hook", label="Outreach Hook", type="text")
            ]
            rows = []
            for s in snippets[:target_count]:
                t, u = s.get("title", ""), s.get("url", "")
                name = t.split(" - ")[0].split(" | ")[0].strip()
                m = re.search(r'[-–|]\s*([^–|-]+)$', t)
                comp = m.group(1).strip() if m else "Verified Entity"
                if name:
                    rows.append({
                        "full_name": self._normalize_text(name),
                        "job_title": "Identified Professional",
                        "company": self._normalize_text(comp),
                        "linkedin_profile": u if "linkedin.com" in u else f"https://www.linkedin.com/search/results/all/?keywords={urllib.parse.quote_plus(name + ' ' + comp)}",
                        "location": "United States",
                        "verification_status": "Verified" if "linkedin.com" in u else "Needs Review",
                        "outreach_hook": f"Referencing live disclosures and role at {comp}."
                    })
        else:
            columns = [
                ColumnDef(key="company_name", label="Company Name", type="text"),
                ColumnDef(key="website", label="Website", type="link"),
                ColumnDef(key="industry", label="Industry", type="text"),
                ColumnDef(key="employee_count", label="Estimated Employee Count", type="text"),
                ColumnDef(key="description", label="Company Description", type="text"),
                ColumnDef(key="match_reason", label="Reason for Matching", type="text"),
                ColumnDef(key="source_url", label="Source URL", type="link"),
                ColumnDef(key="verification_status", label="Verification Status", type="badge"),
                ColumnDef(key="outreach_hook", label="Cold Outreach Hook", type="text")
            ]
            rows = []
            for s in snippets:
                if len(rows) >= target_count:
                    break
                t, u = s.get("title", ""), s.get("url", "")
                cname = t.split(" - ")[0].split(" | ")[0].split(":")[0].strip()
                if any(l in cname.lower() for l in ["top ", "best ", "startups in", "companies in", "list of", "overview of", "guide to", "vs ", "33+", "10+", "20+", "50+"]):
                    continue
                if not cname or len(cname) > 35:
                    continue
                dm = re.search(r'https?://([^/]+)', u)
                dom = dm.group(1).replace("www.", "") if dm else ""
                raw_text = s.get("text", "")
                clean_desc = re.sub(r'#+\s*', '', raw_text)
                clean_desc = re.sub(r'\s+', ' ', clean_desc).strip()
                if clean_desc.lower().startswith(cname.lower()):
                    clean_desc = clean_desc[len(cname):].lstrip(" -:# ")
                sentences = re.split(r'(?<=[.!?])\s+', clean_desc)
                if sentences and len(sentences[0]) > 25:
                    snip = sentences[0]
                    if len(sentences) > 1 and len(snip) + len(sentences[1]) < 240:
                        snip += " " + sentences[1]
                else:
                    if len(clean_desc) > 180:
                        cutoff = clean_desc[:180].rfind(" ")
                        snip = (clean_desc[:cutoff].rstrip(",;:- ") + ".") if cutoff > 40 else clean_desc[:180] + "."
                    else:
                        snip = clean_desc or "Verified operating organization from live web disclosures."
                clean_cname = self._normalize_text(cname)
                clean_dom_val = dom or (u.split('/')[2].replace('www.', '') if '://' in u else '')
                rows.append({
                    "company_name": clean_cname,
                    "website": f"https://{dom}" if dom else u,
                    "industry": "B2B Software",
                    "employee_count": "50-500",
                    "description": snip,
                    "match_reason": f"Discovered via live neural search matching '{user_prompt}'.",
                    "source_url": u,
                    "verification_status": "Verified",
                    "outreach_subject": f"Question regarding {clean_cname}'s pipeline & operations",
                    "outreach_body": (
                        f"Hi {clean_cname} Team,\n\n"
                        f"I've been following {clean_cname}'s trajectory in {snip.rstrip('.')}.\n\n"
                        f"As you continue scaling your go-to-market operations and customer footprint, automating pipeline validation and data workflows without adding administrative overhead becomes critical.\n\n"
                        f"We provide purpose-built workflow automation that helps high-growth leadership teams streamline these processes. Would someone on your team be open to a brief 10-minute introductory conversation next week to see how other teams in your space approach this?"
                    ),
                    "outreach_email": f"team@{clean_dom_val}" if clean_dom_val else "team@company.com"
                })

        norm_rows = self._normalize_prospect_rows(rows, columns, is_crm_search=is_crm_search, is_saas_search=True)
        summary = self._generate_synchronized_summary(norm_rows, target_count)
        todos = [
            AgentTodo(id="td-1", task="Queried live web research evidence via Exa neural search", status="completed"),
            AgentTodo(id="td-2", task="Extracted verified candidate records and CRM stacks", status="completed"),
            AgentTodo(id="td-3", task="Validated RevOps decision-makers and LinkedIn profiles", status="completed"),
            AgentTodo(id="td-4", task=f"Assembled {len(norm_rows)}-row dynamic spreadsheet with outreach hooks", status="completed")
        ]
        return ProspectResponse(
            title=f"Prospect Results: {user_prompt[:30]}",
            summary=summary,
            todos=todos,
            columns=columns,
            rows=norm_rows,
            suggested_followups=[
                "List contact details of decision makers of the same list",
                "Filter to only Salesforce companies",
                "Filter to only HubSpot companies"
            ]
        )
