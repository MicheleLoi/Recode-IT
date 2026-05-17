"""
email.py — Recode-IT email send helpers (Phase 3).

Mirrors MHC-L `mcp_server/webhook_handler.py::_send_key_email` + `_email_body`
pattern for Resend. Two flows:

  - send_verification_email(email, token)
  - send_password_reset_email(email, token)

In environments where RESEND_API_KEY is unset (tests, local dev) the send
is a no-op that prints the body to stderr. This keeps the auth flow
testable end-to-end without faking SMTP.
"""

from __future__ import annotations

import os
import sys
from typing import Any

ENV_RESEND_API_KEY = "RESEND_API_KEY"
ENV_BASE_URL = "RECODE_IT_BASE_URL"

DEFAULT_BASE_URL = "https://recode.micheleloi.pro"
EMAIL_FROM = "Recode-IT <recode@micheleloi.pro>"


def _base_url() -> str:
    return os.environ.get(ENV_BASE_URL, DEFAULT_BASE_URL).rstrip("/")


def _send(to_email: str, subject: str, body: str) -> dict[str, Any]:
    api_key = os.environ.get(ENV_RESEND_API_KEY)
    if not api_key:
        print(
            f"[email:dev] TO={to_email!r} SUBJECT={subject!r}\n{body}\n",
            file=sys.stderr,
            flush=True,
        )
        return {"id": "dev-noop"}
    import resend  # type: ignore  # imported lazily so tests don't require the SDK
    resend.api_key = api_key
    return resend.Emails.send(
        {
            "from": EMAIL_FROM,
            "to": [to_email],
            "subject": subject,
            "text": body,
        }
    )


def send_verification_email(to_email: str, token: str) -> dict[str, Any]:
    link = f"{_base_url()}/recode/verify-email/{token}"
    body = (
        "Ciao,\n\n"
        "Per confermare l'indirizzo email del tuo account Recode-IT, apri "
        "questo link:\n\n"
        f"  {link}\n\n"
        "Il link scade in 24 ore. Se non hai richiesto la registrazione, "
        "ignora questa email.\n\n"
        "Michele Loi\nmhcl@micheleloi.pro\n"
    )
    return _send(to_email, "Conferma il tuo indirizzo email — Recode-IT", body)


def send_password_reset_email(to_email: str, token: str) -> dict[str, Any]:
    link = f"{_base_url()}/recode/recovery/reset?token={token}"
    body = (
        "Ciao,\n\n"
        "Hai richiesto il reset della password per Recode-IT. Per procedere "
        "ti serviranno: (a) questo link, (b) uno dei tuoi 10 codici di "
        "recupero (stampati al momento dell'iscrizione).\n\n"
        f"  {link}\n\n"
        "ATTENZIONE: dopo il reset, TUTTI i mapping salvati saranno "
        "permanentemente inaccessibili (il server non puo' decriptarli senza "
        "la vecchia password). Questa e' una conseguenza della nostra "
        "architettura zero-knowledge.\n\n"
        "Se non hai richiesto il reset, ignora questa email — il tuo account "
        "resta intatto.\n\n"
        "Michele Loi\nmhcl@micheleloi.pro\n"
    )
    return _send(to_email, "Reset password — Recode-IT", body)


__all__ = [
    "ENV_RESEND_API_KEY",
    "ENV_BASE_URL",
    "DEFAULT_BASE_URL",
    "EMAIL_FROM",
    "send_verification_email",
    "send_password_reset_email",
]
