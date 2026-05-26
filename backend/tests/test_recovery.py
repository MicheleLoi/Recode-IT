"""Tests for the password recovery flow."""

from __future__ import annotations

import base64
import hashlib
import os
import uuid

from backend.db import connect, resolve_db_path


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _grab_reset_token(user_id: str) -> str:
    """Read the most recent unused password_reset token row by user_id, then
    re-derive a token by emulating the server choice. Since the server only
    stores token_hash, we instead invoke initiate_recovery in-process so we
    have the plaintext token. Here we use the email path: trigger initiate,
    then peek the DB row to know which hash was inserted, but we still need
    plaintext — so we monkey by issuing initiate twice and capturing via
    the email stub. Simplest path: patch send_password_reset_email to record
    the token in a module-global. See conftest's monkeypatch use.
    """
    raise NotImplementedError("see test_recovery_full_flow for the capture pattern")


def test_recovery_initiate_is_silent_on_unknown_email(client):
    r = client.post("/recode/recovery/initiate", json={"email": "ghost@ghost.it"})
    # Always 200 — no enumeration oracle.
    assert r.status_code == 200
    assert r.json() == {"ok": True}


def test_recovery_full_flow(client, signup_payload, monkeypatch):
    # 1) Signup.
    s = client.post("/recode/signup", json=signup_payload)
    assert s.status_code == 201
    body = s.json()
    user_id = body["user_id"]
    recovery_code = body["recovery_codes"][0]

    # 2) Save a mapping so we can verify it gets destroyed on reset.
    client.post("/recode/login", json=signup_payload)
    mid = str(uuid.uuid4())
    client.post("/recode/mappings/",
                json={"mapping_id": mid, "blob": _b64(os.urandom(32))})
    client.post("/recode/logout")

    # 3) Patch the email sender to record the plaintext token.
    sent: list[str] = []
    import backend.recovery as recovery_mod

    def fake_send(to_email, token, tier="free"):
        sent.append(token)
        return {"id": "test"}
    monkeypatch.setattr(recovery_mod, "send_password_reset_email", fake_send)

    # 4) Initiate.
    r = client.post("/recode/recovery/initiate",
                    json={"email": signup_payload["email"]})
    assert r.status_code == 200
    assert len(sent) == 1
    token = sent[0]

    # Sanity: token hash matches DB row.
    digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
    conn = connect(resolve_db_path())
    try:
        row = conn.execute(
            "SELECT user_id FROM recode_email_tokens "
            "WHERE token_hash = ? AND purpose = 'password_reset'",
            (digest,),
        ).fetchone()
        assert row is not None
        assert row["user_id"] == user_id
    finally:
        conn.close()

    # 5) Verify the recovery code + reset password.
    new_pw = "Freshly chosen LONG password 99!"
    verify = client.post(
        "/recode/recovery/verify",
        json={"token": token, "recovery_code": recovery_code,
              "new_password": new_pw},
    )
    assert verify.status_code == 200, verify.text
    vbody = verify.json()
    assert vbody["mappings_destroyed"] == 1
    # New kdf_salt MUST differ from the original (zero-knowledge reset).
    assert vbody["kdf_salt"] != body["kdf_salt"]

    # 6) Old password no longer works.
    r = client.post("/recode/login", json=signup_payload)
    assert r.status_code == 401

    # 7) New password works.
    r = client.post("/recode/login",
                    json={"email": signup_payload["email"], "password": new_pw})
    assert r.status_code == 200

    # 8) Replaying the same recovery code fails (one-time).
    sent.clear()
    client.post("/recode/recovery/initiate",
                json={"email": signup_payload["email"]})
    token2 = sent[0]
    r = client.post(
        "/recode/recovery/verify",
        json={"token": token2, "recovery_code": recovery_code,
              "new_password": "Another long passphrase 99!"},
    )
    assert r.status_code == 400
    assert r.json()["error"] == "invalid_recovery_code"


def test_recovery_weak_new_password_rejected(client, signup_payload, monkeypatch):
    client.post("/recode/signup", json=signup_payload)
    sent: list[str] = []
    import backend.recovery as recovery_mod
    monkeypatch.setattr(
        recovery_mod, "send_password_reset_email",
        lambda to_email, token, tier="free": sent.append(token) or {"id": "t"},
    )
    client.post("/recode/recovery/initiate",
                json={"email": signup_payload["email"]})
    r = client.post("/recode/recovery/verify",
                    json={"token": sent[0], "recovery_code": "WHATEVER",
                          "new_password": "short"})
    assert r.status_code == 400
    assert r.json()["error"] == "weak_password"


# ─────────────────────────── tier-aware email body ───────────────────────────
# When RESEND_API_KEY is unset, mailer._send prints the body to stderr (dev
# noop). We capture stderr to assert the Free vs Pro body diverges:
#   - Free → reassuring note ("non vengono toccati"), NO threat string.
#   - Pro  → focused warning ("backup chiave cloud cifrato"), with the
#            scope (cloud blobs only, browser mappings untouched).
# Both bodies must mention the link expiry (RESET_TOKEN_TTL_HOURS).

