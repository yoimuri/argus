from app.services.document_processor import embed_query
from app.services.supabase_client import supabase_request
from app.agents.state import ResearchState

# Sprint 3a.1: retrieval runs once per Orchestrator-refined sub-query instead of
# once on the raw query, so a vague/meta question ("summarize for me") samples the
# document broadly instead of landing on one arbitrary top-5. Results are merged,
# deduped by chunk id, and capped so multi-query fan-out can't balloon the
# synthesizer's context.
#
# ── Sprint 4.8 retrieval rebuild (2026-08-01, ADR-025) ───────────────────────
# Live finding (Clint): answers were good on a DBIR-style thematic report but
# poor on a resume, a 1000+ row student list, and other non-report documents,
# and degraded further with several documents in one collection. Root causes,
# all three fixed here + in migration 021:
#
#   1. THE CONTEXT WINDOW WAS TINY AND FIXED. 5 chunks (specific) / 8 (broad),
#      capped at 8 final = ~6.4k characters, regardless of whether the collection
#      held 3 pages or 3,000. A thematic report survives that because its answer
#      is concentrated; a roster does not, because the answer is spread across
#      hundreds of near-identical rows. Widened below, sized against Groq's
#      free-tier 8k tokens/minute meter (see the budget note on FINAL_TOP_N).
#
#   2. NO PER-DOCUMENT FAIRNESS. match_count was a flat top-N over the whole
#      collection, so the single wordiest document about a topic could win every
#      slot and the rest of the collection was invisible. That is exactly the
#      reported "upload multiple docs and it stops answering properly". Fixed by
#      the per-document quota in _apply_document_fairness().
#
#   3. SEMANTIC-ONLY SEARCH CANNOT DO EXACT TERMS (names, ids, dates, codes).
#      Fixed in the database: migration 021's hybrid_match_chunks() fuses the
#      pgvector search with a Postgres full-text search using Reciprocal Rank
#      Fusion. This module calls that RPC and falls back to the old
#      semantic-only RPC if it is missing (deploy-order safety: the code can ship
#      before Clint pastes the migration, and simply behaves as before until he
#      does).
# ─────────────────────────────────────────────────────────────────────────────

# Per-sub-query candidate counts. These feed the merge; FINAL_TOP_N caps what
# actually reaches the synthesizer, so raising these widens the pool the fusion
# and fairness pass get to choose from without directly costing context tokens.
SPECIFIC_MATCH_COUNT = 12
BROAD_MATCH_COUNT = 16

# CONTEXT BUDGET (Clint's decision, 2026-08-01: "balanced ~20-24 chunks").
# 22 chunks x ~800 chars = ~17.6k chars ≈ 4.4k tokens of context. Plus the
# system prompt, the question and the answer itself, one synthesizer call lands
# comfortably under Groq's free-tier 8,000 tokens/minute meter -- deliberately
# NOT maxed, because exceeding that meter makes questions fail silently (SDK
# backoff), which would be a worse bug than the one this fixes.
FINAL_TOP_N = 22

# A "summarize this" (meta) query needs breadth over precision -- 8 chunks of a
# 300-chunk collection made the synthesizer honestly refuse ("not enough
# information to summarize the full reports", live 2026-07-13). Meta also skips
# the critic call (critic.py), which frees meter headroom for a wider cut.
META_FINAL_TOP_N = 26

# Meta intent has no real topic, so semantic search under-samples positional
# info like a document's title/author, which lives in its opening chunk. Forcing
# chunk_index=0 into the candidate set fixes that. Raised from 3 with the wider
# budget: on a multi-document collection the lead chunk of EVERY document is the
# cheapest possible "what is in this collection" signal.
MAX_LEAD_CHUNKS = 6

# Per-document fairness (cause 2 above). No single document may occupy more than
# this share of the final context, UNLESS the collection has too few documents
# for the cap to matter (a 1-document collection is allowed everything). Applied
# after relevance ordering, so within its quota a document still contributes its
# best chunks -- this caps dominance, it does not equalize.
MAX_DOC_SHARE = 0.6


