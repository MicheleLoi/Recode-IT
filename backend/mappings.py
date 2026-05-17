"""
mappings.py — Recode-IT zero-knowledge mapping endpoints (Phase 3).

Endpoints (all require JWT via RecodeJWTAuthMiddleware):
  POST   /recode/mappings/              create blob
  GET    /recode/mappings/              list user's mappings (no blobs)
  GET    /recode/mappings/{mapping_id}  fetch one blob
  DELETE /recode/mappings/{mapping_id}  hard delete one
  DELETE /recode/mappings/              bulk delete: ?older_than=YYYY-MM-DD or ?all=true
  PATCH  /recode/mappings/{mapping_id}/false-positives
  DELETE /recode/account/               nuclear: delete user + cascade
  GET    /recode/false-positives/       list FP preferences
  POST   /recode/false-positives/       add FP preferences (alternative path
                                        if a user wants to track FPs without
                                        attaching to a specific mapping)

The server's view is intentionally opaque: blobs are stored as raw bytes,
never parsed. Size cap: 2 MiB.

False-positive preferences store ONLY the pseudonymized term (e.g.
"Metropoli"), never the original. The server never sees originals.
"""

from __future__ import annotations

import base64
from datetime import datetime, timezone

from starlette.requests import Request

from .db import connection
from .http_utils import error_response, json_response
from .password import verify_password

MAX_BLOB_BYTES = 2 * 1024 * 1024  # 2 MiB
ACCOUNT_DELETE_CONFIRM = "DELETE MY ACCOUNT"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _user_id_or_401(request: Request):
    uid = getattr(request.state, "user_id", None)
    if not uid:
        return None, error_response("auth_required", "Authentication required.",
                                    status=401, request=request)
    return uid, None


def _b64decode_strict(s: str) -> bytes:
    # Accept urlsafe or standard, padded or not.
    if isinstance(s, bytes):
        s = s.decode("ascii", errors="strict")
    s2 = s.replace("-", "+").replace("_", "/")
    s2 += "=" * (-len(s2) % 4)
    return base64.b64decode(s2, validate=False)


async def create_mapping(request: Request):
    user_id, err = _user_id_or_401(request)
    if err is not None:
        return err
    try:
        payload = await request.json()
    except Exception:
        return error_response("invalid_json", "Request body must be valid JSON.",
                              status=400, request=request)
    if not isinstance(payload, dict):
        return error_response("invalid_payload", "Expected a JSON object.",
                              status=400, request=request)
    mapping_id = str(payload.get("mapping_id", "")).strip()
    blob_b64 = payload.get("blob")
    label = payload.get("label")
    doc_type = payload.get("doc_type")

    if not mapping_id or len(mapping_id) > 128:
        return error_response("invalid_mapping_id",
                              "mapping_id missing or too long (max 128).",
                              status=400, request=request)
    if not isinstance(blob_b64, str) or not blob_b64:
        return error_response("invalid_blob", "blob (base64 string) required.",
                              status=400, request=request)
    try:
        blob = _b64decode_strict(blob_b64)
    except Exception:
        return error_response("invalid_blob", "blob is not valid base64.",
                              status=400, request=request)
    if len(blob) > MAX_BLOB_BYTES:
        return error_response("blob_too_large",
                              f"blob exceeds {MAX_BLOB_BYTES} bytes.",
                              status=413,
                              extra={"max_bytes": MAX_BLOB_BYTES},
                              request=request)

    now = _now_iso()
    with connection() as conn:
        try:
            conn.execute(
                """
                INSERT INTO encrypted_mappings (user_id, mapping_id, blob,
                                                label, doc_type, size_bytes,
                                                created_at, last_accessed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (user_id, mapping_id, blob,
                 (str(label) if label is not None else None),
                 (str(doc_type) if doc_type is not None else None),
                 len(blob), now, now),
            )
        except Exception as exc:
            # UNIQUE (user_id, mapping_id) collision is the realistic case.
            if "UNIQUE" in str(exc).upper():
                return error_response("mapping_exists",
                                      "A mapping with this id already exists.",
                                      status=409, request=request)
            raise

    return json_response(
        {"mapping_id": mapping_id, "created_at": now, "size_bytes": len(blob)},
        status=201, request=request,
    )


async def list_mappings(request: Request):
    user_id, err = _user_id_or_401(request)
    if err is not None:
        return err
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT mapping_id, label, doc_type, size_bytes,
                   created_at, last_accessed_at
            FROM encrypted_mappings
            WHERE user_id = ?
            ORDER BY created_at DESC
            """,
            (user_id,),
        ).fetchall()
    return json_response(
        {
            "mappings": [
                {
                    "mapping_id": r["mapping_id"],
                    "label": r["label"],
                    "doc_type": r["doc_type"],
                    "size_bytes": r["size_bytes"],
                    "created_at": r["created_at"],
                    "last_accessed_at": r["last_accessed_at"],
                }
                for r in rows
            ]
        },
        status=200, request=request,
    )


