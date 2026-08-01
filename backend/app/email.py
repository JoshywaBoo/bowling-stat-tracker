import os
import resend

resend.api_key = os.getenv("RESEND_API_KEY")


def send_email_code(email: str, code: str, purpose="verify"):
    if purpose == "verify":
        subject = "Verify your Bowling Tracker account"
        text = f"""
Your verification code is:

{code}

This code expires in 10 minutes.
"""
    else:
        subject = "Reset your password"
        text = f"""
Your password reset code is:

{code}

This code expires in 10 minutes.
"""

    resend.Emails.send({
        "from": os.getenv("EMAIL_FROM"),
        "to": email,
        "subject": subject,
        "text": text,
    })