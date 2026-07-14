from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime

import pytest

from backend.app.database import AuthenticatedUser, get_database
from backend.app.main import app
from backend.app.services.auth import get_current_user


def _test_user() -> AuthenticatedUser:
    return AuthenticatedUser(
        id="test-user",
        workspace_id="test-workspace",
        email="test@example.com",
        display_name="Test User",
        workspace_name="Test Workspace",
    )


@dataclass(frozen=True)
class _TestStore:
    id: str = "test-store"
    expired: bool = False


class _TestDatabase:
    confirmations: list[dict[str, object]] = []
    snapshots: list[dict[str, object]] = []
    metric_events: list[dict[str, object]] = []

    def get_active_store(self, workspace_id: str) -> _TestStore:
        return _TestStore()

    def ensure_batch(self, workspace_id: str, store_id: str, batch_id: str) -> bool:
        return True

    def record_field_confirmation(self, **values: object) -> object:
        self.confirmations.append(values)

        @dataclass(frozen=True)
        class Confirmation:
            id: str = "test-confirmation"
            created_at: datetime = datetime(2026, 1, 1, tzinfo=UTC)

        return Confirmation()

    def save_draft_snapshot(self, **values: object) -> object:
        self.snapshots.append(values)
        return values

    def list_draft_snapshots(self, workspace_id: str, batch_id: str) -> list[object]:
        return []

    def get_listing_feature_flags(self, workspace_id: str) -> dict[str, bool]:
        return {
            "workflow_v2": True,
            "templates": True,
            "imports": True,
            "metrics": True,
            "legacy_fallback": True,
        }

    def record_listing_metric_event(self, **values: object) -> None:
        self.metric_events.append(values)


@pytest.fixture
def authenticated_app() -> Iterator[None]:
    app.dependency_overrides[get_current_user] = _test_user
    app.dependency_overrides[get_database] = _TestDatabase
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_database, None)