async def get_mapping(request: Request):
    user_id, err = _user_id_or_401(request)
    if err is not None:
        return err
    mapping_id = request.path_params.get("mapping_id", "")
    with connection() as conn:
        row = conn.execute(
            """
            SELECT mapping_id, blob, label, doc_type, size_bytes,
                   created_at, last_accessed_at
            FROM encrypted_mappings
            WHERE user_id = ? AND mapping_id = ?
            """,
            (user_id, mapping_id),
        ).fetchone()
        if row is None:
            return error_response("mapping_not_found", "Mapping not found.",
                                  status=404, request=request)
        conn.execute(
            "UPDATE encrypted_mappings SET last_accessed_at = ? "
            "WHERE user_id = ? AND mapping_id = ?",
            (_now_iso(), user_id, mapping_id),
        )
    return json_response(
        {
            "mapping_id": row["mapping_id"],
            "blob": base64.b64encode(row["blob"]).decode("ascii"),
            "label": row["label"],
            "doc_type": row["doc_type"],
            "size_bytes": row["size_bytes"],
            "created_at": row["created_at"],
        },
        status=200, request=request,
    )


async def delete_mapping(request: Request):
    user_id, err = _user_id_or_401(request)
    if err is not None:
        return err
    mapping_id = request.path_params.get("mapping_id", "")
    with connection() as conn:
        cur = conn.execute(
            "DELETE FROM encrypted_mappings WHERE user_id = ? AND mapping_id = ?",
            (user_id, mapping_id),
        )
        if cur.rowcount == 0:
            return error_response("mapping_not_found", "Mapping not found.",
                                  status=404, request=request)
    return json_response({"ok": True}, status=200, request=request)


async def delete_mappings_bulk(request: Request):
    user_id, err = _user_id_or_401(request)
    if err is not None:
        return err
    older_than = request.query_params.get("older_than")
    delete_all = request.query_params.get("all", "").lower() in {"1", "true", "yes"}

    if not older_than and not delete_all:
        return error_response(
            "missing_filter",
            "Provide ?older_than=YYYY-MM-DD or ?all=true.",
            status=400, request=request,
        )

    with connection() as conn:
        if delete_all:
            cur = conn.execute(
                "DELETE FROM encrypted_mappings WHERE user_id = ?",
                (user_id,),
            )
        else:
            # accept either YYYY-MM-DD or full ISO timestamp
            cur = conn.execute(
                "DELETE FROM encrypted_mappings "
                "WHERE user_id = ? AND created_at < ?",
                (user_id, older_than),
            )
        deleted = cur.rowcount
    return json_response({"deleted": deleted}, status=200, request=request)


