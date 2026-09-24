"""
FastAPI app for Project Blue's Clues.

Serves:
- Static frontend from /public
- GET  /api/config              → sanitized config (no answers)
- POST /api/validate/clue       → { stepId, input }  → { correct }
- POST /api/validate/answer     → { stepId, optionId } → { correct }
- POST /api/reset               → resets server-side state
- GET  /docs                    → auto-generated API docs (FastAPI built-in)
"""

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config_loader import (
    check_answer,
    check_input,
    load_config,
    sanitize_config,
)

PUBLIC_DIR = Path("/app/public")

app = FastAPI(title="Project Blue's Clues")

# ---------------------------------------------------------------------------
# Config is loaded once at startup. If you edit config.json, restart the
# container (or run with --reload for dev) to pick up changes.
# ---------------------------------------------------------------------------
CONFIG = load_config()
STEPS_BY_ID = {step["id"]: step for step in CONFIG["steps"]}


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------
class ClueSubmission(BaseModel):
    stepId: str
    input: str


class AnswerSubmission(BaseModel):
    stepId: str
    optionId: str


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------
@app.get("/api/config")
def get_config():
    """Return the sanitized config for the frontend."""
    return sanitize_config(CONFIG)


@app.post("/api/validate/clue")
def validate_clue(sub: ClueSubmission):
    step = STEPS_BY_ID.get(sub.stepId)
    if not step:
        raise HTTPException(status_code=404, detail="Unknown step")
    return {"correct": check_input(step, sub.input)}


@app.post("/api/validate/answer")
def validate_answer(sub: AnswerSubmission):
    step = STEPS_BY_ID.get(sub.stepId)
    if not step:
        raise HTTPException(status_code=404, detail="Unknown step")
    return {"correct": check_answer(step, sub.optionId)}


@app.post("/api/reset")
def reset():
    """
    Placeholder for now — the frontend resets itself by reloading.
    Later you can add server-side progress tracking here.
    """
    return {"ok": True}


# ---------------------------------------------------------------------------
# Static frontend
# ---------------------------------------------------------------------------
# Serve /public/index.html at the root, and everything else under /public at /.
app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")