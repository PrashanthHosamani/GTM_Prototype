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
