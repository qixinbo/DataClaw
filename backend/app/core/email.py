import smtplib
import os
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

def send_verification_email(to_email: str, token: str):
    smtp_host = os.getenv("SMTP_HOST", "smtp.qq.com")
    smtp_port = int(os.getenv("SMTP_PORT", "465"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    frontend_url = os.getenv("FRONTEND_URL", "http://localhost:5173")

    if not smtp_user or not smtp_password:
        print("SMTP configuration is missing. Skip sending email.")
        return

    msg = MIMEMultipart()
    msg['From'] = smtp_user
    msg['To'] = to_email
    msg['Subject'] = "Please verify your email address"

    verify_link = f"{frontend_url}/verify-email?token={token}"
    body = f"""
    <html>
        <body>
            <h2>Welcome to DataClaw!</h2>
            <p>Please click the link below to verify your email address and activate your account:</p>
            <p><a href="{verify_link}">{verify_link}</a></p>
            <p>If you did not request this, please ignore this email.</p>
        </body>
    </html>
    """
    msg.attach(MIMEText(body, 'html'))

    try:
        # Use SMTP_SSL for port 465
        server = smtplib.SMTP_SSL(smtp_host, smtp_port)
        server.login(smtp_user, smtp_password)
        server.send_message(msg)
        server.quit()
        print(f"Verification email sent to {to_email}")
    except Exception as e:
        print(f"Failed to send email: {e}")