async def _fetch_lead_chunks(collection_id: str, access_token: str) -> list[dict]:
    """chunk_index=0 of every document in the collection. document_chunks has no
    collection_id column, so the filter goes through the documents join; RLS still
    scopes rows to the caller. Falls back to two plain queries if the embedded
    filter syntax ever misbehaves against PostgREST."""
    try:
        rows = await supabase_request(
            "GET",
            "document_chunks"
            "?select=id,document_id,content,chunk_index,trust_level,documents!inner(collection_id)"
            f"&chunk_index=eq.0&documents.collection_id=eq.{collection_id}",
            access_token,
        )
        for row in rows:
            row.pop("documents", None)
        return rows
    except Exception as err:
        print(f"[ARGUS] retriever lead-chunk join query failed, falling back: {err!r}")

    docs = await supabase_request(
        "GET", f"documents?collection_id=eq.{collection_id}&select=id", access_token,
    )
    doc_ids = ",".join(d["id"] for d in docs)
    if not doc_ids:
        return []
    return await supabase_request(
        "GET",
        f"document_chunks?document_id=in.({doc_ids})&chunk_index=eq.0"
        "&select=id,document_id,content,chunk_index,trust_level",
        access_token,
    )


async def _search_chunks(
    sub_query: str,
    query_embedding: list,
    state: ResearchState,
    match_count: int,
) -> tuple[list[dict], str]:
    """One retrieval pass. Tries the hybrid RPC (migration 021) and falls back to
    the semantic-only RPC if it isn't there yet.

    Returns (rows, mode) where mode is 'hybrid' or 'semantic', so the caller can
    trace which path actually ran -- important because the two behave very
    differently on exact-term questions and a silent fallback would look like a
    quality regression with no explanation.
    """
    try:
        rows = await supabase_request(
            "POST",
            "rpc/hybrid_match_chunks",
            state["access_token"],
            json_body={
                "query_embedding": query_embedding,
                "query_text": sub_query,
                "match_collection_id": state["collection_id"],
                "match_count": match_count,
            },
        )
        return rows, "hybrid"
    except Exception as err:
        # Migration 021 not pasted yet (PostgREST 404 on the unknown function) or
        # any other hybrid-path failure: fall back rather than fail the query.
        print(f"[ARGUS] retriever hybrid RPC unavailable, falling back to semantic: {err!r}")

    rows = await supabase_request(
        "POST",
        "rpc/match_document_chunks",
        state["access_token"],
        json_body={
            "query_embedding": query_embedding,
            "match_collection_id": state["collection_id"],
            "match_count": match_count,
        },
    )
    return rows, "semantic"


def _apply_document_fairness(rows: list[dict], top_n: int) -> list[dict]:
    """Cap how much of the final context any ONE document may occupy.

    Rows arrive in relevance order. We walk them in that order and skip a row
    whose document already holds its quota, appending skipped rows to a reserve
    that backfills if the quota pass leaves the context under-filled (a
    1-document collection, or one where only one document is relevant at all --
    starving the context to enforce "fairness" would be worse than dominance).
    """
    doc_ids = {r.get("document_id") for r in rows if r.get("document_id")}
    # With 0 or 1 documents there is nothing to be fair between.
    if len(doc_ids) < 2:
        return rows[:top_n]

    quota = max(1, int(top_n * MAX_DOC_SHARE))
    per_doc: dict = {}
    kept: list[dict] = []
    reserve: list[dict] = []

    for row in rows:
        doc_id = row.get("document_id")
        used = per_doc.get(doc_id, 0)
        if used < quota:
            per_doc[doc_id] = used + 1
            kept.append(row)
            if len(kept) >= top_n:
                return kept
        else:
            reserve.append(row)

    # Under-filled: backfill from the rows the quota pushed out, still in
    # relevance order.
    for row in reserve:
        if len(kept) >= top_n:
            break
        kept.append(row)
    return kept[:top_n]


