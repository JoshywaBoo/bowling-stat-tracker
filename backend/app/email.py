import os
import smtplib
from email.mime.text import MIMEText
from urllib.parse import urlencode

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587
SMTP_USER = os.getenv("SMTP_USER")          # your Gmail address
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD")  # 16-character Gmail app password

API_BASE = os.environ.get("API_BASE", "https://bowling-stat-tracker.onrender.com")


def send_email_code(email: str, code: str, purpose="verify"):
    if purpose == "verify":
        verify_link = f"{API_BASE}/api/verify-link?" + urlencode(
            {"email": email, "code": code}
        )
        subject = "Verify your Bowling Tracker account"
        body = f"""Verification code:

{code}

Or just click to verify instantly:
{verify_link}

This code expires in 10 minutes.
"""
    else:
        subject = "Reset your password"
        body = f"""Password reset code:

{code}

This code expires in 10 minutes.
"""

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = SMTP_USER
    msg["To"] = email

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_USER, [email], msg.as_string())