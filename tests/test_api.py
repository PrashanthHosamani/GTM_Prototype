import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas.company import ResearchInput, CompanyIntelligence, SourceEvidence

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

