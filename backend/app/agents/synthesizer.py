import os
from groq import AsyncGroq
from app.agents.state import ResearchState

_client = AsyncGroq(api_key=os.environ["GROQ_API_KEY"])

SYSTEM_PROMPT = (
    "You are a research assistant. Answer the user's question using ONLY the "
    "context chunks provided below. Do not use any outside knowledge. If the "
    "context does not contain enough information to answer, say so plainly "
    "instead of guessing."
)


async def synthesizer_node(state: ResearchState) -> dict:
    chunks = state["chunks"]

    if not chunks:
        # Nothing came back from the filing cabinet. Don't even call the model,
        # there's nothing real to ground it in, this is the "say so honestly"
        # path from earlier.
        return {"answer": "No relevant information was found in this collection for that query."}

    context = "\n\n".join(f"[Chunk {c['chunk_index']}] {c['content']}" for c in chunks)

    completion = await _client.chat.completions.create(
        model="openai/gpt-oss-20b",
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Context:\n{context}\n\nQuestion: {state['query']}"},
        ],
    )

    return {"answer": completion.choices[0].message.content}
