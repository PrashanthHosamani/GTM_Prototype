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


class QuestionOption(BaseModel):
    id: str
    number: int
    title: str
    description: Optional[str] = None


class ClarificationQuestion(BaseModel):
    question_id: str
    tag: str = "QUESTION"
    question: str
    options: List[QuestionOption]
    allow_custom: bool = True


class ProspectResponse(BaseModel):
    title: str
    summary: str
    todos: List[AgentTodo]
    columns: List[ColumnDef]
    rows: List[Dict[str, Any]]
    suggested_followups: List[str] = Field(default_factory=list)
    session_id: Optional[str] = None
    clarification_question: Optional[ClarificationQuestion] = None


class ProspectInput(BaseModel):
    prompt: str
    session_id: Optional[str] = None


class FollowupInput(BaseModel):
    prompt: str
    current_columns: List[ColumnDef]
    current_rows: List[Dict[str, Any]]
    session_id: Optional[str] = None
