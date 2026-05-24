"""
server.py — Recode-IT Starlette ASGI app (Phase 3).

Wires:
  - /recode/signup            (POST)
  - /recode/login             (POST)
  - /recode/logout            (POST)
  - /recode/me                (GET)             [JWT protected]
  - /recode/recovery/initiate (POST)
  - /recode/recovery/verify   (POST)
  - /recode/mappings/         (GET, POST, DELETE)  [JWT protected]
  - /recode/mappings/{id}     (GET, DELETE)        [JWT protected]
  - /recode/mappings/{id}/false-positives (PATCH)  [JWT protected]
  - /recode/false-positives/  (GET)                [JWT protected]
  - /recode/account/          (DELETE)             [JWT protected]
  - OPTIONS preflight on every route

Designed to be mounted standalone (uvicorn `backend.server:app`) AND to be
mounted under an existing Starlette app via `Mount("/", app=app)` if the
deploy decides to colocate with MHC-L. CORS scoped via RECODE_IT_ALLOWED_ORIGIN.

`db.init_schema()` runs at import time so importing the app from a test
process bootstraps the SQLite schema against the test DB path.
"""

from __future__ import annotations

import os

from slowapi.errors import RateLimitExceeded
from starlette.applications import Starlette
from starlette.routing import Mount, Route

from .db import init_schema
from .email_verification import (
    marketing_consent_endpoint,
    verify_email_endpoint,
)
from .http_utils import options_preflight
from .login import login_endpoint, logout_endpoint, me_endpoint
from .mappings import (
    create_mapping,
    delete_account,
    delete_mapping,
    delete_mappings_bulk,
    get_mapping,
    list_false_positives,
    list_mappings,
    patch_false_positives,
)
from .middleware import RecodeJWTAuthMiddleware
from .pro_invite import (
    admin_approve_endpoint,
    claim_invite_endpoint,
    my_request_endpoint,
    request_invite_endpoint,
)
from .rate_limit import (
    BodyPreloadMiddleware,
    limiter,
    rate_limit_exceeded_handler,
)
from .recovery import initiate_recovery, verify_recovery
from .signup import signup_endpoint
from .stripe_webhook import stripe_webhook_endpoint
from .reverse_substitution import (
    reverse_substitution_claim_checkout_endpoint,
    reverse_substitution_claim_mhc_bearer_endpoint,
    reverse_substitution_permission_endpoint,
)


def _cookie_secure_default() -> bool:
    return os.environ.get("RECODE_IT_COOKIE_SECURE", "1") != "0"


def build_app(
    cookie_secure: bool | None = None,
    *,
    rate_limit_enabled: bool | None = None,
) -> Starlette:
    """Construct the Starlette app. `cookie_secure=False` for local HTTP tests.

    Rate limiting (P1+P2 security review 2026-05-23):
      - Default: enabled. Set RECODE_IT_RATE_LIMIT=0 in env or pass
        rate_limit_enabled=False to disable (used by the per-endpoint
        test suite to avoid 429s on rapid back-to-back requests; the
        dedicated test_rate_limit module re-enables it explicitly).
    """
    init_schema()

    if rate_limit_enabled is None:
        rate_limit_enabled = os.environ.get("RECODE_IT_RATE_LIMIT", "1") != "0"

    routes = [
        # public
        Route("/recode/signup", signup_endpoint, methods=["POST", "OPTIONS"]),
        Route("/recode/login", login_endpoint, methods=["POST", "OPTIONS"]),
        Route("/recode/logout", logout_endpoint, methods=["POST", "OPTIONS"]),
        Route("/recode/recovery/initiate", initiate_recovery,
              methods=["POST", "OPTIONS"]),
        Route("/recode/recovery/verify", verify_recovery,
              methods=["POST", "OPTIONS"]),
        Route("/recode/verify-email/{token}", verify_email_endpoint,
              methods=["GET", "OPTIONS"]),
        # protected
        Route("/recode/me", me_endpoint, methods=["GET", "OPTIONS"]),
        Route("/recode/me/marketing-consent", marketing_consent_endpoint,
              methods=["POST", "DELETE", "OPTIONS"]),
        Route("/recode/mappings/", list_mappings, methods=["GET", "OPTIONS"]),
        Route("/recode/mappings/", create_mapping, methods=["POST"]),
        Route("/recode/mappings/", delete_mappings_bulk, methods=["DELETE"]),
        Route("/recode/mappings/{mapping_id}", get_mapping,
              methods=["GET", "OPTIONS"]),
        Route("/recode/mappings/{mapping_id}", delete_mapping,
              methods=["DELETE"]),
        Route("/recode/mappings/{mapping_id}/false-positives",
              patch_false_positives, methods=["PATCH", "OPTIONS"]),
        Route("/recode/false-positives/", list_false_positives,
              methods=["GET", "OPTIONS"]),
        Route("/recode/account/", delete_account, methods=["DELETE", "OPTIONS"]),
        # Pro invite funnel (Phase 1: gratis su invito via Stripe Payment Link €0/mese).
        Route("/recode/pro/request-invite", request_invite_endpoint,
              methods=["POST", "OPTIONS"]),
        Route("/recode/pro/my-request", my_request_endpoint,
              methods=["GET", "OPTIONS"]),
        Route("/recode/pro/claim-invite", claim_invite_endpoint,
              methods=["POST", "OPTIONS"]),
        Route("/recode/admin/pro/approve", admin_approve_endpoint,
              methods=["POST", "OPTIONS"]),
        # Reverse-substitution add-on (€20 una tantum public OR free via MHC
        # Bearer paste). Pricing pivot ratificato SID-20260524-051552
        # (supersedes the SID-20260523-162500 view-key framing). Vedi
        # backend/reverse_substitution.py.
        Route("/recode/reverse-substitution/permission",
              reverse_substitution_permission_endpoint,
              methods=["GET", "OPTIONS"]),
        Route("/recode/reverse-substitution/claim-mhc-bearer",
              reverse_substitution_claim_mhc_bearer_endpoint,
              methods=["POST", "OPTIONS"]),
        Route("/recode/reverse-substitution/claim-checkout",
              reverse_substitution_claim_checkout_endpoint,
              methods=["POST", "OPTIONS"]),
        # Stripe webhook (bare ASGI handler — signature verified internally).
        Mount("/recode/stripe/webhook", app=stripe_webhook_endpoint),
        # CORS preflight catch-all (Starlette routes by method; OPTIONS above
        # is dispatched per-route, but if a router conflict arises we keep
        # this as a no-op safety).
    ]

    app = Starlette(routes=routes)
    secure = cookie_secure if cookie_secure is not None else _cookie_secure_default()
    app.add_middleware(RecodeJWTAuthMiddleware, cookie_secure=secure)

    # Rate limiter wiring (slowapi). Order matters: BodyPreloadMiddleware
    # must run BEFORE the slowapi decorators trigger (which they do at
    # endpoint call-time), so the body is in request._body when key_func
    # introspects it for per-account keys.
    limiter.enabled = rate_limit_enabled
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
    if rate_limit_enabled:
        app.add_middleware(BodyPreloadMiddleware)

    return app


# Module-level app for `uvicorn backend.server:app`.
app = build_app()


__all__ = ["app", "build_app", "options_preflight"]
