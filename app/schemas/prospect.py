from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field


class ColumnDef(BaseModel):
    key: str
    label: str
    type: str = "text"


class AgentTodo(BaseModel):
    id: str
    task: str
    status: str = "completed"


class ProspectResponse(BaseModel):
    title: str
    summary: str
    todos: List[AgentTodo]
    columns: List[ColumnDef]
    rows: List[Dict[str, Any]]
    suggested_followups: List[str] = Field(default_factory=list)


class ProspectInput(BaseModel):
    prompt: str


class FollowupInput(BaseModel):
    prompt: str
    current_columns: List[ColumnDef]
    current_rows: List[Dict[str, Any]]
