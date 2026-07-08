from typing import TypedDict, Optional


class ResearchState(TypedDict):
    query: str
    collection_id: str
    access_token: str
    user_id: str
    session_id: str
    step_index: int
    intent: str
    refined_queries: list[str]
    chunks: list[dict]
    answer: Optional[str]
    report: Optional[str]
    confidence_flags: list[dict]   # critic: [{"section", "grounded", "note"}]
    needs_retry: bool              # critic: True only when low confidence AND novel gap queries exist
    loop_count: int                # incremented by the critic each pass; hard cap 2 (ASI10)
    use_web: bool                  # orchestrator: True when the question likely needs live web info
    web_snippets: list[dict]       # web_scout: [{"content", "url", "title", "trust_level"}]
    web_status: str                # web_scout: "not_run" | "ok" | "unavailable"