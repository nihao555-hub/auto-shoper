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
    operation_audits: list[dict[str, object]] = []
    publish_jobs: dict[str, dict[str, object]] = {}
    workbench_snapshot: dict[str, object] | None = None

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

    def record_operation_audit(self, **values: object) -> None:
        self.operation_audits.append(values)

    def get_publish_job(self, workspace_id: str, idempotency_key: str) -> dict[str, object] | None:
        return self.publish_jobs.get(idempotency_key)

    def list_publish_jobs(self, workspace_id: str, batch_id: str) -> list[dict[str, object]]:
        return [job for job in self.publish_jobs.values() if job["batch_id"] == batch_id]

    def upsert_publish_job(self, **values: object) -> dict[str, object]:
        key = str(values["idempotency_key"])
        existing = self.publish_jobs.get(key, {})
        job = {
            "id": existing.get("id", "test-publish-job"),
            "batch_id": values["batch_id"],
            "reference": values["reference"],
            "idempotency_key": key,
            "draft_product_id": values.get("draft_product_id"),
            "published_product_id": values.get("published_product_id"),
            "status": values["status"],
            "platform_status": values.get("platform_status"),
            "request": values.get("request", {}),
            "response": values.get("response", existing.get("response", {})),
            "quality": values.get("quality", existing.get("quality", {})),
            "error": values.get("error"),
            "trace_id": values.get("trace_id"),
            "attempt_count": int(existing.get("attempt_count", 0)) + int(bool(values.get("increment_attempt"))),
            "last_checked_at": "2026-01-01T00:00:00+00:00" if values.get("checked") else existing.get("last_checked_at"),
            "created_at": existing.get("created_at", "2026-01-01T00:00:00+00:00"),
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        self.publish_jobs[key] = job
        return job

    def get_workbench_snapshot(self, workspace_id: str, store_id: str) -> dict[str, object] | None:
        return self.workbench_snapshot

    def save_workbench_snapshot(self, **values: object) -> dict[str, object]:
        type(self).workbench_snapshot = {
            "snapshot": values["snapshot"],
            "version": values["version"],
            "updated_at": "2026-01-01T00:00:00+00:00",
        }
        return type(self).workbench_snapshot


@pytest.fixture
def authenticated_app() -> Iterator[None]:
    app.dependency_overrides[get_current_user] = _test_user
    app.dependency_overrides[get_database] = _TestDatabase
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_database, None)
