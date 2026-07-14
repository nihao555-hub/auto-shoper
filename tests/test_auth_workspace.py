import hashlib
import sqlite3
import string
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.app.config import Settings, get_settings
from backend.app.database import SQLITE_SCHEMA, Database, get_database
from backend.app.main import app
from backend.app.registration_codes import generate_registration_codes


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


def test_database_seeded_code_opens_registration(tmp_path: Path) -> None:
    settings = Settings(
        database_path=str(tmp_path / "database-seeded.db"),
        registration_codes="",
        token_encryption_key="test-only-token-encryption-key",
    )
    database = Database(settings)
    code = "DatabaseSeededCode"
    database.add_registration_code_hashes([hashlib.sha256(code.encode()).hexdigest()])
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
                "registration_code": code,
            },
        )
        assert response.status_code == 201
        assert database.registration_code_counts() == (1, 0)
    finally:
        app.dependency_overrides.pop(get_database, None)
        app.dependency_overrides.pop(get_settings, None)


def test_registration_code_generator_is_unique_and_varied() -> None:
    codes = generate_registration_codes(count=170, min_length=16, max_length=32)

    assert len(codes) == 170
    assert len(set(codes)) == 170
    assert {len(code) for code in codes} == set(range(16, 33))
    assert all(set(code) <= set(string.ascii_letters) for code in codes)


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
    assert (
        workspace_database.list_batches(first_user.workspace_id)[0]["store_connection_id"]
        == first_store.id
    )


def test_listing_confirmation_and_snapshot_are_persisted(workspace_database: Database) -> None:
    user, _ = workspace_database.register(
        email="audit@example.com",
        password="strong-password",
        display_name="Audit User",
        workspace_name="Audit Workspace",
        registration_code="CODE-A",
    )
    store = workspace_database.upsert_store(
        workspace_id=user.workspace_id,
        provider_user_id="audit-merchant",
        login_id="audit@example.com",
        account="audit",
        access_token="audit-access-token",
        refresh_token=None,
        expires_at=datetime.now(UTC) + timedelta(days=30),
        refresh_expires_at=None,
    )
    assert workspace_database.ensure_batch(user.workspace_id, store.id, "batch-audit")

    confirmation = workspace_database.record_field_confirmation(
        workspace_id=user.workspace_id,
        batch_id="batch-audit",
        reference="SKU-001",
        field_path="subject",
        value="Professional Brush",
        original_source="ai_generated",
        action="accepted",
        evidence="Visible brush",
        schema_fingerprint="a" * 64,
        confirmed_by_user_id=user.id,
    )
    saved_confirmations = workspace_database.list_field_confirmations(
        user.workspace_id,
        "batch-audit",
        "SKU-001",
    )
    assert [item.id for item in saved_confirmations] == [confirmation.id]
    assert saved_confirmations[0].value == "Professional Brush"

    snapshot = workspace_database.save_draft_snapshot(
        workspace_id=user.workspace_id,
        batch_id="batch-audit",
        reference="SKU-001",
        product_id="123456",
        request_fields={"subject": {"value": "Professional Brush"}},
        platform_response={"subject": "Professional Brush"},
        differences=[
            {
                "field_path": "subject",
                "local_value": "Professional Brush",
                "platform_value": "Professional Brush",
                "status": "matched",
            }
        ],
    )
    saved_snapshots = workspace_database.list_draft_snapshots(
        user.workspace_id,
        "batch-audit",
    )
    assert [item.id for item in saved_snapshots] == [snapshot.id]
    assert saved_snapshots[0].product_id == "123456"
    assert saved_snapshots[0].differences[0]["status"] == "matched"


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


def test_disconnect_store_removes_tokens_and_preserves_batch_history(
    workspace_database: Database,
) -> None:
    user, _ = workspace_database.register(
        email="owner@example.com",
        password="strong-password",
        display_name="Owner",
        workspace_name="Example Trading",
        registration_code="CODE-A",
    )
    other_user, _ = workspace_database.register(
        email="other@example.com",
        password="strong-password",
        display_name="Other",
        workspace_name="Other Trading",
        registration_code="CODE-B",
    )
    fallback_store = workspace_database.upsert_store(
        workspace_id=user.workspace_id,
        provider_user_id="merchant-one",
        login_id="merchant-one@example.com",
        account="merchant-one",
        access_token="first-access-token",
        refresh_token=None,
        expires_at=None,
        refresh_expires_at=None,
    )
    disconnected_store = workspace_database.upsert_store(
        workspace_id=user.workspace_id,
        provider_user_id="merchant-two",
        login_id="merchant-two@example.com",
        account="merchant-two",
        access_token="token-that-must-be-removed",
        refresh_token="refresh-token-that-must-be-removed",
        expires_at=datetime.now(UTC) + timedelta(days=30),
        refresh_expires_at=datetime.now(UTC) + timedelta(days=90),
    )
    assert workspace_database.ensure_batch(
        user.workspace_id,
        disconnected_store.id,
        "BATCH-PRESERVED",
    )

    client = TestClient(app)
    client.cookies.set("auto_shoper_session", workspace_database.create_session(other_user.id))
    forbidden = client.delete(f"/api/v1/alibaba/stores/{disconnected_store.id}")
    assert forbidden.status_code == 404

    client.cookies.set("auto_shoper_session", workspace_database.create_session(user.id))
    response = client.delete(f"/api/v1/alibaba/stores/{disconnected_store.id}")
    assert response.status_code == 204
    assert workspace_database.get_store(user.workspace_id, disconnected_store.id) is None
    active_store = workspace_database.get_active_store(user.workspace_id)
    assert active_store is not None
    assert active_store.id == fallback_store.id
    assert workspace_database.list_batches(user.workspace_id)[0]["store_connection_id"] == (
        disconnected_store.id
    )

    with sqlite3.connect(workspace_database.settings.database_path) as connection:
        stored = connection.execute(
            """
            SELECT access_token_encrypted, refresh_token_encrypted, disconnected_at
            FROM store_connections WHERE id = ?
            """,
            (disconnected_store.id,),
        ).fetchone()
    assert stored is not None
    assert "token-that-must-be-removed" not in stored[0]
    assert stored[1] is None
    assert stored[2] is not None

    repeated = client.delete(f"/api/v1/alibaba/stores/{disconnected_store.id}")
    assert repeated.status_code == 404

    reconnected_store = workspace_database.upsert_store(
        workspace_id=user.workspace_id,
        provider_user_id="merchant-two",
        login_id="merchant-two@example.com",
        account="merchant-two",
        access_token="new-access-token",
        refresh_token=None,
        expires_at=None,
        refresh_expires_at=None,
    )
    assert reconnected_store.id == disconnected_store.id
    assert reconnected_store.active


