import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes import router as api_router

app = FastAPI(
    title = "Outmate GTM Intelligence API",
    description = "AI-powered company research and enrichment prototype inspired by Orange Slice and Clay",
    version = "0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins = ["*"],
    allow_credentials = True,
    allow_methods = ["*"],
    allow_headers = ["*"],
)

app.include_router(api_router, prefix = "/api", tags = ["Research"])

frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")


@app.get("/")
async def serve_index():
    index_file = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {
        "name" : "Outmate GTM Intelligence Prototype",
        "docs" : "/docs",
        "health" : "/api/health"
    }


@app.get("/deep")
async def serve_deep():
    return await serve_index()


@app.get("/prospect")
async def serve_prospect():
    return await serve_index()


@app.exception_handler(StarletteHTTPException)
async def custom_404_handler(request, exc):
    if request.url.path.startswith("/api"):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})
    index_file = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return JSONResponse(status_code=404, content={"detail": "Not Found"})


if os.path.exists(frontend_dir):
    app.mount("/app", StaticFiles(directory = frontend_dir, html = True), name = "frontend_app")
    app.mount("/", StaticFiles(directory = frontend_dir, html = True), name = "frontend_root")
