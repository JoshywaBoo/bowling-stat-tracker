import os
import resend
from urllib.parse import urlencode

resend.api_key = os.getenv("RESEND_API_KEY")

API_BASE = os.environ.get("API_BASE", "https://bowling-stat-tracker.onrender.com")


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

    resend.Emails.send({
        "from": os.getenv("EMAIL_FROM"),
        "to": email,
        "subject": subject,
        "text": text,
    })