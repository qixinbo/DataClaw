def normalize_openai_base_url(api_base: str) -> str:
    normalized = (api_base or "").strip().rstrip("/")
    if normalized.lower().endswith("/embeddings"):
        normalized = normalized[: -len("/embeddings")]
    return normalized
