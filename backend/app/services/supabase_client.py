import os
import httpx
from fastapi import HTTPException

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_PUBLISHABLE_KEY = os.environ["SUPABASE_PUBLISHABLE_KEY"]


async def supabase_request(method: str, path: str, access_token: str, json_body=None):
    url = f"{SUPABASE_URL}/rest/v1/{path}"
    headers = {
        "apikey": SUPABASE_PUBLISHABLE_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }
    async with httpx.AsyncClient() as client:
        response = await client.request(method, url, json=json_body, headers=headers)
        if response.status_code >= 400:
            print(f"Supabase request failed: {method} {path} -> {response.status_code}: {response.text}")
            raise HTTPException(status_code=502, detail="Database request failed.")
        return response.json() if response.text else []
