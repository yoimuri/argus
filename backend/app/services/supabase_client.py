import os
import httpx
from fastapi import HTTPException

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_PUBLISHABLE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]

# One shared client for the whole process. The old code opened a fresh
# httpx.AsyncClient() on every call — a new connection pool, TLS handshake, and
# teardown per Supabase request, and there are several of those per research/upload.
# Reusing one client keeps connections alive between calls. Explicit timeouts mean
# a slow Supabase can't hang a request indefinitely (a real gap before Sprint 2.4's
# circuit breaker lands). The client lives for the process lifetime by design.
_client = httpx.AsyncClient(
    base_url=f"{SUPABASE_URL}/rest/v1/",
    timeout=httpx.Timeout(15.0, connect=5.0),
)


async def supabase_request(method: str, path: str, access_token: str, json_body=None):
    headers = {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    response = await _client.request(method, path, json=json_body, headers=headers)
    if response.status_code >= 400:
        print(f"Supabase request failed: {method} {path} -> {response.status_code}: {response.text}")
        raise HTTPException(status_code=502, detail="Database request failed.")
    return response.json() if response.text else []
