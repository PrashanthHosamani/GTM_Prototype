import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.company import ResearchInput, CompanyIntelligence, SourceEvidence
from app.schemas.prospect import ColumnDef, ProspectResponse, ProspectInput

client = TestClient(app)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "exa_configured" in data
    assert "version" in data


def test_schema_validation():
    evidence = SourceEvidence(
        url = "https://example.com",
        title = "Example Co",
        snippet = "Leading B2B platform"
    )
    assert evidence.url == "https://example.com"

    company = CompanyIntelligence(
        company_name = "Test Corp",
        website = "https://test.com",
        source_urls = [evidence],
        firmographics = {
            "headquarters": "San Francisco, CA",
            "technologies": ["Ruby", "Go"],
            "source_provider": "Public company research · Exa"
        }
    )
    assert company.company_name == "Test Corp"
    assert len(company.source_urls) == 1
    assert company.firmographics["headquarters"] == "San Francisco, CA"
    assert "Ruby" in company.firmographics["technologies"]


def test_moldset_fallback_decoupling():
    from app.providers.moldset import MoldsetProvider
    import asyncio

    provider = MoldsetProvider()
    res = asyncio.run(provider.enrich_company("Stripe", "https://stripe.com"))
    assert res["configured"] is False
    assert res["is_fallback"] is True
    assert "enrichment_status" in res["enrichment"]
    assert "Unavailable" in res["enrichment"]["enrichment_status"]


def test_prospect_schema():
    col = ColumnDef(key="crm_platform", label="CRM Platform", type="badge")
    assert col.key == "crm_platform"
    assert col.type == "badge"

    resp = ProspectResponse(
        title="Test Sheet",
        summary="Test Summary",
        todos=[],
        columns=[col],
        rows=[{"crm_platform": "HubSpot", "company_name": "Acme"}],
        suggested_followups=["Filter Acme"]
    )
    assert resp.title == "Test Sheet"
    assert len(resp.rows) == 1


def test_data_quality_normalization():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    assert service._normalize_text("MMadison Peet") == "Madison Peet"
    assert service._normalize_text("AAxonius Federal Systems") == "Axonius Federal Systems"
    assert service._normalize_text("SSiteimprove") == "Siteimprove"
    assert service._normalize_text("Aaron") == "Aaron"
    assert service._normalize_text("LLC") == "LLC"
    assert service._normalize_text("M Madison Peet") == "Madison Peet"

    cols = [
        ColumnDef(key="company_name", label="Company Name", type="text"),
        ColumnDef(key="website", label="Website", type="link"),
        ColumnDef(key="verification_status", label="Verification Status", type="badge"),
        ColumnDef(key="industry", label="Industry", type="text")
    ]
    raw_rows = [
        {"company_name": "AAxonius", "website": "https://axonius.com", "industry": ""},
        {"company_name": "Siteimprove", "website": "", "verification_status": "Needs Review"}
    ]
    cleaned = service._normalize_prospect_rows(raw_rows, cols)
    assert cleaned[0]["company_name"] == "Axonius"
    assert cleaned[0]["verification_status"] == "Verified"
    assert cleaned[0]["industry"] == "Unavailable"
    assert cleaned[1]["verification_status"] == "Needs Review"
    assert cleaned[1]["website"] == "Unavailable"


def test_intent_routing_company_vs_people():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    company_prompt = "Find 10 B2B SaaS companies in the United States with 50-500 employees"
    dummy_snippets = [{"title": "Check - Payroll SaaS", "url": "https://checkhq.com", "text": "Payroll infrastructure"}]
    comp_res = service._extract_from_snippets(company_prompt, dummy_snippets, is_people_search=False)
    col_keys = [c.key for c in comp_res.columns]
    assert "company_name" in col_keys
    assert "full_name" not in col_keys
    assert len(comp_res.rows) == 1
    assert comp_res.rows[0]["company_name"] == "Check"

    people_prompt = "Find the people working in spoke design labs"
    people_snippets = [{"title": "Zach Jordan - Founder - Spoke Design", "url": "https://linkedin.com/in/zach", "text": "Design leader"}]
    people_res = service._extract_from_snippets(people_prompt, people_snippets, is_people_search=True)
    people_keys = [c.key for c in people_res.columns]
    assert "full_name" in people_keys
    assert len(people_res.rows) == 1
    assert people_res.rows[0]["full_name"] == "Zach Jordan"


