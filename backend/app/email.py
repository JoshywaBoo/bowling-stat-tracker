import os
from urllib.parse import urlencode

from mailersend import MailerSendClient, EmailBuilder

ms = MailerSendClient()  # reads MAILERSEND_API_KEY from the environment

API_BASE = os.environ.get("API_BASE", "https://bowling-stat-tracker-backend.onrender.com")
ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "youremail@example.com")


def _build_and_send(to_email: str, subject: str, text: str):
    email_request = (
        EmailBuilder()
        .from_email(os.getenv("EMAIL_FROM"), "Bowling Stat Tracker")
        .to_many([{"email": to_email}])
        .subject(subject)
        .text(text)
        .build()
    )
    return ms.emails.send(email_request)


def send_email_code(email: str, code: str, purpose="verify", for_email: str | None = None):
    who = f" (for account: {for_email})" if for_email else ""

    if purpose == "verify":
        verify_link = f"{API_BASE}/api/verify-link?" + urlencode(
            {"email": for_email or email, "code": code}
        )
        subject = "Verify your Bowling Tracker account"
        text = f"""
Verification code{who}:

{code}

Or just click to verify instantly:
{verify_link}

This code expires in 10 minutes.
"""
    else:
        subject = "Reset your password"
        text = f"""
Password reset code{who}:

{code}

This code expires in 10 minutes.
"""

    try:
        response = _build_and_send(email, subject, text)
        if not response.success:
            raise RuntimeError(f"MailerSend error ({response.status_code}): {response.data}")
    except Exception as primary_exc:
        # Trial MailerSend accounts only allow a couple of "unique" verified
        # recipients - sends to anyone else get rejected. Rather than losing
        # the code entirely, fall back to a mailbox we know is whitelisted
        # so you (the admin) can still see/relay it during development.
        print(f"WARNING: send to '{email}' failed ({primary_exc!r}); "
              f"retrying with ADMIN_EMAIL '{ADMIN_EMAIL}'")
        fallback_text = f"[Originally intended for {email}]\n{text}"
        try:
            response = _build_and_send(ADMIN_EMAIL, subject, fallback_text)
            if not response.success:
                raise RuntimeError(f"MailerSend error ({response.status_code}): {response.data}")
        except Exception as fallback_exc:
            raise RuntimeError(
                f"Both sends failed. Original ({email}): {primary_exc}. "
                f"Fallback ({ADMIN_EMAIL}): {fallback_exc}"
            ) from fallback_exc