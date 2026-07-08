from langgraph.graph import StateGraph, START, END
from app.agents.state import ResearchState
from app.agents.orchestrator import orchestrator_node
from app.agents.web_scout import web_scout_node
from app.agents.retriever import retriever_node
from app.agents.synthesizer import synthesizer_node
from app.agents.critic import critic_node
from app.agents.reporter import reporter_node
from app.services.step_writer import traced

builder = StateGraph(ResearchState)
builder.add_node("orchestrator", traced("orchestrator")(orchestrator_node))
builder.add_node("web_scout", traced("web_scout")(web_scout_node))
builder.add_node("retriever", traced("retriever")(retriever_node))
builder.add_node("synthesizer", traced("synthesizer")(synthesizer_node))
builder.add_node("critic", traced("critic")(critic_node))
builder.add_node("reporter", traced("reporter")(reporter_node))
builder.add_edge(START, "orchestrator")
# Sprint 3b: web_scout runs serially between orchestrator and retriever, not
# in parallel with the retriever as Phase 3b's original sketch had it. A
# parallel fan-in into the synthesizer would need a LangGraph state reducer
# and would interact badly with the Critic's retry cycle below (a retry loops
# back to the retriever only; web_scout would either re-run pointlessly or
# leave the synthesizer waiting on a predecessor that never fires again).
# Serial wiring means web_scout always runs exactly once per research call.
builder.add_edge("orchestrator", "web_scout")
builder.add_edge("web_scout", "retriever")
builder.add_edge("retriever", "synthesizer")
builder.add_edge("synthesizer", "critic")


def route_after_critic(state) -> str:
    # ASI10 bounded-loop cap. loop_count is incremented INSIDE the critic node
    # (critic.py), so it's already part of state by the time this router runs.
    # Pass 1 -> loop_count=1 (retry allowed), pass 2 -> loop_count=2 (always
    # done). LangGraph's default recursion_limit (25) is the backstop fence if
    # this router were ever bypassed.
    #
    # On a retry, the diary (execution_steps) shows retriever/synthesizer/critic
    # running TWICE with a continuous step_index (0-7 total) — that's the
    # intended, visible record of the self-check loop firing, not a bug.
    if state.get("needs_retry") and state.get("loop_count", 0) < 2:
        return "retry"
    return "done"


builder.add_conditional_edges("critic", route_after_critic, {"retry": "retriever", "done": "reporter"})
builder.add_edge("reporter", END)

research_graph = builder.compile()
