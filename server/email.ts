import nodemailer from "nodemailer";

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });
}

export async function sendPasswordResetEmail(
  to: string,
  code: string,
): Promise<boolean> {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("SMTP not configured — reset code:", code);
    return false;
  }

  const from = process.env.SMTP_FROM || process.env.SMTP_USER;

  try {
    await transporter.sendMail({
      from: `StreetCover <${from}>`,
      to,
      subject: "Your StreetCover password reset code",
      text: `Your password reset code is: ${code}\n\nIt expires in 1 hour. If you didn't request this, you can ignore this email.`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;">
          <h2 style="color:#33C3F0;">StreetCover</h2>
          <p>Here is your password reset code:</p>
          <div style="background:#1A1A2E;border-radius:12px;padding:24px;text-align:center;margin:24px 0;">
            <span style="font-size:36px;font-weight:bold;letter-spacing:8px;color:#ffffff;">${code}</span>
          </div>
          <p style="color:#9CA3AF;font-size:14px;">This code expires in 1 hour. If you didn't request a password reset you can safely ignore this email.</p>
        </div>
      `,
    });
    return true;
  } catch (err) {
    console.error("Failed to send reset email:", err);
    return false;
  }
}
