"""
In-memory store for observable agent runs.

This is intentionally process-local: it supports the current development and
debug workflow without changing persistence semantics for generated sessions.
"""

import asyncio
from dataclasses import dataclass, field
from typing import Any, Dict, Optional


@dataclass
class RunRecord:
    run_id: str
    queue: asyncio.Queue = field(default_factory=asyncio.Queue)
    done: bool = False
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class RunStore:
    def __init__(self) -> None:
        self._runs: Dict[str, RunRecord] = {}

    def create(self, run_id: str) -> RunRecord:
        record = RunRecord(run_id=run_id)
        self._runs[run_id] = record
        return record

    def get(self, run_id: str) -> Optional[RunRecord]:
        return self._runs.get(run_id)


run_store = RunStore()
