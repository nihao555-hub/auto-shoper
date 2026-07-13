from collections import deque
from datetime import UTC, datetime
from threading import Lock

_MAX_EVENTS = 200
_events: deque[dict[str, object]] = deque(maxlen=_MAX_EVENTS)
_lock = Lock()


def mask(value: str | None, keep: int = 6) -> str | None:
    if value is None:
        return None
    if len(value) <= keep:
        return value
    return f"{value[:keep]}…({len(value)} chars)"


def record_event(event: str, **details: object) -> None:
    with _lock:
        _events.append(
            {
                "at": datetime.now(UTC).isoformat(timespec="milliseconds"),
                "event": event,
                **details,
            }
        )


def recent_events() -> list[dict[str, object]]:
    with _lock:
        return list(_events)[::-1]
