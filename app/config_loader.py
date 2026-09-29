"""
Loads and validates config.json.

Responsibility:
- Read the JSON file from disk
- Validate its shape (basic checks so we fail loudly on typos)
- Provide a *sanitized* version for the frontend that strips answers

Why sanitize?
The frontend should never receive the correct answers. We keep them here
on the server and only return { correct: true/false } when the player submits.
"""

import json
import os
import re
from pathlib import Path
from typing import Any

CONFIG_PATH = Path(os.environ.get("CONFIG_PATH", "/app/config.json"))


# ---------------------------------------------------------------------------
# Loading + validation
# ---------------------------------------------------------------------------
def load_config() -> dict[str, Any]:
    """Read config.json from disk and validate it."""
    if not CONFIG_PATH.exists():
        raise FileNotFoundError(f"config.json not found at {CONFIG_PATH}")

    with CONFIG_PATH.open("r", encoding="utf-8") as f:
        config = json.load(f)

    _validate(config)
    return config


def _validate(config: dict[str, Any]) -> None:
    """Fail loudly if the config is missing required fields."""
    if "steps" not in config or not isinstance(config["steps"], list):
        raise ValueError("config.json must contain a 'steps' array")

    seen_ids: set[str] = set()
    for i, step in enumerate(config["steps"]):
        _validate_step(step, i)
        if step["id"] in seen_ids:
            raise ValueError(f"Duplicate step id: {step['id']}")
        seen_ids.add(step["id"])


def _validate_step(step: dict[str, Any], i: int) -> None:
    """Validate a single step entry."""
    if "id" not in step:
        raise ValueError(f"steps[{i}] is missing 'id'")

    sid = step["id"]

    # --- accepts: the clue input rule ---
    if "accepts" not in step:
        raise ValueError(f"steps[{i}] ({sid}) is missing 'accepts'")
    _validate_accepts(step["accepts"], f"steps[{i}] ({sid}) 'accepts'")

    # --- gates: the list of video+question gates ---
    if "gates" not in step or not isinstance(step["gates"], list):
        raise ValueError(f"steps[{i}] ({sid}) must have a 'gates' array")
    if len(step["gates"]) == 0:
        raise ValueError(f"steps[{i}] ({sid}) 'gates' is empty")

    for g, gate in enumerate(step["gates"]):
        _validate_gate(gate, f"steps[{i}] ({sid}) gates[{g}]")


def _validate_gate(gate: dict[str, Any], path: str) -> None:
    """Validate a single gate (video + question)."""
    # --- video ---
    if "video" not in gate:
        raise ValueError(f"{path} is missing 'video'")
    video = gate["video"]
    if "src" not in video:
        raise ValueError(f"{path} 'video' is missing 'src'")

    # --- question ---
    if "question" not in gate:
        raise ValueError(f"{path} is missing 'question'")
    _validate_question(gate["question"], f"{path} 'question'")


def _validate_question(q: dict[str, Any], path: str) -> None:
    """Validate a question — either MCQ or text."""
    qtype = q.get("type")
    if qtype not in ("mcq", "text"):
        raise ValueError(
            f"{path} 'type' must be 'mcq' or 'text' (got '{qtype}')"
        )

    if not q.get("text"):
        raise ValueError(f"{path} is missing 'text'")

    if qtype == "mcq":
        if "options" not in q or not isinstance(q["options"], list):
            raise ValueError(f"{path} (mcq) is missing 'options'")
        if len(q["options"]) < 2:
            raise ValueError(f"{path} (mcq) needs at least 2 options")
        option_ids = {opt.get("id") for opt in q["options"]}
        if None in option_ids:
            raise ValueError(f"{path} (mcq) has an option missing 'id'")
        if len(option_ids) != len(q["options"]):
            raise ValueError(f"{path} (mcq) has duplicate option ids")
        if q.get("answer") not in option_ids:
            raise ValueError(
                f"{path} (mcq) 'answer' '{q.get('answer')}' "
                f"is not one of the option ids {sorted(option_ids)}"
            )

    if qtype == "text":
        if "accepts" not in q:
            raise ValueError(f"{path} (text) is missing 'accepts'")
        _validate_accepts(q["accepts"], f"{path} (text) 'accepts'")


