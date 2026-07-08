from langgraph.graph import StateGraph, START, END
from app.agents.state import ResearchState
from app.agents.orchestrator import orchestrator_node
from app.agents.retriever import retriever_node
from app.agents.synthesizer import synthesizer_node
from app.agents.reporter import reporter_node
from app.services.step_writer import traced

builder = StateGraph(ResearchState)
builder.add_node("orchestrator", traced("orchestrator")(orchestrator_node))
builder.add_node("retriever", traced("retriever")(retriever_node))
builder.add_node("synthesizer", traced("synthesizer")(synthesizer_node))
builder.add_node("reporter", traced("reporter")(reporter_node))
builder.add_edge(START, "orchestrator")
builder.add_edge("orchestrator", "retriever")
builder.add_edge("retriever", "synthesizer")
builder.add_edge("synthesizer", "reporter")
builder.add_edge("reporter", END)

research_graph = builder.compile()
