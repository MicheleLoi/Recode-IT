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

# Defined locally (not imported from backend.recovery) to avoid a circular
# import: backend.recovery imports send_password_reset_email from this
# module. Keep this constant in lock-step with backend.recovery's value.
RESET_TOKEN_TTL_HOURS = 24


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


def send_invite_request_received_email(to_email: str, name: str) -> dict[str, Any]:
    """Notifica all'utente che la richiesta di accesso pro è stata ricevuta.

    Inviata immediatamente dopo POST /recode/pro/request-invite. Body in
    italiano, tono conciso e umano (founder = Michele Loi).
    """
    saluto = f"Ciao {name}" if name else "Ciao"
    body = (
        f"{saluto},\n\n"
        "abbiamo ricevuto la tua richiesta di accesso al piano pro di "
        "Recode IT. Ti contatteremo a breve via email con la nostra "
        "risposta.\n\n"
        "In Phase 1 il piano pro è gratuito su invito: nessun pagamento "
        "richiesto, nessuna carta da inserire.\n\n"
        "A presto,\n"
        "Michele Loi\nmhcl@micheleloi.pro\n"
    )
    return _send(to_email, "Richiesta piano pro ricevuta — Recode IT", body)


def send_invite_approved_email(
    to_email: str, name: str, token: str, expires_at: str,
) -> dict[str, Any]:
    """Notifica all'utente che l'invito è stato approvato.

    Link al claim flow + scadenza + warning single-use.
    """
    link = f"{_base_url()}/upgrade?t={token}"
    saluto = f"Ciao {name}" if name else "Ciao"
    body = (
        f"{saluto},\n\n"
        "il tuo invito al piano pro di Recode IT è stato approvato. "
        "Per attivare l'upgrade clicca questo link:\n\n"
        f"  {link}\n\n"
        f"Il link scade il {expires_at} (7 giorni). È valido una sola volta.\n\n"
        "Il checkout passa da Stripe ma NON ti verrà richiesta nessuna "
        "carta: in Phase 1 il piano pro è gratuito su invito (€0/mese in "
        "abbonamento Stripe, nessun pagamento eseguito). Stripe ci serve "
        "solo per gestire l'eventuale transizione futura al pricing "
        "€25 una tantum, senza dover migrare account.\n\n"
        "A presto,\n"
        "Michele Loi\nmhcl@micheleloi.pro\n"
    )
    return _send(to_email, "Invito al piano pro approvato — Recode IT", body)


def send_password_reset_email(
    to_email: str, token: str, tier: str = "free",
) -> dict[str, Any]:
    """Send the password reset email. Body is tier-aware: Free users get a
    reassuring note ("account + browser mappings untouched"); Pro users get
    a focused warning about the cloud-encrypted backup being rotated
    (kdf_salt changes → existing encrypted blobs become undecryptable).

    Default tier='free' keeps the function safe to call in tests or other
    callers that don't pass the param.
    """
    link = f"{_base_url()}/recode/recovery/reset?token={token}"

    if tier == "pro":
        mapping_note = (
            "ATTENZIONE: come utente Pro (backup chiave cloud cifrato), il "
            "reset della password elimina definitivamente i mapping cifrati "
            "sul cloud (architettura zero-knowledge: la nuova password non "
            "puo' decifrare blob cifrati con la vecchia). I mapping nel "
            "browser di questo dispositivo non vengono toccati."
        )
    else:
        mapping_note = (
            "Il tuo account e i mapping nel browser di questo dispositivo "
            "non vengono toccati dal reset della password. Il recovery serve "
            "solo a riassegnare la password e tornare ad accedere."
        )

    body = (
        "Ciao,\n\n"
        "Hai richiesto il reset della password per Recode IT. Per procedere "
        "ti serviranno: (a) questo link, (b) uno dei tuoi 10 codici di "
        "recupero (stampati al momento dell'iscrizione).\n\n"
        f"  {link}\n\n"
        f"Il link scade fra {RESET_TOKEN_TTL_HOURS} ore.\n\n"
        f"{mapping_note}\n\n"
        "Se non hai richiesto il reset, ignora questa email — il tuo "
        "account resta intatto.\n\n"
        "Michele Loi\nmhcl@micheleloi.pro\n"
    )
    return _send(to_email, "Reset password — Recode IT", body)


__all__ = [
    "ENV_RESEND_API_KEY",
    "ENV_BASE_URL",
    "DEFAULT_BASE_URL",
    "EMAIL_FROM",
    "RESET_TOKEN_TTL_HOURS",
    "send_verification_email",
    "send_password_reset_email",
    "send_invite_request_received_email",
    "send_invite_approved_email",
]
