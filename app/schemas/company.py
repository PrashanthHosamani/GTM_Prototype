from pydantic import BaseModel, Field 
from typing import List
from datetime import datetime


class ResearchInput(BaseModel):
    name : str = Field(..., description = "Name of the company to research")
    website : str | None = Field(None, description = "Website")
    reasearch_objective : str | None = Field(None, description = "What do you want to learn about the company?")


class SourceEvidence(BaseModel):
    url : str = Field(..., description = "Source URL")
    title : str | None = Field(None, description = "Page or article title")
    snippet : str | None = Field(None, description = "Extracted supporting snippet or quote")
    published_date : str | None = Field(None, description = "Date of the publication if available")


class GrowthSignal(BaseModel):
    signal : str = Field(..., description = "Description of the growth event")
    signal_type : str = Field("expansion", description = "Type: funding, hiring, product_launch, expansion, partnership")
    date : str | None = Field(None, description = "Reported date of the signal")
    source_url : str | None = Field(None, description = "Link proving this signal")


class DecisionMaker(BaseModel):
    name : str = Field(..., description = "Full name of leader")
    role : str | None = Field(None, description = "Title or role")
    source_url : str | None = Field(None, description = "Link or profile verifying this role")


class CompanyIntelligence(BaseModel):
    company_name : str = Field(..., description = "Name of the company", min_length = 1, max_length = 100)
    website : str | None = Field(None, description = "Website")
    official_contact_pages : List[str] = Field(default_factory=list, description="Official company contact/inquiry page URLs (not personal contact details)")
    
    company_description : str | None = Field(None, description = "Description of the company")
    industry : str | None = Field(None, description = "Industry or category")
    target_market : str | None = Field(None, description = "target customers that company serves")

    employee_size : str | None = Field(None, description = "employee size of the company")
    employee_size_source : str | None = Field(None, description = "Source URL or citation for employee size reporting")
    funding_info : str | None = Field(None, description = "Valuation history, tender offer valuations, funding stage")
    recent_growth_signals : List[GrowthSignal] = Field(default_factory = list)
    potential_gtm_opportunity : str | None = Field(None, description = "Reasoned hypothesis about the GTM opportunity")

    decision_makers : List[DecisionMaker] = Field(default_factory = list)

    source_urls : List[SourceEvidence] = Field(default_factory = list, description = "all sources that supports the findings")

    field_confidence : dict = Field(default_factory = dict, description = "map of field to confidence level (verified, provider-reported, inferred, unavailable)")
    firmographics : dict = Field(default_factory = dict, description = "Firmographic intelligence from public research and provider enrichment")
    research_metadata : dict = Field(default_factory=dict, description="Research execution metadata: timestamp, providers used, errors encountered")


class ResearchResponse(BaseModel):
    success : bool = Field(..., description = "Whether the research request completed successfully")
    data : CompanyIntelligence | None = Field(None, description = "Company intelligence")
    errors : List[str] = Field(default_factory = list, description = "Any errors encountered during research")
    warnings : List[str] = Field(default_factory = list, description = "Any warnings generated during research")
    research_duration_seconds : float = Field(..., description = "How long the research took in seconds")
    providers_used : List[str] = Field(default_factory = list, description = "List of providers used in the research")
    timestamp : datetime = Field(..., description = "Timestamp of when the research was conducted")


class HealthResponse(BaseModel):
    status : str = Field(..., description = "Status of the application (healthy or unhealthy)")
    exa_configured : bool = Field(..., description = "Whether Exa is configured")
    moldset_configured : bool = Field(..., description = "Whether Moldset is configured")
    version : str = Field(..., description = "Version of the application")
    timestamp : datetime = Field(..., description = "Timestamp of when the health check was conducted")