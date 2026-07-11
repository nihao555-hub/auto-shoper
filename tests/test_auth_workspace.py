import sqlite3
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.database import Database, get_database
from backend.app.main import app


@pytest.fixture
def workspace_database(tmp_path: Path) -> Iterator[Database]:
    settings = Settings(
        database_path=str(tmp_path / "workspace.db"),
        registration_codes="CODE-A,CODE-B,CODE-C",
        token_encryption_key="test-only-token-encryption-key",
    )
    database = Database(settings)
    app.dependency_overrides[get_database] = lambda: database
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        yield database
    finally:
        app.dependency_overrides.pop(get_database, None)
        app.dependency_overrides.pop(get_settings, None)


def test_registration_requires_configured_code(tmp_path: Path) -> None:
    settings = Settings(
        database_path=str(tmp_path / "closed.db"),
        registration_codes="",
        token_encryption_key="test-only-token-encryption-key",
    )
    database = Database(settings)
    app.dependency_overrides[get_database] = lambda: database
    app.dependency_overrides[get_settings] = lambda: settings
    try:
        response = TestClient(app).post(
            "/api/v1/auth/register",
            json={
                "email": "owner@example.com",
                "password": "strong-password",
                "display_name": "Owner",
                "workspace_name": "Example Trading",
                "registration_code": "MISSING",
            },
        )
        assert response.status_code == 503
    finally:
        app.dependency_overrides.pop(get_database, None)
        app.dependency_overrides.pop(get_settings, None)


def test_registration_session_and_one_time_code(workspace_database: Database) -> None:
    client = TestClient(app)
    payload = {
        "email": "owner@example.com",
        "password": "strong-password",
        "display_name": "Owner",
        "workspace_name": "Example Trading",
        "registration_code": "CODE-A",
    }
    registered = client.post("/api/v1/auth/register", json=payload)
    assert registered.status_code == 201
    assert registered.json()["workspace_name"] == "Example Trading"
    assert "auto_shoper_session" in registered.cookies

    current_user = client.get("/api/v1/auth/me")
    assert current_user.status_code == 200
    assert current_user.json()["email"] == "owner@example.com"

    reused = TestClient(app).post(
        "/api/v1/auth/register",
        json={
            **payload,
            "email": "second@example.com",
            "workspace_name": "Second Workspace",
        },
    )
    assert reused.status_code == 409


def test_login_duplicate_email_and_logout(workspace_database: Database) -> None:
    registration = {
        "email": "OWNER@Example.com",
        "password": "strong-password",
        "display_name": "Owner",
        "workspace_name": "Example Trading",
        "registration_code": "CODE-B",
    }
    first_client = TestClient(app)
    assert first_client.post("/api/v1/auth/register", json=registration).status_code == 201

    duplicate = TestClient(app).post(
        "/api/v1/auth/register",
        json={**registration, "registration_code": "CODE-C"},
    )
    assert duplicate.status_code == 409

    client = TestClient(app)
    invalid = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "wrong-password"},
    )
    assert invalid.status_code == 401

    login = client.post(
        "/api/v1/auth/login",
        json={"email": "owner@example.com", "password": "strong-password"},
    )
    assert login.status_code == 200
    assert client.post("/api/v1/auth/logout").status_code == 204
    assert client.get("/api/v1/auth/me").status_code == 401


def test_store_tokens_are_encrypted_and_workspace_scoped(workspace_database: Database) -> None:
    first_user, _ = workspace_database.register(
        email="first@example.com",
        password="strong-password",
        display_name="First",
        workspace_name="First Workspace",
        registration_code="CODE-A",
    )
    second_user, _ = workspace_database.register(
        email="second@example.com",
        password="strong-password",
        display_name="Second",
        workspace_name="Second Workspace",
        registration_code="CODE-B",
    )
    first_store = workspace_database.upsert_store(
        workspace_id=first_user.workspace_id,
        provider_user_id="merchant-one",
        login_id="merchant-one@example.com",
        account="merchant-one",
        access_token="plain-access-token",
        refresh_token="plain-refresh-token",
        expires_at=datetime.now(UTC) + timedelta(days=30),
        refresh_expires_at=datetime.now(UTC) + timedelta(days=90),
    )
    second_store = workspace_database.upsert_store(
        workspace_id=second_user.workspace_id,
        provider_user_id="merchant-two",
        login_id="merchant-two@example.com",
        account="merchant-two",
        access_token="second-access-token",
        refresh_token=None,
        expires_at=None,
        refresh_expires_at=None,
    )

    with sqlite3.connect(workspace_database.settings.database_path) as connection:
        stored = connection.execute(
            "SELECT access_token_encrypted, refresh_token_encrypted "
            "FROM store_connections WHERE id = ?",
            (first_store.id,),
        ).fetchone()
    assert stored is not None
    assert "plain-access-token" not in stored[0]
    assert "plain-refresh-token" not in stored[1]
    assert workspace_database.get_active_store(first_user.workspace_id) == first_store
    assert workspace_database.get_store(first_user.workspace_id, second_store.id) is None
    assert workspace_database.activate_store(first_user.workspace_id, second_store.id) is None

    client = TestClient(app)
    client.cookies.set("auto_shoper_session", workspace_database.create_session(first_user.id))
    response = client.get("/api/v1/alibaba/stores")
    assert response.status_code == 200
    assert [store["id"] for store in response.json()["stores"]] == [first_store.id]
    assert "access_token" not in response.text
    assert "refresh_token" not in response.text

    assert workspace_database.ensure_batch(
        first_user.workspace_id,
        first_store.id,
        "BATCH-STORE-LOCK",
    )
    another_store = workspace_database.upsert_store(
        workspace_id=first_user.workspace_id,
        provider_user_id="merchant-three",
        login_id="merchant-three@example.com",
        account="merchant-three",
        access_token="third-access-token",
        refresh_token=None,
        expires_at=None,
        refresh_expires_at=None,
    )
    assert not workspace_database.ensure_batch(
        first_user.workspace_id,
        another_store.id,
        "BATCH-STORE-LOCK",
    )
    assert workspace_database.list_batches(first_user.workspace_id)[0][
        "store_connection_id"
    ] == first_store.id


def test_oauth_state_is_workspace_bound_and_one_time(workspace_database: Database) -> None:
    user, _ = workspace_database.register(
        email="owner@example.com",
        password="strong-password",
        display_name="Owner",
        workspace_name="Example Trading",
        registration_code="CODE-A",
    )
    state = workspace_database.create_oauth_state(user)

    assert workspace_database.consume_oauth_state(state) == (user.workspace_id, user.id)
    assert workspace_database.consume_oauth_state(state) is None
    assert workspace_database.consume_oauth_state("unknown-state") is None