async def retriever_node(state: ResearchState) -> dict:
    refined_queries = state.get("refined_queries") or [state["query"]]
    intent = state.get("intent", "specific")
    match_count = SPECIFIC_MATCH_COUNT if intent == "specific" else BROAD_MATCH_COUNT

    seen_ids = set()
    # Content-level dedupe on top of id-level (2026-07-13): a collection can
    # hold the same PDF twice (live-seen -- re-upload workarounds), and its twin
    # chunks have different ids but identical text. Without this, duplicates
    # burn top-N slots pairwise (the live screenshot showed "Chunk 0" twice),
    # halving the breadth a summary sees. Keyed on a prefix -- identical opening
    # 300 chars means the same source text for 800-char fixed-window chunks.
    seen_content = set()
    merged = []
    modes = set()

    def _is_new(row) -> bool:
        row_id = row.get("id")
        if row_id in seen_ids:
            return False
        content_key = (row.get("content") or "")[:300]
        if content_key and content_key in seen_content:
            return False
        seen_ids.add(row_id)
        if content_key:
            seen_content.add(content_key)
        return True

    for rank_pos, sub_query in enumerate(refined_queries):
        query_embedding = await embed_query(sub_query)
        rows, mode = await _search_chunks(sub_query, query_embedding, state, match_count)
        modes.add(mode)

        # Preserve the RPC's own ordering (2026-08-01 fix, see the sort below).
        # hybrid_match_chunks returns rows in FUSED rank order — that ordering is
        # the whole product of the search and must not be thrown away. We stamp
        # each row with the position it arrived in so the merge can restore it.
        for position, row in enumerate(rows):
            row["_rank"] = position
            row["_sub"] = rank_pos

        # Observability: dim should always be 384, and rows should be non-zero for a
        # populated collection (neither RPC applies a similarity threshold). If a
        # future run returns an empty answer, these numbers say immediately whether
        # the cause was a bad embedding (wrong dim), the RPC returning nothing, or a
        # silent fallback to semantic-only search.
        dim = len(query_embedding) if isinstance(query_embedding, list) else "N/A"
        print(f"[ARGUS] retriever sub_query={sub_query!r} mode={mode} embed_dim={dim} rows={len(rows)}")

        for row in rows:
            if _is_new(row):
                merged.append(row)

    # THE 2026-08-01 BUG (live-found on the seating-list lookup, and it was the
    # real reason "find my name" still failed after migrations 021+022):
    #
    #     merged.sort(key=lambda r: r.get("similarity", 0), reverse=True)
    #
    # `similarity` is the COSINE score, and a KEYWORD-ONLY hit legitimately has
    # none -- the SQL reports 0.0 for it (documented in migration 021: inventing
    # a score would be dishonest). So this sort took the exact-term matches --
    # the entire reason hybrid search exists -- and pushed them BELOW every
    # semantic filler row, where FINAL_TOP_N then cut them off. Measured on
    # Clint's real document: his chunk arrived from the RPC ranked #1 of 32 and
    # this line moved it to #31, so it never reached the synthesizer. The
    # database was working; this line threw the answer away.
    #
    # Fix: keep the RPC's fused order. Rows are interleaved by their rank within
    # each sub-query (all the #1s, then all the #2s, ...) so multi-query fan-out
    # stays fair without ever re-scoring by a metric half the rows don't have.
    merged.sort(key=lambda r: (r.get("_rank", 0), r.get("_sub", 0)))

    lead_chunks = []
    if intent == "meta":
        candidates = await _fetch_lead_chunks(state["collection_id"], state["access_token"])
        for row in candidates:
            if not _is_new(row):
                continue
            lead_chunks.append(row)
            if len(lead_chunks) >= MAX_LEAD_CHUNKS:
                break
        print(f"[ARGUS] retriever meta lead-chunks={len(lead_chunks)}")

    # Lead chunks go first so the top-N cap can't drop them. Meta keeps a wider
    # cut (see META_FINAL_TOP_N) because a summary needs breadth.
    top_n = META_FINAL_TOP_N if intent == "meta" else FINAL_TOP_N
    # Fairness runs on the relevance-ordered merge only; lead chunks are already
    # one-per-document by construction and are exempt from the quota.
    fair = _apply_document_fairness(merged, max(0, top_n - len(lead_chunks)))
    final = lead_chunks + fair

    doc_spread = len({r.get("document_id") for r in final if r.get("document_id")})
    mode_label = "+".join(sorted(modes)) if modes else "none"
    # Keyword-only hits report similarity 0.0 by design (they were found by
    # exact-term match, not cosine). Counting them in the trace makes the
    # keyword half's contribution VISIBLE -- if a name lookup ever fails again,
    # this number says immediately whether the exact-term matches reached the
    # synthesizer or were dropped somewhere between the RPC and here.
    keyword_only = sum(1 for r in final if not r.get("similarity"))
    print(
        f"[ARGUS] retriever intent={intent!r} mode={mode_label} "
        f"sub_queries={len(refined_queries)} merged={len(merged)} "
        f"returned={len(final)} across_docs={doc_spread} keyword_only={keyword_only}"
    )
    # Report the best cosine among rows that HAVE one; 0.0 placeholders from
    # keyword-only rows would otherwise drag this to a meaningless number.
    scored = [r.get("similarity", 0) for r in final if r.get("similarity")]
    top_similarity = max(scored, default=0)
    keyword_note = f", {keyword_only} exact-term" if keyword_only else ""
    return {
        "chunks": final,
        "trace_detail": (
            f"{len(final)} chunks from {doc_spread} document(s){keyword_note}, "
            f"{mode_label} search, top similarity {top_similarity:.2f}"
        ),
    }
