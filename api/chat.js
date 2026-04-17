const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = 'chad@payatech.com';
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

async function logToSheet(email, summary) {
  await fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, summary })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages, isFirstMessage } = req.body;

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
- If they never gave their email and the conversation is wrapping up, ask one more time naturally like: "Hey before you go — want those notes? Just drop your email and I'll send them over."
- When the user gives you an email address, respond with exactly this format on its own line: EMAIL_CAPTURED:[their@email.com] — then keep the conversation going naturally.`,
        messages
      })
    });

    const data = await response.json();
    const rawReply = data.content?.[0]?.text || "Sorry, something went wrong. Try again!";

    // Check if Jeff captured an email
    const emailMatch = rawReply.match(/EMAIL_CAPTURED:\[(.+?)\]/);
    if (emailMatch) {
      const capturedEmail = emailMatch[1];
      const summary = messages.map(m => `${m.role}: ${m.content}`).join('\n');
      await logToSheet(capturedEmail, summary);
    }

    const delay = Math.floor(Math.random() * 2000) + 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
    console.log('Anthropic response:', JSON.stringify(data));
    // Strip EMAIL_CAPTURED tag from the reply before sending to frontend
if (data.content?.[0]?.text) {
  data.content[0].text = data.content[0].text.replace(/EMAIL_CAPTURED:\[.+?\]/g, '').trim();
}
res.status(200).json(data);
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
