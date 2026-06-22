from langgraph.graph import StateGraph, START, END
from app.agents.state import ResearchState
from app.agents.retriever import retriever_node
from app.agents.synthesizer import synthesizer_node
from app.agents.reporter import reporter_node

builder = StateGraph(ResearchState)
builder.add_node("retriever", retriever_node)
builder.add_node("synthesizer", synthesizer_node)
builder.add_node("reporter", reporter_node)
builder.add_edge(START, "retriever")
builder.add_edge("retriever", "synthesizer")
builder.add_edge("synthesizer", "reporter")
builder.add_edge("reporter", END)

research_graph = builder.compile()
