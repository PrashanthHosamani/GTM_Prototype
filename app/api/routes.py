import os
from datetime import datetime
from fastapi import APIRouter, HTTPException

from app.schemas.company import (
    ResearchInput,
    ResearchResponse,
    HealthResponse,
)
from app.schemas.prospect import (
    ProspectInput,
    FollowupInput,
    ProspectResponse,
)
from app.services.research_service import ResearchService
from app.services.prospect_service import ProspectService

router = APIRouter()
research_service = ResearchService()
prospect_service = ProspectService()


@router.get("/health", response_model = HealthResponse)
async def health_check():
    exa_configured = bool(os.getenv("EXA_API_KEY"))
    moldset_configured = bool(os.getenv("MOLDSET_API_KEY"))
    status = "healthy" if exa_configured else "degraded"

    return HealthResponse(
        status = status,
        exa_configured = exa_configured,
        moldset_configured = moldset_configured,
        version = "0.1.0",
        timestamp = datetime.utcnow()
    )


@router.post("/research", response_model = ResearchResponse)
async def research_company(input_data : ResearchInput):
    try:
        response = await research_service.execute_research(input_data)
        return response
    except Exception as e:
        raise HTTPException(
            status_code = 500,
            detail = f"Internal research service error: {str(e)}"
        )


@router.post("/prospect", response_model = ProspectResponse)
async def prospect_companies(input_data : ProspectInput):
    try:
        response = await prospect_service.execute_prospecting(input_data)
        return response
    except Exception as e:
        raise HTTPException(
            status_code = 500,
            detail = f"Internal prospecting service error: {str(e)}"
        )


@router.post("/prospect/followup", response_model = ProspectResponse)
async def prospect_followup(input_data : FollowupInput):
    try:
        response = await prospect_service.execute_followup(input_data)
        return response
    except Exception as e:
        raise HTTPException(
            status_code = 500,
            detail = f"Internal follow-up service error: {str(e)}"
        )
