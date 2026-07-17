from __future__ import annotations

import base64
import hashlib
import json
import secrets
import sqlite3
import threading
import uuid
from collections.abc import Mapping, Sequence
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import TracebackType
from typing import Protocol, cast

import pymysql
from cryptography.fernet import Fernet
from pymysql.connections import Connection as MySQLConnection
from pymysql.cursors import Cursor as MySQLCursor
from pymysql.cursors import DictCursor

from backend.app.config import Settings, get_settings


def _now() -> datetime:
    return datetime.now(UTC)


def _iso(value: datetime | None = None) -> str:
    return (value or _now()).isoformat()


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _int_value(value: object) -> int:
    if isinstance(value, int | str | Decimal):
        return int(value)
    raise ValueError("数据库返回了无效整数")


DatabaseRow = sqlite3.Row | Mapping[str, object]

DEFAULT_LISTING_FEATURE_FLAGS: dict[str, bool] = {
    "workflow_v2": True,
    "templates": True,
    "imports": True,
    "metrics": True,
    "legacy_fallback": True,
}


class DatabaseResult(Protocol):
    @property
    def rowcount(self) -> int: ...

    def fetchone(self) -> DatabaseRow | None: ...

    def fetchall(self) -> list[DatabaseRow]: ...


class CursorResult:
    def __init__(self, cursor: sqlite3.Cursor | MySQLCursor) -> None:
        self._cursor = cursor

    @property
    def rowcount(self) -> int:
        return self._cursor.rowcount

    def fetchone(self) -> DatabaseRow | None:
        return cast(DatabaseRow | None, self._cursor.fetchone())

    def fetchall(self) -> list[DatabaseRow]:
        return cast(list[DatabaseRow], self._cursor.fetchall())


class DatabaseConnection:
    def __init__(self, settings: Settings) -> None:
        self.dialect = settings.database_backend
        self._sqlite: sqlite3.Connection | None = None
        self._mysql: MySQLConnection | None = None
        self._in_transaction = False
        if self.dialect == "oceanbase":
            error = settings.oceanbase_configuration_error
            if error:
                raise RuntimeError(error)
            self._mysql = pymysql.connect(
                host=settings.oceanbase_host or "",
                port=settings.oceanbase_port,
                user=settings.oceanbase_user or "",
                password=settings.oceanbase_password or "",
                database=settings.oceanbase_database or "",
                charset="utf8mb4",
                connect_timeout=15,
                read_timeout=30,
                write_timeout=30,
                cursorclass=DictCursor,
                autocommit=False,
            )
            return
        if settings.database_path != ":memory:":
            Path(settings.database_path).expanduser().resolve().parent.mkdir(
                parents=True,
                exist_ok=True,
            )
        self._sqlite = sqlite3.connect(
            settings.database_path,
            check_same_thread=False,
        )
        self._sqlite.row_factory = sqlite3.Row

    def __enter__(self) -> DatabaseConnection:
        if self._mysql is not None:
            self._mysql.ping(reconnect=True)
            self._mysql.begin()
            self._in_transaction = True
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        connection = self._mysql or self._sqlite
        if connection is None:
            return
        try:
            if exc_type is None:
                connection.commit()
            else:
                with suppress(pymysql.Error):
                    connection.rollback()
        finally:
            self._in_transaction = False

    def execute(
        self,
        query: str,
        parameters: Sequence[object] = (),
    ) -> DatabaseResult:
        if self._mysql is not None:
            if not self._in_transaction:
                self._mysql.ping(reconnect=True)
            cursor = self._mysql.cursor()
            cursor.execute(query.replace("?", "%s"), parameters)
            return CursorResult(cursor)
        if self._sqlite is None:
            raise RuntimeError("数据库连接不可用")
        return CursorResult(self._sqlite.execute(query, parameters))

    def executemany(
        self,
        query: str,
        parameters: Sequence[Sequence[object]],
    ) -> DatabaseResult:
        if self._mysql is not None:
            if not self._in_transaction:
                self._mysql.ping(reconnect=True)
            cursor = self._mysql.cursor()
            cursor.executemany(query.replace("?", "%s"), parameters)
            return CursorResult(cursor)
        if self._sqlite is None:
            raise RuntimeError("数据库连接不可用")
        return CursorResult(self._sqlite.executemany(query, parameters))

    def executescript(self, script: str) -> None:
        if self._sqlite is None:
            raise RuntimeError("executescript 仅用于 SQLite")
        self._sqlite.executescript(script)


SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE UNIQUE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS registration_codes (
    code_hash TEXT PRIMARY KEY,
    consumed_at TEXT,
    consumed_by_user_id TEXT REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_states (
    state_hash TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS store_connections (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider_user_id TEXT,
    login_id TEXT,
    account TEXT,
    access_token_encrypted TEXT NOT NULL,
    refresh_token_encrypted TEXT,
    expires_at TEXT,
    refresh_expires_at TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    disconnected_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    last_sync_at TEXT,
    product_count INTEGER,
    product_sync_state TEXT NOT NULL DEFAULT 'pending',
    photobank_group_count INTEGER,
    photobank_sync_state TEXT NOT NULL DEFAULT 'pending',
    product_group_count INTEGER,
    product_group_sync_state TEXT NOT NULL DEFAULT 'not_available',
    permissions_json TEXT NOT NULL DEFAULT '{}',
    sync_error TEXT,
    UNIQUE(workspace_id, provider_user_id)
);
CREATE TABLE IF NOT EXISTS batches (
    id TEXT NOT NULL,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    store_connection_id TEXT NOT NULL REFERENCES store_connections(id),
    status TEXT NOT NULL DEFAULT 'working',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(id, workspace_id)
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_stores_workspace ON store_connections(workspace_id);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);
CREATE INDEX IF NOT EXISTS idx_batches_workspace ON batches(workspace_id);
CREATE TABLE IF NOT EXISTS merchant_assets (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    store_connection_id TEXT NOT NULL REFERENCES store_connections(id) ON DELETE CASCADE,
    company_profile TEXT NOT NULL DEFAULT '',
    after_sales_policy TEXT NOT NULL DEFAULT '',
    customization_policy TEXT NOT NULL DEFAULT '',
    detail_template TEXT NOT NULL DEFAULT '',
    origin TEXT NOT NULL DEFAULT '',
    brand TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (workspace_id, store_connection_id)
);
CREATE TABLE IF NOT EXISTS listing_field_confirmations (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL,
    reference TEXT NOT NULL,
    field_path TEXT NOT NULL,
    value_json TEXT NOT NULL,
    original_source TEXT NOT NULL,
    action TEXT NOT NULL,
    evidence TEXT,
    schema_fingerprint TEXT NOT NULL,
    confirmed_by_user_id TEXT NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_field_confirmations_lookup
    ON listing_field_confirmations(workspace_id, batch_id, reference, field_path, created_at);
CREATE TABLE IF NOT EXISTS listing_draft_snapshots (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL,
    reference TEXT NOT NULL,
    product_id TEXT,
    request_fields_json TEXT NOT NULL,
    platform_response_json TEXT NOT NULL,
    differences_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_draft_snapshots_lookup
    ON listing_draft_snapshots(workspace_id, batch_id, reference, created_at);
CREATE TABLE IF NOT EXISTS listing_templates (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    store_connection_id TEXT NOT NULL REFERENCES store_connections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category_id TEXT,
    fields_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listing_templates_lookup
    ON listing_templates(workspace_id, store_connection_id, category_id, updated_at);
CREATE TABLE IF NOT EXISTS listing_feature_flags (
    workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    flags_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS listing_metric_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    batch_id TEXT,
    reference TEXT,
    duration_ms INTEGER,
    reason TEXT,
    payload_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listing_metric_events_lookup
    ON listing_metric_events(workspace_id, event_type, created_at);
CREATE TABLE IF NOT EXISTS listing_publish_jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    batch_id TEXT NOT NULL,
    reference TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    draft_product_id TEXT,
    published_product_id TEXT,
    status TEXT NOT NULL,
    platform_status TEXT,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    quality_json TEXT NOT NULL,
    error TEXT,
    trace_id TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_checked_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_listing_publish_jobs_lookup
    ON listing_publish_jobs(workspace_id, batch_id, reference, updated_at);
CREATE TABLE IF NOT EXISTS workbench_snapshots (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    store_connection_id TEXT NOT NULL REFERENCES store_connections(id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,
    version INTEGER NOT NULL,
    updated_by_user_id TEXT NOT NULL REFERENCES users(id),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(workspace_id, store_connection_id)
);
CREATE TABLE IF NOT EXISTS listing_operation_audits (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id),
    product_id TEXT NOT NULL,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT NOT NULL,
    error TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_listing_operation_audits_lookup
    ON listing_operation_audits(workspace_id, product_id, created_at);
"""


OCEANBASE_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS workspaces (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        created_at VARCHAR(40) NOT NULL
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS users (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        email VARCHAR(254) NOT NULL,
        display_name VARCHAR(80) NOT NULL,
        password_hash VARCHAR(128) NOT NULL,
        password_salt VARCHAR(32) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        UNIQUE KEY uq_users_email (email),
        KEY idx_users_workspace (workspace_id),
        CONSTRAINT fk_users_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS registration_codes (
        code_hash VARCHAR(64) PRIMARY KEY,
        consumed_at VARCHAR(40),
        consumed_by_user_id VARCHAR(36),
        KEY idx_registration_codes_available (consumed_at),
        CONSTRAINT fk_registration_codes_user FOREIGN KEY (consumed_by_user_id)
            REFERENCES users(id)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        token_hash VARCHAR(64) PRIMARY KEY,
        user_id VARCHAR(36) NOT NULL,
        expires_at VARCHAR(40) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        KEY idx_sessions_user (user_id),
        KEY idx_sessions_expiry (expires_at),
        CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS oauth_states (
        state_hash VARCHAR(64) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        expires_at VARCHAR(40) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        KEY idx_oauth_states_expiry (expires_at),
        KEY idx_oauth_states_workspace (workspace_id),
        CONSTRAINT fk_oauth_states_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_oauth_states_user FOREIGN KEY (user_id)
            REFERENCES users(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS store_connections (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        provider_user_id VARCHAR(255),
        login_id VARCHAR(255),
        account VARCHAR(255),
        access_token_encrypted LONGTEXT NOT NULL,
        refresh_token_encrypted LONGTEXT,
        expires_at VARCHAR(40),
        refresh_expires_at VARCHAR(40),
        active TINYINT(1) NOT NULL DEFAULT 0,
        disconnected_at VARCHAR(40),
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        last_sync_at VARCHAR(40),
        product_count BIGINT,
        product_sync_state VARCHAR(32) NOT NULL DEFAULT 'pending',
        photobank_group_count BIGINT,
        photobank_sync_state VARCHAR(32) NOT NULL DEFAULT 'pending',
        product_group_count BIGINT,
        product_group_sync_state VARCHAR(32) NOT NULL DEFAULT 'not_available',
        permissions_json LONGTEXT NOT NULL,
        sync_error TEXT,
        UNIQUE KEY uq_stores_workspace_provider (workspace_id, provider_user_id),
        KEY idx_stores_workspace (workspace_id),
        CONSTRAINT fk_stores_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS batches (
        id VARCHAR(100) NOT NULL,
        workspace_id VARCHAR(36) NOT NULL,
        store_connection_id VARCHAR(36) NOT NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'working',
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        PRIMARY KEY (id, workspace_id),
        KEY idx_batches_workspace (workspace_id),
        KEY idx_batches_store (store_connection_id),
        CONSTRAINT fk_batches_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_batches_store FOREIGN KEY (store_connection_id)
            REFERENCES store_connections(id)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS merchant_assets (
        workspace_id VARCHAR(36) NOT NULL,
        store_connection_id VARCHAR(36) NOT NULL,
        company_profile TEXT NOT NULL,
        after_sales_policy TEXT NOT NULL,
        customization_policy TEXT NOT NULL,
        detail_template TEXT NOT NULL,
        origin VARCHAR(255) NOT NULL,
        brand VARCHAR(255) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        PRIMARY KEY (workspace_id, store_connection_id),
        CONSTRAINT fk_assets_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_assets_store FOREIGN KEY (store_connection_id)
            REFERENCES store_connections(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS listing_field_confirmations (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        batch_id VARCHAR(100) NOT NULL,
        reference VARCHAR(200) NOT NULL,
        field_path VARCHAR(500) NOT NULL,
        value_json LONGTEXT NOT NULL,
        original_source VARCHAR(32) NOT NULL,
        action VARCHAR(32) NOT NULL,
        evidence TEXT,
        schema_fingerprint VARCHAR(64) NOT NULL,
        confirmed_by_user_id VARCHAR(36) NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        KEY idx_field_confirmations_lookup (
            workspace_id, batch_id, reference, field_path(191), created_at
        ),
        CONSTRAINT fk_field_confirmations_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_field_confirmations_user FOREIGN KEY (confirmed_by_user_id)
            REFERENCES users(id)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS listing_draft_snapshots (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        batch_id VARCHAR(100) NOT NULL,
        reference VARCHAR(200) NOT NULL,
        product_id VARCHAR(255),
        request_fields_json LONGTEXT NOT NULL,
        platform_response_json LONGTEXT NOT NULL,
        differences_json LONGTEXT NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        KEY idx_draft_snapshots_lookup (workspace_id, batch_id, reference, created_at),
        CONSTRAINT fk_draft_snapshots_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS listing_templates (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        store_connection_id VARCHAR(36) NOT NULL,
        name VARCHAR(100) NOT NULL,
        category_id VARCHAR(100),
        fields_json LONGTEXT NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        KEY idx_listing_templates_lookup (
            workspace_id, store_connection_id, category_id, updated_at
        ),
        CONSTRAINT fk_listing_templates_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_listing_templates_store FOREIGN KEY (store_connection_id)
            REFERENCES store_connections(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS listing_feature_flags (
        workspace_id VARCHAR(36) PRIMARY KEY,
        flags_json LONGTEXT NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        CONSTRAINT fk_listing_flags_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS listing_metric_events (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        batch_id VARCHAR(100),
        reference VARCHAR(200),
        duration_ms BIGINT,
        reason TEXT,
        payload_json LONGTEXT NOT NULL,
        created_at VARCHAR(40) NOT NULL,
        KEY idx_listing_metric_events_lookup (workspace_id, event_type, created_at),
        CONSTRAINT fk_listing_metrics_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS listing_publish_jobs (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        batch_id VARCHAR(100) NOT NULL,
        reference VARCHAR(200) NOT NULL,
        idempotency_key VARCHAR(64) NOT NULL,
        draft_product_id VARCHAR(255),
        published_product_id VARCHAR(255),
        status VARCHAR(32) NOT NULL,
        platform_status VARCHAR(255),
        request_json LONGTEXT NOT NULL,
        response_json LONGTEXT NOT NULL,
        quality_json LONGTEXT NOT NULL,
        error TEXT,
        trace_id VARCHAR(255),
        attempt_count INT NOT NULL DEFAULT 0,
        last_checked_at VARCHAR(40),
        created_at VARCHAR(40) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        UNIQUE KEY uq_listing_publish_jobs_key (workspace_id, idempotency_key),
        KEY idx_listing_publish_jobs_lookup (workspace_id, batch_id, reference, updated_at),
        CONSTRAINT fk_listing_publish_jobs_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS workbench_snapshots (
        workspace_id VARCHAR(36) NOT NULL,
        store_connection_id VARCHAR(36) NOT NULL,
        snapshot_json LONGTEXT NOT NULL,
        version INT NOT NULL,
        updated_by_user_id VARCHAR(36) NOT NULL,
        updated_at VARCHAR(40) NOT NULL,
        PRIMARY KEY (workspace_id, store_connection_id),
        CONSTRAINT fk_workbench_snapshots_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_workbench_snapshots_store FOREIGN KEY (store_connection_id)
            REFERENCES store_connections(id) ON DELETE CASCADE,
        CONSTRAINT fk_workbench_snapshots_user FOREIGN KEY (updated_by_user_id)
            REFERENCES users(id)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
    """
    CREATE TABLE IF NOT EXISTS listing_operation_audits (
        id VARCHAR(36) PRIMARY KEY,
        workspace_id VARCHAR(36) NOT NULL,
        user_id VARCHAR(36) NOT NULL,
        product_id VARCHAR(255) NOT NULL,
        operation VARCHAR(64) NOT NULL,
        status VARCHAR(32) NOT NULL,
        request_json LONGTEXT NOT NULL,
        response_json LONGTEXT NOT NULL,
        error TEXT,
        created_at VARCHAR(40) NOT NULL,
        KEY idx_listing_operation_audits_lookup (workspace_id, product_id, created_at),
        CONSTRAINT fk_listing_operation_audits_workspace FOREIGN KEY (workspace_id)
            REFERENCES workspaces(id) ON DELETE CASCADE,
        CONSTRAINT fk_listing_operation_audits_user FOREIGN KEY (user_id)
            REFERENCES users(id)
    ) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
    """,
)


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    workspace_id: str
    email: str
    display_name: str
    workspace_name: str


@dataclass(frozen=True)
class StoreConnection:
    id: str
    workspace_id: str
    provider_user_id: str | None
    login_id: str | None
    account: str | None
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    refresh_expires_at: datetime | None
    active: bool
    created_at: datetime
    updated_at: datetime
    last_sync_at: datetime | None
    product_count: int | None
    product_sync_state: str
    photobank_group_count: int | None
    photobank_sync_state: str
    product_group_count: int | None
    product_group_sync_state: str
    permissions: dict[str, str]
    sync_error: str | None

    @property
    def expired(self) -> bool:
        return bool(self.expires_at and self.expires_at <= _now())


@dataclass(frozen=True)
class MerchantAssets:
    workspace_id: str
    store_connection_id: str
    company_profile: str
    after_sales_policy: str
    customization_policy: str
    detail_template: str
    origin: str
    brand: str
    updated_at: datetime


@dataclass(frozen=True)
class ListingFieldConfirmation:
    id: str
    workspace_id: str
    batch_id: str
    reference: str
    field_path: str
    value: object
    original_source: str
    action: str
    evidence: str | None
    schema_fingerprint: str
    confirmed_by_user_id: str
    created_at: datetime


@dataclass(frozen=True)
class ListingDraftSnapshot:
    id: str
    workspace_id: str
    batch_id: str
    reference: str
    product_id: str | None
    request_fields: dict[str, object]
    platform_response: dict[str, object]
    differences: list[dict[str, object]]
    created_at: datetime


class TokenCipher:
    def __init__(self, key_material: str) -> None:
        key = hashlib.sha256(key_material.encode()).digest()
        self._fernet = Fernet(base64.urlsafe_b64encode(key))

    def encrypt(self, value: str | None) -> str | None:
        if value is None:
            return None
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str | None) -> str | None:
        if value is None:
            return None
        return self._fernet.decrypt(value.encode()).decode()


class Database:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._connection = DatabaseConnection(settings)
        self._lock = threading.RLock()
        self._cipher = (
            TokenCipher(settings.encryption_key_material)
            if settings.encryption_key_material
            else None
        )
        self._initialize()
        self._seed_registration_codes()

    def _initialize(self) -> None:
        with self._lock, self._connection:
            if self._connection.dialect == "oceanbase":
                for statement in OCEANBASE_SCHEMA:
                    self._connection.execute(statement)
                self._ensure_store_connection_schema()
                return
            self._connection.execute("PRAGMA foreign_keys = ON")
            if self.settings.database_path != ":memory:":
                self._connection.execute("PRAGMA journal_mode = WAL")
            self._connection.executescript(SQLITE_SCHEMA)
            self._ensure_store_connection_schema()

    def _ensure_store_connection_schema(self) -> None:
        if self._connection.dialect == "oceanbase":
            column = self._connection.execute(
                "SHOW COLUMNS FROM store_connections LIKE 'disconnected_at'"
            ).fetchone()
            if column is None:
                self._connection.execute(
                    "ALTER TABLE store_connections ADD COLUMN disconnected_at VARCHAR(40)"
                )
            return
        columns = self._connection.execute("PRAGMA table_info(store_connections)").fetchall()
        if not any(str(column["name"]) == "disconnected_at" for column in columns):
            self._connection.execute(
                "ALTER TABLE store_connections ADD COLUMN disconnected_at TEXT"
            )

    def _seed_registration_codes(self) -> None:
        code_hashes = [_hash_secret(code) for code in self.settings.configured_registration_codes]
        self.add_registration_code_hashes(code_hashes)

    def add_registration_code_hashes(self, code_hashes: Sequence[str]) -> int:
        if not code_hashes:
            return 0
        query = (
            "INSERT IGNORE INTO registration_codes(code_hash) VALUES (?)"
            if self._connection.dialect == "oceanbase"
            else "INSERT OR IGNORE INTO registration_codes(code_hash) VALUES (?)"
        )
        inserted = 0
        with self._lock, self._connection:
            for start in range(0, len(code_hashes), 250):
                batch = code_hashes[start : start + 250]
                result = self._connection.executemany(
                    query,
                    [(code_hash,) for code_hash in batch],
                )
                inserted += result.rowcount
        return inserted

    def count_registration_code_hashes(self, code_hashes: Sequence[str]) -> int:
        matched = 0
        with self._lock:
            for start in range(0, len(code_hashes), 500):
                batch = code_hashes[start : start + 500]
                placeholders = ", ".join("?" for _ in batch)
                row = self._connection.execute(
                    f"""
                    SELECT COUNT(*) AS matched
                    FROM registration_codes
                    WHERE code_hash IN ({placeholders})
                    """,
                    batch,
                ).fetchone()
                if row is not None:
                    matched += _int_value(row["matched"])
        return matched

    def has_available_registration_codes(self) -> bool:
        with self._lock:
            row = self._connection.execute(
                "SELECT 1 FROM registration_codes WHERE consumed_at IS NULL LIMIT 1"
            ).fetchone()
        return row is not None

    def registration_code_counts(self) -> tuple[int, int]:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT COUNT(*) AS total,
                    SUM(CASE WHEN consumed_at IS NULL THEN 1 ELSE 0 END) AS available
                FROM registration_codes
                """
            ).fetchone()
        if row is None:
            return 0, 0
        return _int_value(row["total"]), _int_value(row["available"] or 0)

    @staticmethod
    def _password_hash(password: str, salt: bytes) -> str:
        return hashlib.scrypt(
            password.encode(),
            salt=salt,
            n=2**14,
            r=8,
            p=1,
            dklen=64,
        ).hex()

    def register(
        self,
        *,
        email: str,
        password: str,
        display_name: str,
        workspace_name: str,
        registration_code: str,
    ) -> tuple[AuthenticatedUser, str]:
        code_hash = _hash_secret(registration_code.strip())
        user_id = str(uuid.uuid4())
        workspace_id = str(uuid.uuid4())
        salt = secrets.token_bytes(16)
        created_at = _iso()
        normalized_email = email.strip().lower()
        try:
            with self._lock, self._connection:
                existing = self._connection.execute(
                    "SELECT 1 FROM users WHERE email = ?",
                    (normalized_email,),
                ).fetchone()
                if existing is not None:
                    raise ValueError("该邮箱已注册")
                self._connection.execute(
                    "INSERT INTO workspaces(id, name, created_at) VALUES (?, ?, ?)",
                    (workspace_id, workspace_name.strip(), created_at),
                )
                self._connection.execute(
                    """
                    INSERT INTO users(
                        id, workspace_id, email, display_name,
                        password_hash, password_salt, created_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        user_id,
                        workspace_id,
                        normalized_email,
                        display_name.strip(),
                        self._password_hash(password, salt),
                        salt.hex(),
                        created_at,
                    ),
                )
                consumed = self._connection.execute(
                    """
                    UPDATE registration_codes
                    SET consumed_at = ?, consumed_by_user_id = ?
                    WHERE code_hash = ? AND consumed_at IS NULL
                    """,
                    (created_at, user_id, code_hash),
                )
                if consumed.rowcount != 1:
                    raise ValueError("注册码无效或已被使用")
        except (sqlite3.IntegrityError, pymysql.err.IntegrityError) as exc:
            raise ValueError("该邮箱已注册") from exc
        user = AuthenticatedUser(
            id=user_id,
            workspace_id=workspace_id,
            email=normalized_email,
            display_name=display_name.strip(),
            workspace_name=workspace_name.strip(),
        )
        return user, self.create_session(user_id)

    def login(self, email: str, password: str) -> tuple[AuthenticatedUser, str] | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT u.*, w.name AS workspace_name
                FROM users u JOIN workspaces w ON w.id = u.workspace_id
                WHERE u.email = ?
                """,
                (email.strip().lower(),),
            ).fetchone()
        if row is None:
            return None
        salt = bytes.fromhex(str(row["password_salt"]))
        candidate = self._password_hash(password, salt)
        if not secrets.compare_digest(candidate, str(row["password_hash"])):
            return None
        user = self._user_from_row(row)
        return user, self.create_session(user.id)

    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM sessions WHERE expires_at <= ?",
                (_iso(),),
            )
            self._connection.execute(
                """
                INSERT INTO sessions(token_hash, user_id, expires_at, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (
                    _hash_secret(token),
                    user_id,
                    _iso(_now() + timedelta(days=self.settings.session_days)),
                    _iso(),
                ),
            )
        return token

    def get_user_by_session(self, token: str) -> AuthenticatedUser | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT u.*, w.name AS workspace_name
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                JOIN workspaces w ON w.id = u.workspace_id
                WHERE s.token_hash = ? AND s.expires_at > ?
                """,
                (_hash_secret(token), _iso()),
            ).fetchone()
        return self._user_from_row(row) if row is not None else None

    def delete_session(self, token: str) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                "DELETE FROM sessions WHERE token_hash = ?",
                (_hash_secret(token),),
            )

    @staticmethod
    def _user_from_row(row: DatabaseRow) -> AuthenticatedUser:
        return AuthenticatedUser(
            id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            email=str(row["email"]),
            display_name=str(row["display_name"]),
            workspace_name=str(row["workspace_name"]),
        )

    def create_oauth_state(self, user: AuthenticatedUser) -> str:
        state = secrets.token_urlsafe(40)
        with self._lock, self._connection:
            self._connection.execute("DELETE FROM oauth_states WHERE expires_at <= ?", (_iso(),))
            self._connection.execute(
                """
                INSERT INTO oauth_states(
                    state_hash, workspace_id, user_id, expires_at, created_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    _hash_secret(state),
                    user.workspace_id,
                    user.id,
                    _iso(_now() + timedelta(minutes=10)),
                    _iso(),
                ),
            )
        return state

    def consume_oauth_state(self, state: str) -> tuple[str, str] | None:
        with self._lock, self._connection:
            row = self._connection.execute(
                """
                SELECT workspace_id, user_id FROM oauth_states
                WHERE state_hash = ? AND expires_at > ?
                """,
                (_hash_secret(state), _iso()),
            ).fetchone()
            self._connection.execute(
                "DELETE FROM oauth_states WHERE state_hash = ?",
                (_hash_secret(state),),
            )
        if row is None:
            return None
        return str(row["workspace_id"]), str(row["user_id"])

    def upsert_store(
        self,
        *,
        workspace_id: str,
        provider_user_id: str | None,
        login_id: str | None,
        account: str | None,
        access_token: str,
        refresh_token: str | None,
        expires_at: datetime | None,
        refresh_expires_at: datetime | None,
    ) -> StoreConnection:
        if self._cipher is None:
            raise RuntimeError("Alibaba token 加密密钥未配置")
        store_id = str(uuid.uuid4())
        now = _iso()
        identity = provider_user_id or login_id or account
        if not identity:
            identity = f"anonymous-{hashlib.sha256(access_token.encode()).hexdigest()[:16]}"
        with self._lock, self._connection:
            existing = self._connection.execute(
                """
                SELECT id FROM store_connections
                WHERE workspace_id = ? AND provider_user_id = ?
                """,
                (workspace_id, identity),
            ).fetchone()
            if existing is not None:
                store_id = str(existing["id"])
            self._connection.execute(
                """
                UPDATE store_connections SET active = 0
                WHERE workspace_id = ? AND disconnected_at IS NULL
                """,
                (workspace_id,),
            )
            if self._connection.dialect == "oceanbase":
                upsert = """
                    INSERT INTO store_connections(
                        id, workspace_id, provider_user_id, login_id, account,
                        access_token_encrypted, refresh_token_encrypted,
                        expires_at, refresh_expires_at, active, created_at, updated_at,
                        permissions_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                    ON DUPLICATE KEY UPDATE
                        login_id = VALUES(login_id),
                        account = VALUES(account),
                        access_token_encrypted = VALUES(access_token_encrypted),
                        refresh_token_encrypted = VALUES(refresh_token_encrypted),
                        expires_at = VALUES(expires_at),
                        refresh_expires_at = VALUES(refresh_expires_at),
                        active = 1,
                        disconnected_at = NULL,
                        updated_at = VALUES(updated_at)
                """
            else:
                upsert = """
                    INSERT INTO store_connections(
                        id, workspace_id, provider_user_id, login_id, account,
                        access_token_encrypted, refresh_token_encrypted,
                        expires_at, refresh_expires_at, active, created_at, updated_at,
                        permissions_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
                    ON CONFLICT(workspace_id, provider_user_id) DO UPDATE SET
                        login_id = excluded.login_id,
                        account = excluded.account,
                        access_token_encrypted = excluded.access_token_encrypted,
                        refresh_token_encrypted = excluded.refresh_token_encrypted,
                        expires_at = excluded.expires_at,
                        refresh_expires_at = excluded.refresh_expires_at,
                        active = 1,
                        disconnected_at = NULL,
                        updated_at = excluded.updated_at
                """
            self._connection.execute(
                upsert,
                (
                    store_id,
                    workspace_id,
                    identity,
                    login_id,
                    account,
                    self._cipher.encrypt(access_token),
                    self._cipher.encrypt(refresh_token),
                    expires_at.isoformat() if expires_at else None,
                    refresh_expires_at.isoformat() if refresh_expires_at else None,
                    now,
                    now,
                    json.dumps(
                        {
                            "product_read": "pending",
                            "schema_read": "pending",
                            "photobank_read": "pending",
                            "inventory_read": "pending",
                            "draft_write": "pending",
                        }
                    ),
                ),
            )
        store = self.get_store(workspace_id, store_id)
        if store is None:
            raise RuntimeError("Alibaba 店铺保存失败")
        return store

    def list_stores(self, workspace_id: str) -> list[StoreConnection]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM store_connections
                WHERE workspace_id = ? AND disconnected_at IS NULL
                ORDER BY active DESC, updated_at DESC
                """,
                (workspace_id,),
            ).fetchall()
        return [self._store_from_row(row) for row in rows]

    def get_store(self, workspace_id: str, store_id: str) -> StoreConnection | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM store_connections
                WHERE workspace_id = ? AND id = ? AND disconnected_at IS NULL
                """,
                (workspace_id, store_id),
            ).fetchone()
        return self._store_from_row(row) if row is not None else None

    def get_active_store(self, workspace_id: str) -> StoreConnection | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM store_connections
                WHERE workspace_id = ? AND active = 1
                ORDER BY updated_at DESC LIMIT 1
                """,
                (workspace_id,),
            ).fetchone()
        return self._store_from_row(row) if row is not None else None

    def activate_store(self, workspace_id: str, store_id: str) -> StoreConnection | None:
        with self._lock, self._connection:
            exists = self._connection.execute(
                """
                SELECT 1 FROM store_connections
                WHERE workspace_id = ? AND id = ? AND disconnected_at IS NULL
                """,
                (workspace_id, store_id),
            ).fetchone()
            if exists is None:
                return None
            self._connection.execute(
                """
                UPDATE store_connections SET active = 0
                WHERE workspace_id = ? AND disconnected_at IS NULL
                """,
                (workspace_id,),
            )
            self._connection.execute(
                """
                UPDATE store_connections
                SET active = 1, updated_at = ?
                WHERE workspace_id = ? AND id = ?
                """,
                (_iso(), workspace_id, store_id),
            )
        return self.get_store(workspace_id, store_id)

    def disconnect_store(self, workspace_id: str, store_id: str) -> bool:
        if self._cipher is None:
            raise RuntimeError("Alibaba token 加密密钥未配置")
        now = _iso()
        with self._lock, self._connection:
            store = self._connection.execute(
                """
                SELECT active FROM store_connections
                WHERE workspace_id = ? AND id = ? AND disconnected_at IS NULL
                """,
                (workspace_id, store_id),
            ).fetchone()
            if store is None:
                return False
            self._connection.execute(
                """
                UPDATE store_connections SET
                    access_token_encrypted = ?,
                    refresh_token_encrypted = NULL,
                    expires_at = NULL,
                    refresh_expires_at = NULL,
                    active = 0,
                    disconnected_at = ?,
                    updated_at = ?,
                    last_sync_at = NULL,
                    product_count = NULL,
                    product_sync_state = 'pending',
                    photobank_group_count = NULL,
                    photobank_sync_state = 'pending',
                    product_group_count = NULL,
                    product_group_sync_state = 'not_available',
                    permissions_json = '{}',
                    sync_error = NULL
                WHERE workspace_id = ? AND id = ?
                """,
                (self._cipher.encrypt(""), now, now, workspace_id, store_id),
            )
            self._connection.execute(
                """
                DELETE FROM merchant_assets
                WHERE workspace_id = ? AND store_connection_id = ?
                """,
                (workspace_id, store_id),
            )
            if bool(store["active"]):
                next_store = self._connection.execute(
                    """
                    SELECT id FROM store_connections
                    WHERE workspace_id = ? AND disconnected_at IS NULL
                    ORDER BY
                        CASE WHEN expires_at IS NULL OR expires_at > ? THEN 0 ELSE 1 END,
                        updated_at DESC
                    LIMIT 1
                    """,
                    (workspace_id, now),
                ).fetchone()
                if next_store is not None:
                    self._connection.execute(
                        """
                        UPDATE store_connections
                        SET active = 1, updated_at = ?
                        WHERE workspace_id = ? AND id = ?
                        """,
                        (now, workspace_id, str(next_store["id"])),
                    )
        return True

    def update_store_summary(
        self,
        *,
        workspace_id: str,
        store_id: str,
        product_count: int | None,
        product_sync_state: str,
        photobank_group_count: int | None,
        photobank_sync_state: str,
        permissions: dict[str, str],
        sync_error: str | None,
    ) -> StoreConnection:
        with self._lock, self._connection:
            self._connection.execute(
                """
                UPDATE store_connections SET
                    last_sync_at = ?,
                    product_count = ?,
                    product_sync_state = ?,
                    photobank_group_count = ?,
                    photobank_sync_state = ?,
                    product_group_sync_state = 'not_available',
                    permissions_json = ?,
                    sync_error = ?,
                    updated_at = ?
                WHERE workspace_id = ? AND id = ?
                """,
                (
                    _iso(),
                    product_count,
                    product_sync_state,
                    photobank_group_count,
                    photobank_sync_state,
                    json.dumps(permissions),
                    sync_error,
                    _iso(),
                    workspace_id,
                    store_id,
                ),
            )
        store = self.get_store(workspace_id, store_id)
        if store is None:
            raise RuntimeError("Alibaba 店铺不存在")
        return store

    def upsert_merchant_assets(
        self,
        *,
        workspace_id: str,
        store_connection_id: str,
        company_profile: str,
        after_sales_policy: str,
        customization_policy: str,
        detail_template: str,
        origin: str,
        brand: str,
    ) -> MerchantAssets:
        now = _iso()
        values = (
            workspace_id,
            store_connection_id,
            company_profile,
            after_sales_policy,
            customization_policy,
            detail_template,
            origin,
            brand,
            now,
        )
        with self._lock, self._connection:
            query = (
                """
                INSERT INTO merchant_assets(
                    workspace_id, store_connection_id, company_profile,
                    after_sales_policy, customization_policy, detail_template,
                    origin, brand, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    company_profile = VALUES(company_profile),
                    after_sales_policy = VALUES(after_sales_policy),
                    customization_policy = VALUES(customization_policy),
                    detail_template = VALUES(detail_template),
                    origin = VALUES(origin),
                    brand = VALUES(brand),
                    updated_at = VALUES(updated_at)
                """
                if self._connection.dialect == "oceanbase"
                else """
                INSERT INTO merchant_assets(
                    workspace_id, store_connection_id, company_profile,
                    after_sales_policy, customization_policy, detail_template,
                    origin, brand, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(workspace_id, store_connection_id) DO UPDATE SET
                    company_profile = excluded.company_profile,
                    after_sales_policy = excluded.after_sales_policy,
                    customization_policy = excluded.customization_policy,
                    detail_template = excluded.detail_template,
                    origin = excluded.origin,
                    brand = excluded.brand,
                    updated_at = excluded.updated_at
                """
            )
            self._connection.execute(query, values)
        assets = self.get_merchant_assets(workspace_id, store_connection_id)
        if assets is None:
            raise RuntimeError("商家资产保存失败")
        return assets

    def get_merchant_assets(
        self,
        workspace_id: str,
        store_connection_id: str,
    ) -> MerchantAssets | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT workspace_id, store_connection_id, company_profile,
                       after_sales_policy, customization_policy, detail_template,
                       origin, brand, updated_at
                FROM merchant_assets
                WHERE workspace_id = ? AND store_connection_id = ?
                """,
                (workspace_id, store_connection_id),
            ).fetchone()
        if row is None:
            return None
        return MerchantAssets(
            workspace_id=str(row["workspace_id"]),
            store_connection_id=str(row["store_connection_id"]),
            company_profile=str(row["company_profile"]),
            after_sales_policy=str(row["after_sales_policy"]),
            customization_policy=str(row["customization_policy"]),
            detail_template=str(row["detail_template"]),
            origin=str(row["origin"]),
            brand=str(row["brand"]),
            updated_at=datetime.fromisoformat(str(row["updated_at"])),
        )

    def ensure_batch(
        self,
        workspace_id: str,
        store_connection_id: str,
        batch_id: str,
    ) -> bool:
        now = _iso()
        with self._lock, self._connection:
            row = self._connection.execute(
                """
                SELECT store_connection_id
                FROM batches
                WHERE workspace_id = ? AND id = ?
                """,
                (workspace_id, batch_id),
            ).fetchone()
            if row is not None:
                return str(row["store_connection_id"]) == store_connection_id
            store = self._connection.execute(
                """
                SELECT id
                FROM store_connections
                WHERE workspace_id = ? AND id = ? AND disconnected_at IS NULL
                """,
                (workspace_id, store_connection_id),
            ).fetchone()
            if store is None:
                return False
            self._connection.execute(
                """
                INSERT INTO batches(
                    id, workspace_id, store_connection_id, status, created_at, updated_at
                ) VALUES (?, ?, ?, 'working', ?, ?)
                """,
                (batch_id, workspace_id, store_connection_id, now, now),
            )
        return True

    def record_field_confirmation(
        self,
        *,
        workspace_id: str,
        batch_id: str,
        reference: str,
        field_path: str,
        value: object,
        original_source: str,
        action: str,
        evidence: str | None,
        schema_fingerprint: str,
        confirmed_by_user_id: str,
    ) -> ListingFieldConfirmation:
        confirmation = ListingFieldConfirmation(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            batch_id=batch_id,
            reference=reference,
            field_path=field_path,
            value=value,
            original_source=original_source,
            action=action,
            evidence=evidence,
            schema_fingerprint=schema_fingerprint,
            confirmed_by_user_id=confirmed_by_user_id,
            created_at=_now(),
        )
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO listing_field_confirmations(
                    id, workspace_id, batch_id, reference, field_path, value_json,
                    original_source, action, evidence, schema_fingerprint,
                    confirmed_by_user_id, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    confirmation.id,
                    confirmation.workspace_id,
                    confirmation.batch_id,
                    confirmation.reference,
                    confirmation.field_path,
                    json.dumps(confirmation.value, ensure_ascii=False, separators=(",", ":")),
                    confirmation.original_source,
                    confirmation.action,
                    confirmation.evidence,
                    confirmation.schema_fingerprint,
                    confirmation.confirmed_by_user_id,
                    _iso(confirmation.created_at),
                ),
            )
        return confirmation

    def list_field_confirmations(
        self,
        workspace_id: str,
        batch_id: str,
        reference: str,
    ) -> list[ListingFieldConfirmation]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM listing_field_confirmations
                WHERE workspace_id = ? AND batch_id = ? AND reference = ?
                ORDER BY created_at ASC
                """,
                (workspace_id, batch_id, reference),
            ).fetchall()
        return [self._field_confirmation_from_row(row) for row in rows]

    def save_draft_snapshot(
        self,
        *,
        workspace_id: str,
        batch_id: str,
        reference: str,
        product_id: str | None,
        request_fields: dict[str, object],
        platform_response: dict[str, object],
        differences: list[dict[str, object]],
    ) -> ListingDraftSnapshot:
        snapshot = ListingDraftSnapshot(
            id=str(uuid.uuid4()),
            workspace_id=workspace_id,
            batch_id=batch_id,
            reference=reference,
            product_id=product_id,
            request_fields=request_fields,
            platform_response=platform_response,
            differences=differences,
            created_at=_now(),
        )
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO listing_draft_snapshots(
                    id, workspace_id, batch_id, reference, product_id,
                    request_fields_json, platform_response_json, differences_json,
                    created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    snapshot.id,
                    snapshot.workspace_id,
                    snapshot.batch_id,
                    snapshot.reference,
                    snapshot.product_id,
                    json.dumps(snapshot.request_fields, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(
                        snapshot.platform_response, ensure_ascii=False, separators=(",", ":")
                    ),
                    json.dumps(snapshot.differences, ensure_ascii=False, separators=(",", ":")),
                    _iso(snapshot.created_at),
                ),
            )
        return snapshot

    def list_draft_snapshots(
        self,
        workspace_id: str,
        batch_id: str,
    ) -> list[ListingDraftSnapshot]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM listing_draft_snapshots
                WHERE workspace_id = ? AND batch_id = ?
                ORDER BY created_at DESC
                """,
                (workspace_id, batch_id),
            ).fetchall()
        return [self._draft_snapshot_from_row(row) for row in rows]

    def get_publish_job(
        self,
        workspace_id: str,
        idempotency_key: str,
    ) -> dict[str, object] | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM listing_publish_jobs
                WHERE workspace_id = ? AND idempotency_key = ?
                """,
                (workspace_id, idempotency_key),
            ).fetchone()
        return self._publish_job_from_row(row) if row is not None else None

    def list_publish_jobs(self, workspace_id: str, batch_id: str) -> list[dict[str, object]]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT * FROM listing_publish_jobs
                WHERE workspace_id = ? AND batch_id = ?
                ORDER BY created_at ASC
                """,
                (workspace_id, batch_id),
            ).fetchall()
        return [self._publish_job_from_row(row) for row in rows]

    def upsert_publish_job(
        self,
        *,
        workspace_id: str,
        batch_id: str,
        reference: str,
        idempotency_key: str,
        status: str,
        request: dict[str, object],
        draft_product_id: str | None = None,
        published_product_id: str | None = None,
        platform_status: str | None = None,
        response: dict[str, object] | None = None,
        quality: dict[str, object] | None = None,
        error: str | None = None,
        trace_id: str | None = None,
        increment_attempt: bool = False,
        checked: bool = False,
    ) -> dict[str, object]:
        now = _iso()
        existing = self.get_publish_job(workspace_id, idempotency_key)
        with self._lock, self._connection:
            if existing is None:
                self._connection.execute(
                    """
                    INSERT INTO listing_publish_jobs(
                        id, workspace_id, batch_id, reference, idempotency_key,
                        draft_product_id, published_product_id, status, platform_status,
                        request_json, response_json, quality_json, error, trace_id,
                        attempt_count, last_checked_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()), workspace_id, batch_id, reference, idempotency_key,
                        draft_product_id, published_product_id, status, platform_status,
                        json.dumps(request, ensure_ascii=False, separators=(",", ":")),
                        json.dumps(response or {}, ensure_ascii=False, separators=(",", ":")),
                        json.dumps(quality or {}, ensure_ascii=False, separators=(",", ":")),
                        error, trace_id, 1 if increment_attempt else 0,
                        now if checked else None, now, now,
                    ),
                )
            else:
                self._connection.execute(
                    """
                    UPDATE listing_publish_jobs SET
                        draft_product_id = ?, published_product_id = ?, status = ?,
                        platform_status = ?, request_json = ?, response_json = ?,
                        quality_json = ?, error = ?, trace_id = ?,
                        attempt_count = attempt_count + ?, last_checked_at = ?, updated_at = ?
                    WHERE workspace_id = ? AND idempotency_key = ?
                    """,
                    (
                        draft_product_id or existing.get("draft_product_id"),
                        published_product_id or existing.get("published_product_id"),
                        status, platform_status,
                        json.dumps(request, ensure_ascii=False, separators=(",", ":")),
                        json.dumps(response if response is not None else existing.get("response", {}), ensure_ascii=False, separators=(",", ":")),
                        json.dumps(quality if quality is not None else existing.get("quality", {}), ensure_ascii=False, separators=(",", ":")),
                        error, trace_id or existing.get("trace_id"),
                        1 if increment_attempt else 0,
                        now if checked else existing.get("last_checked_at"), now,
                        workspace_id, idempotency_key,
                    ),
                )
        saved = self.get_publish_job(workspace_id, idempotency_key)
        if saved is None:
            raise RuntimeError("发布任务保存失败")
        return saved

    def save_workbench_snapshot(
        self,
        *,
        workspace_id: str,
        store_connection_id: str,
        snapshot: dict[str, object],
        version: int,
        user_id: str,
    ) -> dict[str, object]:
        now = _iso()
        query = (
            """
            INSERT INTO workbench_snapshots(
                workspace_id, store_connection_id, snapshot_json, version,
                updated_by_user_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE snapshot_json = VALUES(snapshot_json),
                version = VALUES(version), updated_by_user_id = VALUES(updated_by_user_id),
                updated_at = VALUES(updated_at)
            """
            if self._connection.dialect == "oceanbase"
            else """
            INSERT INTO workbench_snapshots(
                workspace_id, store_connection_id, snapshot_json, version,
                updated_by_user_id, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(workspace_id, store_connection_id) DO UPDATE SET
                snapshot_json = excluded.snapshot_json, version = excluded.version,
                updated_by_user_id = excluded.updated_by_user_id, updated_at = excluded.updated_at
            """
        )
        with self._lock, self._connection:
            self._connection.execute(
                query,
                (workspace_id, store_connection_id, json.dumps(snapshot, ensure_ascii=False, separators=(",", ":")), version, user_id, now),
            )
        return {"snapshot": snapshot, "version": version, "updated_at": now}

    def get_workbench_snapshot(
        self,
        workspace_id: str,
        store_connection_id: str,
    ) -> dict[str, object] | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT snapshot_json, version, updated_at FROM workbench_snapshots
                WHERE workspace_id = ? AND store_connection_id = ?
                """,
                (workspace_id, store_connection_id),
            ).fetchone()
        if row is None:
            return None
        value = json.loads(str(row["snapshot_json"]))
        return {
            "snapshot": value if isinstance(value, dict) else {},
            "version": _int_value(row["version"]),
            "updated_at": str(row["updated_at"]),
        }

    def record_operation_audit(
        self,
        *,
        workspace_id: str,
        user_id: str,
        product_id: str,
        operation: str,
        status: str,
        request: dict[str, object],
        response: dict[str, object] | None = None,
        error: str | None = None,
    ) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO listing_operation_audits(
                    id, workspace_id, user_id, product_id, operation, status,
                    request_json, response_json, error, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()), workspace_id, user_id, product_id, operation, status,
                    json.dumps(request, ensure_ascii=False, separators=(",", ":")),
                    json.dumps(response or {}, ensure_ascii=False, separators=(",", ":")),
                    error, _iso(),
                ),
            )

    def create_listing_template(
        self,
        *,
        workspace_id: str,
        store_connection_id: str,
        name: str,
        category_id: str | None,
        fields: dict[str, object],
    ) -> dict[str, object]:
        template_id = str(uuid.uuid4())
        now = _iso()
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO listing_templates(
                    id, workspace_id, store_connection_id, name, category_id,
                    fields_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    template_id,
                    workspace_id,
                    store_connection_id,
                    name,
                    category_id,
                    json.dumps(fields, ensure_ascii=False, separators=(",", ":")),
                    now,
                    now,
                ),
            )
        return {
            "id": template_id,
            "store_connection_id": store_connection_id,
            "name": name,
            "category_id": category_id,
            "fields": fields,
            "created_at": now,
            "updated_at": now,
        }

    def list_listing_templates(
        self,
        workspace_id: str,
        store_connection_id: str,
        category_id: str | None = None,
    ) -> list[dict[str, object]]:
        query = """
            SELECT * FROM listing_templates
            WHERE workspace_id = ? AND store_connection_id = ?
        """
        parameters: tuple[object, ...] = (workspace_id, store_connection_id)
        if category_id:
            query += " AND (category_id = ? OR category_id IS NULL)"
            parameters += (category_id,)
        query += " ORDER BY updated_at DESC"
        with self._lock:
            rows = self._connection.execute(query, parameters).fetchall()
        return [self._listing_template_from_row(row) for row in rows]

    def get_listing_template(
        self,
        workspace_id: str,
        store_connection_id: str,
        template_id: str,
    ) -> dict[str, object] | None:
        with self._lock:
            row = self._connection.execute(
                """
                SELECT * FROM listing_templates
                WHERE id = ? AND workspace_id = ? AND store_connection_id = ?
                """,
                (template_id, workspace_id, store_connection_id),
            ).fetchone()
        return self._listing_template_from_row(row) if row is not None else None

    def update_listing_template(
        self,
        *,
        workspace_id: str,
        store_connection_id: str,
        template_id: str,
        name: str,
        category_id: str | None,
        fields: dict[str, object],
    ) -> dict[str, object] | None:
        now = _iso()
        with self._lock, self._connection:
            result = self._connection.execute(
                """
                UPDATE listing_templates
                SET name = ?, category_id = ?, fields_json = ?, updated_at = ?
                WHERE id = ? AND workspace_id = ? AND store_connection_id = ?
                """,
                (
                    name,
                    category_id,
                    json.dumps(fields, ensure_ascii=False, separators=(",", ":")),
                    now,
                    template_id,
                    workspace_id,
                    store_connection_id,
                ),
            )
        if result.rowcount == 0:
            return None
        return self.get_listing_template(workspace_id, store_connection_id, template_id)

    def delete_listing_template(
        self,
        workspace_id: str,
        store_connection_id: str,
        template_id: str,
    ) -> bool:
        with self._lock, self._connection:
            result = self._connection.execute(
                """
                DELETE FROM listing_templates
                WHERE id = ? AND workspace_id = ? AND store_connection_id = ?
                """,
                (template_id, workspace_id, store_connection_id),
            )
        return result.rowcount > 0

    def get_listing_feature_flags(self, workspace_id: str) -> dict[str, bool]:
        with self._lock:
            row = self._connection.execute(
                "SELECT flags_json FROM listing_feature_flags WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchone()
        if row is None:
            return dict(DEFAULT_LISTING_FEATURE_FLAGS)
        raw = json.loads(str(row["flags_json"]))
        return {
            key: bool(raw.get(key, default)) if isinstance(raw, dict) else default
            for key, default in DEFAULT_LISTING_FEATURE_FLAGS.items()
        }

    def update_listing_feature_flags(
        self,
        workspace_id: str,
        updates: Mapping[str, bool],
    ) -> dict[str, bool]:
        flags = self.get_listing_feature_flags(workspace_id)
        flags.update({key: bool(value) for key, value in updates.items() if key in flags})
        now = _iso()
        serialized = json.dumps(flags, separators=(",", ":"))
        with self._lock, self._connection:
            existing = self._connection.execute(
                "SELECT workspace_id FROM listing_feature_flags WHERE workspace_id = ?",
                (workspace_id,),
            ).fetchone()
            if existing is None:
                self._connection.execute(
                    """
                    INSERT INTO listing_feature_flags(workspace_id, flags_json, updated_at)
                    VALUES (?, ?, ?)
                    """,
                    (workspace_id, serialized, now),
                )
            else:
                self._connection.execute(
                    """
                    UPDATE listing_feature_flags SET flags_json = ?, updated_at = ?
                    WHERE workspace_id = ?
                    """,
                    (serialized, now, workspace_id),
                )
        return flags

    def record_listing_metric_event(
        self,
        *,
        workspace_id: str,
        event_type: str,
        batch_id: str | None = None,
        reference: str | None = None,
        duration_ms: int | None = None,
        reason: str | None = None,
        payload: Mapping[str, object] | None = None,
    ) -> None:
        with self._lock, self._connection:
            self._connection.execute(
                """
                INSERT INTO listing_metric_events(
                    id, workspace_id, event_type, batch_id, reference,
                    duration_ms, reason, payload_json, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    workspace_id,
                    event_type,
                    batch_id,
                    reference,
                    duration_ms,
                    reason,
                    json.dumps(payload or {}, ensure_ascii=False, separators=(",", ":")),
                    _iso(),
                ),
            )

    def get_listing_metrics(self, workspace_id: str) -> dict[str, object]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT event_type, batch_id, reference, duration_ms, reason,
                       payload_json, created_at
                FROM listing_metric_events
                WHERE workspace_id = ? ORDER BY created_at ASC
                """,
                (workspace_id,),
            ).fetchall()
        counters: dict[str, int] = {}
        reasons: dict[str, int] = {}
        durations: list[int] = []
        draft_attempts: dict[tuple[str, str], list[str]] = {}
        upload_started_at: dict[tuple[str, str], datetime] = {}
        evaluated_products = 0
        evaluated_tasks = 0
        completed_tasks = 0
        manual_tasks = 0
        failure_events = 0
        localized_failures = 0
        for row in rows:
            event_type = str(row["event_type"])
            batch_id = str(row["batch_id"] or "")
            reference = str(row["reference"] or "")
            key = (batch_id, reference)
            counters[event_type] = counters.get(event_type, 0) + 1
            if row["reason"]:
                reason = str(row["reason"])
                reasons[reason] = reasons.get(reason, 0) + 1
            if event_type == "upload_started":
                upload_started_at.setdefault(key, datetime.fromisoformat(str(row["created_at"])))
            if event_type == "draft_succeeded":
                if key in upload_started_at:
                    finished = datetime.fromisoformat(str(row["created_at"]))
                    durations.append(
                        round((finished - upload_started_at[key]).total_seconds() * 1000)
                    )
                elif row["duration_ms"] is not None:
                    durations.append(_int_value(row["duration_ms"]))
            if event_type in {"draft_succeeded", "draft_failed"}:
                draft_attempts.setdefault(key, []).append(event_type)
            if event_type == "task_evaluated":
                payload = json.loads(str(row["payload_json"]))
                if isinstance(payload, dict):
                    completed = int(payload.get("completed", 0))
                    confirm = int(payload.get("confirm", 0))
                    fill = int(payload.get("fill", 0))
                    invalid = int(payload.get("invalid", 0))
                    evaluated_products += 1
                    completed_tasks += completed
                    manual_tasks += confirm + fill + invalid
                    evaluated_tasks += completed + confirm + fill + invalid
            if event_type in {"analysis_failed", "draft_failed", "publish_failed"}:
                failure_events += 1
                reason = str(row["reason"] or "").lower()
                if any(
                    marker in reason
                    for marker in ("field", "missing", "invalid", "schema", "字段", "必填")
                ):
                    localized_failures += 1
        durations.sort()
        median = durations[len(durations) // 2] if durations else None
        first_pass = sum(events[0] == "draft_succeeded" for events in draft_attempts.values())
        rate = first_pass / len(draft_attempts) if draft_attempts else None
        confirmation_total = counters.get("field_confirmed", 0) + counters.get("field_edited", 0)
        publish_total = counters.get("publish_succeeded", 0) + counters.get("publish_failed", 0)
        return {
            "total_events": len(rows),
            "counters": counters,
            "failure_reasons": reasons,
            "median_draft_duration_ms": median,
            "first_pass_draft_rate": rate,
            "ai_safe_completion_rate": (
                completed_tasks / evaluated_tasks if evaluated_tasks else None
            ),
            "average_manual_field_count": (
                manual_tasks / evaluated_products if evaluated_products else None
            ),
            "ai_confirmation_edit_rate": (
                counters.get("field_edited", 0) / confirmation_total if confirmation_total else None
            ),
            "publish_failure_rate": (
                counters.get("publish_failed", 0) / publish_total if publish_total else None
            ),
            "error_localization_rate": (
                localized_failures / failure_events if failure_events else None
            ),
        }

    @staticmethod
    def _listing_template_from_row(row: DatabaseRow) -> dict[str, object]:
        fields = json.loads(str(row["fields_json"]))
        return {
            "id": str(row["id"]),
            "store_connection_id": str(row["store_connection_id"]),
            "name": str(row["name"]),
            "category_id": str(row["category_id"]) if row["category_id"] else None,
            "fields": fields if isinstance(fields, dict) else {},
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }

    @staticmethod
    def _field_confirmation_from_row(row: DatabaseRow) -> ListingFieldConfirmation:
        return ListingFieldConfirmation(
            id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            batch_id=str(row["batch_id"]),
            reference=str(row["reference"]),
            field_path=str(row["field_path"]),
            value=json.loads(str(row["value_json"])),
            original_source=str(row["original_source"]),
            action=str(row["action"]),
            evidence=str(row["evidence"]) if row["evidence"] else None,
            schema_fingerprint=str(row["schema_fingerprint"]),
            confirmed_by_user_id=str(row["confirmed_by_user_id"]),
            created_at=datetime.fromisoformat(str(row["created_at"])),
        )

    @staticmethod
    def _draft_snapshot_from_row(row: DatabaseRow) -> ListingDraftSnapshot:
        return ListingDraftSnapshot(
            id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            batch_id=str(row["batch_id"]),
            reference=str(row["reference"]),
            product_id=str(row["product_id"]) if row["product_id"] else None,
            request_fields=json.loads(str(row["request_fields_json"])),
            platform_response=json.loads(str(row["platform_response_json"])),
            differences=json.loads(str(row["differences_json"])),
            created_at=datetime.fromisoformat(str(row["created_at"])),
        )

    @staticmethod
    def _publish_job_from_row(row: DatabaseRow) -> dict[str, object]:
        return {
            "id": str(row["id"]),
            "batch_id": str(row["batch_id"]),
            "reference": str(row["reference"]),
            "idempotency_key": str(row["idempotency_key"]),
            "draft_product_id": str(row["draft_product_id"]) if row["draft_product_id"] else None,
            "published_product_id": str(row["published_product_id"]) if row["published_product_id"] else None,
            "status": str(row["status"]),
            "platform_status": str(row["platform_status"]) if row["platform_status"] else None,
            "request": json.loads(str(row["request_json"])),
            "response": json.loads(str(row["response_json"])),
            "quality": json.loads(str(row["quality_json"])),
            "error": str(row["error"]) if row["error"] else None,
            "trace_id": str(row["trace_id"]) if row["trace_id"] else None,
            "attempt_count": _int_value(row["attempt_count"]),
            "last_checked_at": str(row["last_checked_at"]) if row["last_checked_at"] else None,
            "created_at": str(row["created_at"]),
            "updated_at": str(row["updated_at"]),
        }

    def list_batches(self, workspace_id: str) -> list[dict[str, str]]:
        with self._lock:
            rows = self._connection.execute(
                """
                SELECT id, store_connection_id, status, created_at, updated_at
                FROM batches
                WHERE workspace_id = ?
                ORDER BY created_at DESC
                """,
                (workspace_id,),
            ).fetchall()
        return [
            {
                "id": str(row["id"]),
                "store_connection_id": str(row["store_connection_id"]),
                "status": str(row["status"]),
                "created_at": str(row["created_at"]),
                "updated_at": str(row["updated_at"]),
            }
            for row in rows
        ]

    def _store_from_row(self, row: DatabaseRow) -> StoreConnection:
        if self._cipher is None:
            raise RuntimeError("Alibaba token 加密密钥未配置")
        permissions_raw = json.loads(str(row["permissions_json"]))
        permissions = {
            str(key): str(value)
            for key, value in permissions_raw.items()
            if isinstance(key, str) and isinstance(value, str)
        }
        return StoreConnection(
            id=str(row["id"]),
            workspace_id=str(row["workspace_id"]),
            provider_user_id=str(row["provider_user_id"]) if row["provider_user_id"] else None,
            login_id=str(row["login_id"]) if row["login_id"] else None,
            account=str(row["account"]) if row["account"] else None,
            access_token=self._cipher.decrypt(str(row["access_token_encrypted"])) or "",
            refresh_token=self._cipher.decrypt(
                str(row["refresh_token_encrypted"]) if row["refresh_token_encrypted"] else None
            ),
            expires_at=datetime.fromisoformat(str(row["expires_at"]))
            if row["expires_at"]
            else None,
            refresh_expires_at=datetime.fromisoformat(str(row["refresh_expires_at"]))
            if row["refresh_expires_at"]
            else None,
            active=bool(row["active"]),
            created_at=datetime.fromisoformat(str(row["created_at"])),
            updated_at=datetime.fromisoformat(str(row["updated_at"])),
            last_sync_at=datetime.fromisoformat(str(row["last_sync_at"]))
            if row["last_sync_at"]
            else None,
            product_count=_int_value(row["product_count"])
            if row["product_count"] is not None
            else None,
            product_sync_state=str(row["product_sync_state"]),
            photobank_group_count=_int_value(row["photobank_group_count"])
            if row["photobank_group_count"] is not None
            else None,
            photobank_sync_state=str(row["photobank_sync_state"]),
            product_group_count=_int_value(row["product_group_count"])
            if row["product_group_count"] is not None
            else None,
            product_group_sync_state=str(row["product_group_sync_state"]),
            permissions=permissions,
            sync_error=str(row["sync_error"]) if row["sync_error"] else None,
        )


_database: Database | None = None


def get_database() -> Database:
    global _database
    if _database is None:
        _database = Database(get_settings())
    return _database


def set_database(database: Database | None) -> None:
    global _database
    _database = database
