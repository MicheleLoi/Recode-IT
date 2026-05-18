"""Tests for /recode/mappings/* + /recode/account/."""

from __future__ import annotations

import base64
import os
import uuid


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode("ascii")


def _mk_blob(size: int = 256) -> bytes:
    return os.urandom(size)


def test_create_and_get_mapping_roundtrip(registered):
    c = registered["client"]
    blob = _mk_blob(128)
    mid = str(uuid.uuid4())
    create = c.post(
        "/recode/mappings/",
        json={"mapping_id": mid, "blob": _b64(blob), "label": "Causa Rossi",
              "doc_type": "txt"},
    )
    assert create.status_code == 201, create.text
    assert create.json()["mapping_id"] == mid
    assert create.json()["size_bytes"] == 128

    got = c.get(f"/recode/mappings/{mid}")
    assert got.status_code == 200
    body = got.json()
    assert body["mapping_id"] == mid
    assert body["label"] == "Causa Rossi"
    assert base64.b64decode(body["blob"]) == blob


def test_list_mappings(registered):
    c = registered["client"]
    ids = []
    for i in range(3):
        mid = str(uuid.uuid4())
        ids.append(mid)
        r = c.post("/recode/mappings/",
                   json={"mapping_id": mid, "blob": _b64(_mk_blob(64)),
                         "label": f"m{i}"})
        assert r.status_code == 201
    lst = c.get("/recode/mappings/")
    assert lst.status_code == 200
    returned_ids = [m["mapping_id"] for m in lst.json()["mappings"]]
    for mid in ids:
        assert mid in returned_ids
    # Listing must not include blob bytes.
    for m in lst.json()["mappings"]:
        assert "blob" not in m


def test_auth_required_on_mappings(client):
    r = client.get("/recode/mappings/")
    assert r.status_code == 401
    r = client.post("/recode/mappings/", json={"mapping_id": "x", "blob": "AA=="})
    assert r.status_code == 401


def test_user_isolation(client):
    # Register user A, create a mapping.
    sa = {"email": "a@a.it", "password": "12345 6789012 secret", "name": "Alice"}
    client.post("/recode/signup", json=sa)
    client.post("/recode/login", json=sa)
    mid = str(uuid.uuid4())
    client.post("/recode/mappings/",
                json={"mapping_id": mid, "blob": _b64(_mk_blob(32))})
    client.post("/recode/logout")
    # Register user B and try to fetch A's mapping.
    sb = {"email": "b@b.it", "password": "12345 6789012 secret", "name": "Bob"}
    client.post("/recode/signup", json=sb)
    client.post("/recode/login", json=sb)
    r = client.get(f"/recode/mappings/{mid}")
    # 404 (not 403) — no oracle whether the id exists for someone else.
    assert r.status_code == 404


def test_delete_mapping(registered):
    c = registered["client"]
    mid = str(uuid.uuid4())
    c.post("/recode/mappings/",
           json={"mapping_id": mid, "blob": _b64(_mk_blob(16))})
    d = c.request("DELETE", f"/recode/mappings/{mid}")
    assert d.status_code == 200
    g = c.get(f"/recode/mappings/{mid}")
    assert g.status_code == 404


def test_bulk_delete_all(registered):
    c = registered["client"]
    for _ in range(3):
        mid = str(uuid.uuid4())
        c.post("/recode/mappings/",
               json={"mapping_id": mid, "blob": _b64(_mk_blob(16))})
    d = c.request("DELETE", "/recode/mappings/", params={"all": "true"})
    assert d.status_code == 200
    assert d.json()["deleted"] >= 3
    lst = c.get("/recode/mappings/")
    assert lst.json()["mappings"] == []


def test_blob_size_limit(registered):
    c = registered["client"]
    # 2 MiB + 1 byte
    huge = b"\x00" * (2 * 1024 * 1024 + 1)
    r = c.post("/recode/mappings/",
               json={"mapping_id": "huge", "blob": _b64(huge)})
    assert r.status_code == 413


def test_false_positive_patch_scoped_to_mapping(registered):
    c = registered["client"]
    mid = str(uuid.uuid4())
    c.post("/recode/mappings/",
           json={"mapping_id": mid, "blob": _b64(_mk_blob(16))})
    patch = c.patch(
        f"/recode/mappings/{mid}/false-positives",
        json={
            "add": [
                {"term": "Metropoli", "category": "luogo"},
                {"term": "Tizio", "category": "persona"},
            ],
            "remove": [],
        },
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["added"] == 2

    listing = c.get("/recode/false-positives/")
    assert listing.status_code == 200
    terms = {(fp["term"], fp["category"]) for fp in listing.json()["false_positives"]}
    assert ("Metropoli", "luogo") in terms
    assert ("Tizio", "persona") in terms


def test_delete_account_cascades(registered):
    c = registered["client"]
    mid = str(uuid.uuid4())
    c.post("/recode/mappings/",
           json={"mapping_id": mid, "blob": _b64(_mk_blob(16))})
    # Missing confirm string.
    r = c.request("DELETE", "/recode/account/",
                  json={"password": "correct horse battery staple"})
    assert r.status_code == 400
    # Correct confirm.
    r = c.request(
        "DELETE", "/recode/account/",
        json={"password": "correct horse battery staple",
              "confirm": "DELETE MY ACCOUNT"},
    )
    assert r.status_code == 200, r.text
    # Subsequent auth-protected calls fail (user gone — middleware still
    # admits the token, but DB lookups return nothing).
    r2 = c.get("/recode/me")
    assert r2.status_code == 404