def test_fictional_and_anonymous_rejection():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    assert service._is_fictional_or_anonymous("Velosian (Fictional)", "CRM case study") is True
    assert service._is_fictional_or_anonymous("Cloudsheer SaaS Client", "Migration study") is True
    assert service._is_fictional_or_anonymous("INSIDEA Asset Tracking", "Agency client") is True
    assert service._is_fictional_or_anonymous("TrueSolv Analytics", "Case study client") is True
    assert service._is_fictional_or_anonymous("Lane Four Mining Tech", "Agency client study") is True
    assert service._is_fictional_or_anonymous("ArmorCode", "Security software company") is False
    assert service._is_fictional_or_anonymous("Cobalt", "Pentest management platform") is False


def test_headcount_qualification_bounds():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    valid, status = service._validate_headcount("602 employees")
    assert valid is False
    assert status == "DISQUALIFIED (>500)"

    valid, status = service._validate_headcount("6,088 (NH)")
    assert valid is False
    assert status == "DISQUALIFIED (>500)"

    valid, status = service._validate_headcount("11,400+")
    assert valid is False
    assert status == "DISQUALIFIED (>500)"

    valid, status = service._validate_headcount("25 employees")
    assert valid is False
    assert status == "DISQUALIFIED (<50)"

    valid, status = service._validate_headcount("140-180 FTEs")
    assert valid is True
    assert status == "NEEDS_REVIEW (Unverified Source)"

    valid, status = service._validate_headcount("221 employees", "https://www.linkedin.com/company/example")
    assert valid is True
    assert status == "QUALIFIED (50-500)"


def test_disqualified_industries():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    assert service._is_disqualified_industry("Washington University in St. Louis", "wustl.edu", "Higher Education") is True
    assert service._is_disqualified_industry("BAE Systems Electronic Systems", "baesystems.com", "Defense, Aerospace") is True
    assert service._is_disqualified_industry("Albany International Corp.", "albint.com", "Advanced Composites") is True
    assert service._is_disqualified_industry("ArmorCode", "armorcode.com", "B2B SaaS") is False
    assert service._is_disqualified_industry("Findigs", "findigs.com", "Property Management SaaS") is False


def test_linkedin_url_sanitization():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    assert service._clean_linkedin_url("https://www.google.com/search?q=Sarah+RevOps") == "Unavailable"
    assert service._clean_linkedin_url("https://www.google.com/search?q=Director+Sales+TextUs") == "Unavailable"
    assert service._clean_linkedin_url("https://www.linkedin.com/in/sarah-revops") == "https://www.linkedin.com/in/sarah-revops"
    assert service._clean_linkedin_url("") == "Unavailable"
    assert service._clean_linkedin_url(None) == "Unavailable"


def test_crm_evidence_explicit_mention():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    valid, status = service._validate_crm_evidence("Salesforce", "Active Greenhouse listing administering our Salesforce instance", "https://job-boards.greenhouse.io/company/jobs/123")
    assert valid is True
    assert status == "QUALIFIED (Internal Usage)"

    valid, status = service._validate_crm_evidence("Salesforce", "Managing general GTM pipeline workflows")
    assert valid is False
    assert status == "NEEDS_REVIEW (Unverified Internal Usage)"