def test_existing_sqlite_database_adds_disconnect_marker(tmp_path: Path) -> None:
    database_path = tmp_path / "existing.db"
    old_schema = SQLITE_SCHEMA.replace("    disconnected_at TEXT,\n", "")
    with sqlite3.connect(database_path) as connection:
        connection.executescript(old_schema)

    Database(
        Settings(
            database_path=str(database_path),
            registration_codes="",
            token_encryption_key="test-only-token-encryption-key",
        )
    )

    with sqlite3.connect(database_path) as connection:
        columns = connection.execute("PRAGMA table_info(store_connections)").fetchall()
    assert "disconnected_at" in {str(column[1]) for column in columns}


def test_listing_templates_flags_and_metrics_are_workspace_scoped(
    workspace_database: Database,
) -> None:
    user, _ = workspace_database.register(
        email="listing-owner@example.com",
        password="strong-password",
        display_name="Listing Owner",
        workspace_name="Listing Trading",
        registration_code="CODE-A",
    )
    store = workspace_database.upsert_store(
        workspace_id=user.workspace_id,
        provider_user_id="listing-merchant",
        login_id="listing@example.com",
        account="listing",
        access_token="listing-access-token",
        refresh_token=None,
        expires_at=None,
        refresh_expires_at=None,
    )
    template = workspace_database.create_listing_template(
        workspace_id=user.workspace_id,
        store_connection_id=store.id,
        name="Paint brush defaults",
        category_id="1001",
        fields={"material": "nylon", "origin": "CN"},
    )

    assert (
        workspace_database.list_listing_templates(user.workspace_id, store.id, "1001")[0]["id"]
        == template["id"]
    )
    assert (
        workspace_database.update_listing_template(
            workspace_id=user.workspace_id,
            store_connection_id=store.id,
            template_id=str(template["id"]),
            name="Updated defaults",
            category_id="1001",
            fields={"material": "polyester"},
        )["name"]
        == "Updated defaults"
    )  # type: ignore[index]

    flags = workspace_database.update_listing_feature_flags(
        user.workspace_id,
        {"workflow_v2": False, "unknown": False},
    )
    assert flags["workflow_v2"] is False
    assert flags["legacy_fallback"] is True

    workspace_database.record_listing_metric_event(
        workspace_id=user.workspace_id,
        event_type="draft_failed",
        batch_id="batch-1",
        reference="sku-1",
        reason="gateway timeout",
    )
    workspace_database.record_listing_metric_event(
        workspace_id=user.workspace_id,
        event_type="draft_succeeded",
        batch_id="batch-1",
        reference="sku-1",
        duration_ms=1200,
    )
    workspace_database.record_listing_metric_event(
        workspace_id=user.workspace_id,
        event_type="draft_succeeded",
        batch_id="batch-1",
        reference="sku-2",
        duration_ms=800,
    )
    workspace_database.record_listing_metric_event(
        workspace_id=user.workspace_id,
        event_type="task_evaluated",
        payload={"completed": 6, "confirm": 1, "fill": 2, "invalid": 1},
    )
    workspace_database.record_listing_metric_event(
        workspace_id=user.workspace_id,
        event_type="field_confirmed",
    )
    workspace_database.record_listing_metric_event(
        workspace_id=user.workspace_id,
        event_type="field_edited",
    )
    workspace_database.record_listing_metric_event(
        workspace_id=user.workspace_id,
        event_type="publish_failed",
        reason="invalid field: price",
    )
    metrics = workspace_database.get_listing_metrics(user.workspace_id)
    counters = metrics["counters"]
    assert isinstance(counters, dict)
    assert counters["draft_failed"] == 1
    assert counters["draft_succeeded"] == 2
    assert metrics["failure_reasons"] == {"gateway timeout": 1, "invalid field: price": 1}
    assert metrics["median_draft_duration_ms"] == 1200
    assert metrics["first_pass_draft_rate"] == 0.5
    assert metrics["ai_safe_completion_rate"] == 0.6
    assert metrics["average_manual_field_count"] == 4
    assert metrics["ai_confirmation_edit_rate"] == 0.5
    assert metrics["publish_failure_rate"] == 1
    assert metrics["error_localization_rate"] == 0.5
    assert workspace_database.delete_listing_template(
        user.workspace_id, store.id, str(template["id"])
    )
