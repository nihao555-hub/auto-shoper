from collections.abc import Iterator
from dataclasses import dataclass

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
    def get_active_store(self, workspace_id: str) -> _TestStore:
        return _TestStore()

    def ensure_batch(self, workspace_id: str, store_id: str, batch_id: str) -> bool:
        return True


@pytest.fixture
def authenticated_app() -> Iterator[None]:
    app.dependency_overrides[get_current_user] = _test_user
    app.dependency_overrides[get_database] = _TestDatabase
    try:
        yield
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        app.dependency_overrides.pop(get_database, None)
