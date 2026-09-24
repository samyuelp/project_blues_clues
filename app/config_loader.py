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
        if "id" not in step:
            raise ValueError(f"steps[{i}] is missing 'id'")
        if step["id"] in seen_ids:
            raise ValueError(f"Duplicate step id: {step['id']}")
        seen_ids.add(step["id"])

        if "accepts" not in step:
            raise ValueError(f"steps[{i}] ({step['id']}) is missing 'accepts'")
        if not step["accepts"].get("value") and not step["accepts"].get("pattern"):
            raise ValueError(
                f"steps[{i}] ({step['id']}) 'accepts' must have 'value' or 'pattern'"
            )

        q = step.get("question")
        if q:
            if q.get("type") != "mcq":
                raise ValueError(
                    f"steps[{i}] ({step['id']}) question.type must be 'mcq' for now"
                )
            if "options" not in q or not isinstance(q["options"], list):
                raise ValueError(
                    f"steps[{i}] ({step['id']}) question is missing 'options'"
                )
            option_ids = {opt["id"] for opt in q["options"]}
            if q.get("answer") not in option_ids:
                raise ValueError(
                    f"steps[{i}] ({step['id']}) question.answer "
                    f"'{q.get('answer')}' is not one of the option ids"
                )


def sanitize_config(config: dict[str, Any]) -> dict[str, Any]:
    """
    Return a copy of the config safe to send to the frontend.
    Strips: accepts.value, accepts.pattern, question.answer.
    Keeps everything else (prompts, video paths, options, etc.)
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
            "video": step.get("video"),
            "vault": step.get("vault"),
            "nextClue": step.get("nextClue"),
        }
        if step.get("question"):
            q = step["question"]
            safe_step["question"] = {
                "text": q.get("text", ""),
                "type": q["type"],
                # Keep option ids + labels, but NOT which is correct
                "options": [{"id": o["id"], "label": o["label"]} for o in q["options"]],
            }
        safe["steps"].append(safe_step)

    return safe


def _normalize(value: str) -> str:
    """Uppercase and strip everything that isn't a letter or digit."""
    return re.sub(r"[^A-Z0-9]", "", value.upper())


def check_input(step: dict[str, Any], user_input: str) -> bool:
    """Check a text/number input against the step's accepts rule."""
    accepts = step["accepts"]
    normalize = accepts.get("normalize", True)
    strict = accepts.get("strict", False)

    candidate = user_input if (strict or not normalize) else _normalize(user_input)

    if "value" in accepts:
        expected = accepts["value"]
        if normalize and not strict:
            expected = _normalize(expected)
        return candidate == expected

    if "pattern" in accepts:
        flags = 0 if accepts.get("caseSensitive") else re.IGNORECASE
        return re.fullmatch(accepts["pattern"], user_input, flags) is not None

    return False


def check_answer(step: dict[str, Any], option_id: str) -> bool:
    """Check an MCQ answer against the step's correct option id."""
    q = step.get("question")
    if not q:
        return False
    return q["answer"] == option_id