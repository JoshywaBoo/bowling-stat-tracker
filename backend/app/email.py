import os
from urllib.parse import urlencode

from mailersend import MailerSendClient, EmailBuilder

ms = MailerSendClient()  # reads MAILERSEND_API_KEY from the environment

API_BASE = os.environ.get("API_BASE", "https://bowling-stat-tracker-backend.onrender.com")


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

    email_request = (
        EmailBuilder()
        .from_email(os.getenv("EMAIL_FROM"), "Bowling Stat Tracker")
        .to_many([{"email": email}])
        .subject(subject)
        .text(text)
        .build()
    )

    response = ms.emails.send(email_request)
    if not response.success:
        raise RuntimeError(f"MailerSend error ({response.status_code}): {response.data}")