def test_crm_integrations_alone_do_not_qualify():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    valid, status = service._validate_crm_evidence("Salesforce / HubSpot", "Integrates deeply with Gmail, Salesforce, and HubSpot for sales automation.")
    assert valid is False
    assert status == "NEEDS_REVIEW (Integration/Architecture Only)"

    valid, status = service._validate_crm_evidence("Salesforce", "Rootstock ERP is built on the Salesforce platform, but can be used without Salesforce CRM.")
    assert valid is False
    assert status == "NEEDS_REVIEW (Integration/Architecture Only)"

    valid, status = service._validate_crm_evidence("HubSpot", "Our native HubSpot app connects marketing leads to customer portals.")
    assert valid is False
    assert status == "NEEDS_REVIEW (Integration/Architecture Only)"


def test_missing_decision_maker_prevents_qualification():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    valid, status = service._validate_decision_maker("Unavailable", "Revenue Operations Manager", "Unavailable")
    assert valid is False
    assert status == "NEEDS_REVIEW (Missing Decision Maker)"

    valid, status = service._validate_decision_maker("John Doe", "Revenue Operations Manager", "Unavailable")
    assert valid is False
    assert status == "NEEDS_REVIEW (Missing LinkedIn Profile)"

    valid, status = service._validate_decision_maker("John Doe", "VP Revenue Operations", "https://www.linkedin.com/in/johndoe-revops")
    assert valid is True
    assert status == "QUALIFIED"


def test_missing_growth_signal_prevents_qualification():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    valid, status = service._validate_business_signal("Expanded team by 20% YoY", "Unavailable", "Unavailable")
    assert valid is False
    assert status == "NEEDS_REVIEW (Missing Signal Source URL)"

    valid, status = service._validate_business_signal("Expanded team by 20% YoY", "2025-06-01", "https://linkedin.com/company/example")
    assert valid is True
    assert status == "QUALIFIED"


def test_synchronized_summary_and_audit_counts():
    from app.services.prospect_service import ProspectService
    service = ProspectService()

    rows = [
        {
            "company_name": "Mixmax",
            "overall_qualification_status": "NEEDS_REVIEW",
            "crm_status": "NEEDS_REVIEW (Integration/Architecture Only)",
            "contact_status": "NEEDS_REVIEW (Missing Decision Maker)",
            "signal_status": "NEEDS_REVIEW (Missing Signal Source/Date)"
        },
        {
            "company_name": "Rootstock Software",
            "overall_qualification_status": "NEEDS_REVIEW",
            "crm_status": "NEEDS_REVIEW (Integration/Architecture Only)",
            "contact_status": "NEEDS_REVIEW (Missing Decision Maker)",
            "signal_status": "NEEDS_REVIEW (Missing Business Signal)"
        }
    ]

    summary = service._generate_synchronized_summary(rows, 10)
    assert "Fully Qualified Accounts (0 of 10)" in summary
    assert "Candidate Accounts Under Review (2)" in summary
    assert "Mixmax" in summary
    assert "Rootstock Software" in summary
    assert "Substantiated Qualified Accounts:** 0 of 10" in summary
    assert "Candidate Accounts Under Review:** 2" in summary


def test_new_search_vs_followup_intent_disambiguation():
    import re

    def check_intent(prompt: str) -> bool:
        p_lower = prompt.lower()
        is_new = bool(re.search(r'^(?:find|discover|search|identify|give me|top|\d+)\b', p_lower))
        has_same = any(w in p_lower for w in [
            "same list", "these companies", "this list", "of the same", "of those", "same company",
            "same companies", "previous list", "above list", "from the list"
        ])
        return has_same or (not is_new and any(w in p_lower for w in [
            "contact details", "their emails", "their phone", "their linkedin",
            "who are their", "filter by", "sort by", "add column"
        ]))

    initial_prompt = "Find 10 B2B SaaS companies in the United States with 50-500 employees that currently use HubSpot or Salesforce. For each company, provide its name, website, employee count, CRM platform with supporting evidence..."
    assert check_intent(initial_prompt) is False

    followup_prompt = "ok list out the contact details of the same list of companies"
    assert check_intent(followup_prompt) is True

    direct_followup = "contact details of decision makers"
    assert check_intent(direct_followup) is True

    new_discovery = "10 B2B SaaS (50-500 emp) using HubSpot / Salesforce"
    assert check_intent(new_discovery) is False




