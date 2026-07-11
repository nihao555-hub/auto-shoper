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
                return
            self._connection.execute("PRAGMA foreign_keys = ON")
            if self.settings.database_path != ":memory:":
                self._connection.execute("PRAGMA journal_mode = WAL")
            self._connection.executescript(SQLITE_SCHEMA)

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
                "UPDATE store_connections SET active = 0 WHERE workspace_id = ?",
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
                WHERE workspace_id = ?
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
                WHERE workspace_id = ? AND id = ?
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
                WHERE workspace_id = ? AND id = ?
                """,
                (workspace_id, store_id),
            ).fetchone()
            if exists is None:
                return None
            self._connection.execute(
                "UPDATE store_connections SET active = 0 WHERE workspace_id = ?",
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
                WHERE workspace_id = ? AND id = ?
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
                str(row["refresh_token_encrypted"])
                if row["refresh_token_encrypted"]
                else None
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
