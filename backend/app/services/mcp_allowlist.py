"""Sprint 2.5 — MCP tool allowlist (logic only; the MCP server itself ships in
Phase 5). Closes LLM03/ASI04 (Supply Chain) at the tool-invocation boundary:
even if a client requests an arbitrary tool name, only names on this list can
ever run. Deny-by-default — anything not explicitly listed is rejected.

This lives now, before the server exists, so Phase 5 wires an already-tested
guard into the route handler instead of inventing one under deadline. See
docs/SECURITY-RESEARCH-LOG.md for the NSA MCP guidance to revisit at that point.
"""

ALLOWED_MCP_TOOLS = frozenset({
    "search_documents",
    "research_topic",
    "list_collections",
})


class MCPToolNotAllowed(Exception):
    """Raised when a tool name is not on the allowlist. The Phase 5 route handler
    catches this and returns HTTP 403."""

    def __init__(self, tool_name: str):
        self.tool_name = tool_name
        super().__init__(f"Tool '{tool_name}' is not in the MCP allowlist")


def assert_tool_allowed(tool_name: str) -> None:
    """Deny-by-default gate. Call before dispatching any MCP tool invocation."""
    if tool_name not in ALLOWED_MCP_TOOLS:
        raise MCPToolNotAllowed(tool_name)
