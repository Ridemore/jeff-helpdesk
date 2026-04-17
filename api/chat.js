const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = 'chad@payatech.com';
const SUPPORT_PHONE = '(805) 800-7168';
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbxlybkSiKt9ou1_nXiUrslDKfHzhxIzpsGFB3ryr9R3uunOvLcKLS5PGkHI9scZrMQsEw/exec';

async function sendNotification() {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: NOTIFY_EMAIL,
      subject: '🔔 New visitor on Jeff Helpdesk!',
      html: '<p>Someone just started a chat with Jeff on your helpdesk!</p>'
    })
  });
}

async function generateSummary(messages) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: `Summarize this help desk conversation in 2-3 sentences. Focus on the issue, what was tried, and the recommended next step:\n\n${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`
        }
      ]
    })
  });
  const data = await response.json();
  return data.content?.[0]?.text || 'No summary available';
}

async function logToSheet(email, summary) {
  await fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, summary })
  });
}

async function sendNotesEmail(email, summary) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'onboarding@resend.dev',
      to: email,
      subject: 'Your notes from PAYATECH Help Desk',
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #f9f9f9;">
          <div style="background: #ffffff; border-radius: 16px; padding: 32px; box-shadow: 0 2px 12px rgba(0,0,0,0.06);">
            <div style="text-align: center; margin-bottom: 24px;">
              <img src="https://jeff-helpdesk.vercel.app/payatech-logo.png" alt="PAYATECH" style="height: 40px;" />
            </div>
            <h2 style="color: #000; font-size: 18px; margin: 0 0 8px;">Hey there!</h2>
            <p style="color: #555; font-size: 14px; line-height: 1.6; margin: 0 0 24px;">Here's a quick summary of what we covered in your help desk session today.</p>
            <div style="background: #f2f2f7; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
              <p style="color: #000; font-size: 14px; line-height: 1.7; margin: 0;">${summary}</p>
            </div>
            <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; text-align: center;">
              <p style="color: #888; font-size: 13px; margin: 0 0 8px;">Need to talk to a real person?</p>
              <a href="tel:+18058007168" style="color: #0071e3; font-size: 16px; font-weight: 600; text-decoration: none;">${SUPPORT_PHONE}</a>
              <p style="color: #aaa; font-size: 11px; margin: 16px 0 0;">PAYATECH Help Desk • payatech.com</p>
            </div>
          </div>
        </div>
      `
    })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages, isFirstMessage, emailCaptured } = req.body;

    if (isFirstMessage) {
      await sendNotification();
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        system: `You are Jeff, a friendly help desk technician at PAYATECH, a managed service provider. You talk directly with clients to help them fix tech issues.
Your rules:
- Keep responses short — 1 to 2 sentences max, or a numbered list of 2-3 steps if needed
- Never dump a wall of text or cover every possible scenario
- End SOME responses with a single follow-up question on its own line and try to never repeat a question, starting with a blank line
- Sound like a real person texting, not a manual — casual, plain English, no jargon, no asterisks, or double dashes
- Do NOT say you are an AI, do not mention Claude or Anthropic
- You are Jeff. Stay in character always.
- If the user says they can't access their email, immediately ask: "Got it — what's your email address so I can look into that?" and use that as the captured email. No need to ask again later.
- After your FIRST answer on any other issue, casually slip in: "Oh and real quick — want me to shoot you a summary of this when we're done? What's your email?" Then keep helping them regardless of whether they give it or not.
- If emailCaptured is true, you already have their email — do NOT ask for it again under any circumstances.
- If emailCaptured is false and the conversation is wrapping up, ask one more time naturally like: "Hey before you go — want those notes? Just drop your email and I'll send them over."
- When the user gives you an email address, respond with exactly this format on its own line: EMAIL_CAPTURED:[their@email.com] — then keep the conversation going naturally.
- If the user needs to speak to a real person, give them this number: ${SUPPORT_PHONE}`,
        messages
      })
    });

    const data = await response.json();
    const rawReply = data.content?.[0]?.text || "Sorry, something went wrong. Try again!";

    // Check if Jeff captured an email — generate summary, log to sheet, send notes email
    const emailMatch = rawReply.match(/EMAIL_CAPTURED:\[?([^\]\n]+)\]?/);
    if (emailMatch) {
      const capturedEmail = emailMatch[1];
      const summary = await generateSummary(messages);
      await Promise.all([
        logToSheet(capturedEmail, summary),
        sendNotesEmail(capturedEmail, summary)
      ]);
    }

    // Strip EMAIL_CAPTURED tag before sending to frontend
    if (data.content?.[0]?.text) {
      data.content[0].text = data.content[0].text.replace(/EMAIL_CAPTURED:\[?[^\]\n]+\]?\n?/g, '').trim();
    }

    const delay = Math.floor(Math.random() * 2000) + 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
    console.log('Anthropic response:', JSON.stringify(data));
    res.status(200).json(data);

  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
