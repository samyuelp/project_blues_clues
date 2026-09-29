"""
FastAPI app for Project Blue's Clues.

Serves:
- Static frontend from /public
- GET  /api/config              → sanitized config (no answers)
- POST /api/validate/clue       → { stepId, input }                       → { correct }
- POST /api/validate/gate       → { stepId, gateIndex, optionId?|input? } → { correct }
- POST /api/reset               → placeholder for server-side state reset
- GET  /docs                    → auto-generated API docs (FastAPI built-in)
"""

from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.config_loader import (
    check_gate_answer,
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


class GateSubmission(BaseModel):
    stepId: str
    gateIndex: int
    # For MCQ gates:
    optionId: Optional[str] = None
    # For text gates:
    input: Optional[str] = None


# ---------------------------------------------------------------------------
# API routes
# ---------------------------------------------------------------------------
@app.get("/api/config")
def get_config():
    """Return the sanitized config for the frontend."""
    return sanitize_config(CONFIG)


@app.post("/api/validate/clue")
def validate_clue(sub: ClueSubmission):
    """Check the initial clue input for a step."""
    step = STEPS_BY_ID.get(sub.stepId)
    if not step:
        raise HTTPException(status_code=404, detail="Unknown step")
    return {"correct": check_input(step, sub.input)}


@app.post("/api/validate/gate")
def validate_gate(sub: GateSubmission):
    """
    Check a gate's question. Handles both MCQ (optionId) and text (input).

    The step's config decides which field is meaningful. If the wrong
    field is provided, it's treated as incorrect rather than an error,
    since the client shouldn't be able to reach that state anyway.
    """
    step = STEPS_BY_ID.get(sub.stepId)
    if not step:
        raise HTTPException(status_code=404, detail="Unknown step")

    if sub.gateIndex < 0 or sub.gateIndex >= len(step["gates"]):
        raise HTTPException(status_code=404, detail="Unknown gate index")

    # Package whichever field was provided into a submission dict.
    submission = {}
    if sub.optionId is not None:
        submission["optionId"] = sub.optionId
    if sub.input is not None:
        submission["input"] = sub.input

    correct = check_gate_answer(step, sub.gateIndex, submission)
    return {"correct": correct}


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
# Mounted last so it doesn't shadow the /api/* routes above.
app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")