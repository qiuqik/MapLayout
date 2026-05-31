"""
Typed event contract for observable multi-modal agent runs.
"""

from datetime import datetime
from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


AgentEventType = Literal[
    "workflow_started",
    "node_started",
    "node_completed",
    "node_validation",
    "node_retry",
    "artifact_saved",
    "workflow_completed",
    "workflow_error",
]

AgentNodeId = Literal[
    "intent",
    "visual",
    "geojson",
    "validation",
    "style",
]


class AgentEvent(BaseModel):
    type: AgentEventType
    run_id: str
    session_id: Optional[str] = None
    node_id: Optional[AgentNodeId] = None
    label: Optional[str] = None
    status: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())
