import os
import resend

resend.api_key = os.getenv("RESEND_API_KEY")


def send_email_code(email: str, code: str, purpose="verify", for_email: str | None = None):
    who = f" (for account: {for_email})" if for_email else ""

    if purpose == "verify":
        subject = "Verify your Bowling Tracker account"
        text = f"""
Verification code{who}:

{code}

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