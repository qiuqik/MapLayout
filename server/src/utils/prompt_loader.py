from functools import lru_cache
from pathlib import Path


PROMPT_DIR = Path(__file__).resolve().parents[2] / "prompts"


@lru_cache(maxsize=32)
def load_prompt(filename: str) -> str:
    """Load a versioned prompt file from server/prompts."""
    prompt_path = PROMPT_DIR / filename
    if not prompt_path.exists():
        raise FileNotFoundError(f"Prompt file not found: {prompt_path}")
    return prompt_path.read_text(encoding="utf-8").strip()

