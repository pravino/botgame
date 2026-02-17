import { Resend } from 'resend';

let connectionSettings: any;

async function getCredentials() {
  const hostname = process.env.REPLIT_CONNECTORS_HOSTNAME;
  const xReplitToken = process.env.REPL_IDENTITY
    ? 'repl ' + process.env.REPL_IDENTITY
    : process.env.WEB_REPL_RENEWAL
    ? 'depl ' + process.env.WEB_REPL_RENEWAL
    : null;

  if (!xReplitToken) {
    throw new Error('X_REPLIT_TOKEN not found for repl/depl');
  }

  connectionSettings = await fetch(
    'https://' + hostname + '/api/v2/connection?include_secrets=true&connector_names=resend',
    {
      headers: {
        'Accept': 'application/json',
        'X_REPLIT_TOKEN': xReplitToken
      }
    }
  ).then(res => res.json()).then(data => data.items?.[0]);

  if (!connectionSettings || (!connectionSettings.settings.api_key)) {
    throw new Error('Resend not connected');
  }
  return { apiKey: connectionSettings.settings.api_key, fromEmail: connectionSettings.settings.from_email };
}

export async function sendOtpEmail(toEmail: string, code: string): Promise<void> {
  const { apiKey, fromEmail } = await getCredentials();
  const resend = new Resend(apiKey);

  await resend.emails.send({
    from: fromEmail || 'Crypto Games <onboarding@resend.dev>',
    to: toEmail,
    subject: `Your login code: ${code}`,
    html: `
      <div style="font-family: sans-serif; max-width: 400px; margin: 0 auto; padding: 32px; background: #1a1a2e; color: #e0e0e0; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 24px;">
          <h1 style="color: #fbbf24; margin: 0; font-size: 24px;">Crypto Games</h1>
          <p style="color: #9ca3af; margin-top: 8px;">Your one-time login code</p>
        </div>
        <div style="background: #2d2d44; padding: 24px; border-radius: 8px; text-align: center; margin-bottom: 24px;">
          <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #fbbf24;">${code}</span>
        </div>
        <p style="color: #9ca3af; font-size: 13px; text-align: center; margin: 0;">
          This code expires in 10 minutes. Don't share it with anyone.
        </p>
      </div>
    `,
  });
}
