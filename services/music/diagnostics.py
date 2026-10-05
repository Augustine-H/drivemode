"""Retain useful exception details without credentials, signed URLs, or locals."""
import os
import re
import traceback


def safe_error(error: BaseException) -> dict:
    def redact(value: str) -> str:
        token = os.environ.get("HF_TOKEN")
        if token:
            value = value.replace(token, "[REDACTED_TOKEN]")
        value = re.sub(r"hf_[A-Za-z0-9]{8,}", "[REDACTED_TOKEN]", value)
        value = re.sub(r"(?i)Bearer\s+\S+", "Bearer [REDACTED]", value)
        value = re.sub(r"(https?://[^\s?'\"]+)\?[^\s'\"]+", r"\1?[REDACTED_QUERY]", value)
        return value
    return {
        "type": type(error).__name__,
        "message": redact(str(error)),
        "traceback": redact("".join(traceback.format_exception(type(error), error, error.__traceback__))),
    }
