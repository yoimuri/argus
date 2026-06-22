from typing import TypedDict, Optional


class ResearchState(TypedDict):
    query: str
    collection_id: str
    access_token: str
    chunks: list[dict]
    answer: Optional[str]
    report: Optional[str]