def _validate_accepts(accepts: dict[str, Any], path: str) -> None:
    """Validate an accepts rule — must have 'value' or 'pattern'."""
    has_value = "value" in accepts and accepts["value"] not in (None, "")
    has_pattern = "pattern" in accepts and accepts["pattern"] not in (None, "")
    if not has_value and not has_pattern:
        raise ValueError(f"{path} must have 'value' or 'pattern'")


# ---------------------------------------------------------------------------
# Sanitization (strip answers before sending to the frontend)
# ---------------------------------------------------------------------------
def sanitize_config(config: dict[str, Any]) -> dict[str, Any]:
    """
    Return a copy of the config safe to send to the frontend.
    Strips: accepts.value, accepts.pattern, question.answer.
    Keeps everything else (prompts, video paths, options, next clue, etc.)
    """
    safe = {
        "meta": config.get("meta", {}),
        "settings": config.get("settings", {}),
        "steps": [],
    }

    for step in config["steps"]:
        safe_step = {
            "id": step["id"],
            "prompt": step.get("prompt", ""),
            "gates": [],
            "vault": step.get("vault"),
            "nextClue": step.get("nextClue"),
        }

        for gate in step["gates"]:
            safe_gate = {
                "video": gate.get("video"),
                "question": _sanitize_question(gate["question"]),
            }
            safe_step["gates"].append(safe_gate)

        safe["steps"].append(safe_step)

    return safe


def _sanitize_question(q: dict[str, Any]) -> dict[str, Any]:
    """Strip the answer from a question before sending to the frontend."""
    safe = {
        "type": q["type"],
        "text": q.get("text", ""),
    }
    if q["type"] == "mcq":
        safe["options"] = [
            {"id": o["id"], "label": o["label"]} for o in q["options"]
        ]
    # For "text" questions, we send nothing extra — the frontend just
    # shows an input box. The accepts rule stays server-side.
    return safe


# ---------------------------------------------------------------------------
# Validation at play time
# ---------------------------------------------------------------------------
def _normalize(value: str) -> str:
    """Uppercase and strip everything that isn't a letter or digit."""
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def _matches(accepts: dict[str, Any], user_input: str) -> bool:
    """Generic matcher for anything with an accepts rule."""
    normalize = accepts.get("normalize", True)
    strict = accepts.get("strict", False)

    if "value" in accepts:
        candidate = user_input if (strict or not normalize) else _normalize(user_input)
        expected = accepts["value"]
        if normalize and not strict:
            expected = _normalize(expected)
        return candidate == expected

    if "pattern" in accepts:
        flags = 0 if accepts.get("caseSensitive") else re.IGNORECASE
        return re.fullmatch(accepts["pattern"], user_input, flags) is not None

    return False


def check_input(step: dict[str, Any], user_input: str) -> bool:
    """Check the initial clue input for a step."""
    return _matches(step["accepts"], user_input)


def check_gate_answer(step: dict[str, Any], gate_index: int, submission: dict) -> bool:
    """
    Check a gate's question submission.

    `submission` is a dict that looks like one of:
      {"optionId": "a"}       for MCQ
      {"input": "some text"}  for text
    """
    if gate_index < 0 or gate_index >= len(step["gates"]):
        return False

    q = step["gates"][gate_index]["question"]

    if q["type"] == "mcq":
        option_id = submission.get("optionId")
        if option_id is None:
            return False
        return q["answer"] == option_id

    if q["type"] == "text":
        user_input = submission.get("input")
        if user_input is None:
            return False
        return _matches(q["accepts"], user_input)

    return False