def _capture_reset_body(capsys, tier: str) -> str:
    from backend.mailer import send_password_reset_email
    send_password_reset_email(to_email="user@example.it", token="t-xyz", tier=tier)
    return capsys.readouterr().err


def test_password_reset_email_free_is_reassuring(capsys, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    body = _capture_reset_body(capsys, tier="free")
    assert "non vengono toccati dal reset" in body
    assert "TUTTI i mapping" not in body
    assert "permanentemente inaccessibili" not in body
    assert "Il link scade fra 24 ore" in body


def test_password_reset_email_pro_warns_about_cloud_blobs(capsys, monkeypatch):
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    body = _capture_reset_body(capsys, tier="pro")
    assert "Pro (backup chiave cloud cifrato)" in body
    assert "mapping cifrati sul cloud" in body
    # The Pro body still reassures about the local browser mappings.
    assert "browser di questo dispositivo non vengono toccati" in body
    assert "Il link scade fra 24 ore" in body


# ─────────────────────── tier-aware verify response message ───────────────────────
# After recovery completes (POST /recode/recovery/verify), the JSON response
# carries a `message` field consumed by the frontend RecoveryPage. Pre-fix it
# was unconditional and claimed "tutti i mapping eliminati" even for tier free
# users (who never had server-side encrypted_mappings to begin with), producing
# contradictory text once concatenated with the frontend `destroyedNote`. The
# message must now branch on mappings_deleted count.
#   - 0  → "L'account non aveva mapping cifrati sul cloud da eliminare. I
#          mapping nel browser di questo dispositivo non vengono toccati dal
#          recovery."
#   - >0 → "i mapping cifrati sul cloud sono stati eliminati ({count})" + the
#          zero-knowledge clarification + browser-untouched reassurance.
# Authority: MHC-Work decision_log 2026-05-26 SID-20260526-011753.

def _initiate_and_capture_token(client, monkeypatch, email: str) -> str:
    """Trigger recovery initiate and capture the plaintext token via mailer
    monkeypatch. Helper to keep verify-response tests focused on message
    content rather than the full flow."""
    sent: list[str] = []
    import backend.recovery as recovery_mod
    monkeypatch.setattr(
        recovery_mod, "send_password_reset_email",
        lambda to_email, token, tier="free": sent.append(token) or {"id": "t"},
    )
    r = client.post("/recode/recovery/initiate", json={"email": email})
    assert r.status_code == 200
    assert len(sent) == 1
    return sent[0]


def test_recovery_verify_message_no_mappings_is_tier_aware(
    client, signup_payload, monkeypatch,
):
    """Free tier path: signup + recover WITHOUT saving any mapping. The
    verify response message must NOT claim mappings were destroyed (none
    existed); must reassure about browser-stored mappings."""
    s = client.post("/recode/signup", json=signup_payload)
    assert s.status_code == 201
    body = s.json()
    recovery_code = body["recovery_codes"][0]

    token = _initiate_and_capture_token(
        client, monkeypatch, signup_payload["email"],
    )

    new_pw = "Freshly chosen LONG password 99!"
    verify = client.post(
        "/recode/recovery/verify",
        json={"token": token, "recovery_code": recovery_code,
              "new_password": new_pw},
    )
    assert verify.status_code == 200, verify.text
    vbody = verify.json()
    assert vbody["mappings_destroyed"] == 0
    msg = vbody["message"]
    # Non-destructive branch wording.
    assert "non aveva mapping cifrati sul cloud" in msg
    assert "non vengono toccati dal recovery" in msg
    # Must NOT carry the legacy unconditional claim.
    assert "tutti i mapping salvati sono stati eliminati" not in msg


def test_recovery_verify_message_with_mappings_declares_count(
    client, signup_payload, monkeypatch,
):
    """Pro-equivalent path: signup + save 1 mapping + recover. The verify
    response message must declare the cloud mappings destroyed and quote
    the count; must also reassure about the local browser mappings."""
    s = client.post("/recode/signup", json=signup_payload)
    assert s.status_code == 201
    body = s.json()
    recovery_code = body["recovery_codes"][0]

    client.post("/recode/login", json=signup_payload)
    mid = str(uuid.uuid4())
    client.post("/recode/mappings/",
                json={"mapping_id": mid, "blob": _b64(os.urandom(32))})
    client.post("/recode/logout")

    token = _initiate_and_capture_token(
        client, monkeypatch, signup_payload["email"],
    )

    new_pw = "Another LONG fresh password 42!"
    verify = client.post(
        "/recode/recovery/verify",
        json={"token": token, "recovery_code": recovery_code,
              "new_password": new_pw},
    )
    assert verify.status_code == 200, verify.text
    vbody = verify.json()
    assert vbody["mappings_destroyed"] == 1
    msg = vbody["message"]
    # Destructive branch wording, with count.
    assert "i mapping cifrati sul cloud sono stati eliminati" in msg
    assert "(1)" in msg
    # Zero-knowledge clarification preserved.
    assert "la nuova chiave non puo' decriptare" in msg
    # Browser-untouched reassurance preserved.
    assert "browser di questo dispositivo non vengono toccati" in msg
