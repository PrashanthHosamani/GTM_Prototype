import os
from datetime import datetime
from fastapi import APIRouter, HTTPException

from app.schemas.company import (
    ResearchInput,
    ResearchResponse,
    HealthResponse,
)
from app.services.research_service import ResearchService

router = APIRouter()
research_service = ResearchService()


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