async def delete_account(request: Request):
    user_id, err = _user_id_or_401(request)
    if err is not None:
        return err
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    password = str(payload.get("password", ""))
    confirm = str(payload.get("confirm", ""))

    if confirm != ACCOUNT_DELETE_CONFIRM:
        return error_response(
            "confirm_required",
            f"To delete the account, set confirm to '{ACCOUNT_DELETE_CONFIRM}'.",
            status=400, request=request,
        )

    with connection() as conn:
        row = conn.execute(
            "SELECT password_hash FROM recode_users WHERE id = ?",
            (user_id,),
        ).fetchone()
        if not row:
            return error_response("user_not_found", "User no longer exists.",
                                  status=404, request=request)
        if not verify_password(row["password_hash"], password):
            return error_response(
                "invalid_credentials",
                "Password does not match.",
                status=401, request=request,
            )
        # ON DELETE CASCADE handles the rest of the tables.
        conn.execute("DELETE FROM recode_users WHERE id = ?", (user_id,))
    return json_response({"ok": True, "deleted_user_id": user_id},
                        status=200, request=request)


async def patch_false_positives(request: Request):
    """Add or remove FP entries scoped to a mapping_id.

    Body:
      {
        "add":    [{"term": "Metropoli", "category": "luogo"}, ...],
        "remove": [{"term": "Metropoli", "category": "luogo"}, ...]
      }

    Terms are stored as the PSEUDONYMIZED form (per DESIGN.md §6 schema note)
    plus a free-form category. The server never sees originals.
    """
    user_id, err = _user_id_or_401(request)
    if err is not None:
        return err
    mapping_id = request.path_params.get("mapping_id", "")
    try:
        payload = await request.json()
    except Exception:
        return error_response("invalid_json", "Request body must be valid JSON.",
                              status=400, request=request)
    add = payload.get("add") or []
    remove = payload.get("remove") or []
    if not isinstance(add, list) or not isinstance(remove, list):
        return error_response("invalid_payload", "'add' and 'remove' must be arrays.",
                              status=400, request=request)

    # Verify the mapping belongs to the user (defense in depth — also gives
    # a clear 404 oracle separately from FP state).
    with connection() as conn:
        owns = conn.execute(
            "SELECT 1 FROM encrypted_mappings WHERE user_id = ? AND mapping_id = ?",
            (user_id, mapping_id),
        ).fetchone()
        if not owns:
            return error_response("mapping_not_found", "Mapping not found.",
                                  status=404, request=request)

        now = _now_iso()
        added = 0
        for entry in add:
            term = str(entry.get("term", "")).strip()
            cat = str(entry.get("category", "")).strip()
            if not term or not cat:
                continue
            try:
                conn.execute(
                    """
                    INSERT OR IGNORE INTO user_false_positive_preferences
                        (user_id, term, originally_detected_category, marked_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (user_id, term, cat, now),
                )
                added += 1
            except Exception:
                pass

        removed = 0
        for entry in remove:
            term = str(entry.get("term", "")).strip()
            cat = str(entry.get("category", "")).strip()
            if not term or not cat:
                continue
            cur = conn.execute(
                """
                DELETE FROM user_false_positive_preferences
                WHERE user_id = ? AND term = ? AND originally_detected_category = ?
                """,
                (user_id, term, cat),
            )
            removed += cur.rowcount

    return json_response(
        {"added": added, "removed": removed, "mapping_id": mapping_id},
        status=200, request=request,
    )


async def list_false_positives(request: Request):
    user_id, err = _user_id_or_401(request)
    if err is not None:
        return err
    with connection() as conn:
        rows = conn.execute(
            """
            SELECT term, originally_detected_category, marked_at
            FROM user_false_positive_preferences
            WHERE user_id = ?
            ORDER BY marked_at DESC
            """,
            (user_id,),
        ).fetchall()
    return json_response(
        {
            "false_positives": [
                {
                    "term": r["term"],
                    "category": r["originally_detected_category"],
                    "marked_at": r["marked_at"],
                }
                for r in rows
            ]
        },
        status=200, request=request,
    )


__all__ = [
    "MAX_BLOB_BYTES",
    "ACCOUNT_DELETE_CONFIRM",
    "create_mapping",
    "list_mappings",
    "get_mapping",
    "delete_mapping",
    "delete_mappings_bulk",
    "delete_account",
    "patch_false_positives",
    "list_false_positives",
]
