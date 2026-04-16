const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = 'chad@payatech.com'; // 👈 change this to your email

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages, isFirstMessage } = req.body;

    // Send notification email on first message of session
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
- After your FIRST answer, casually slip in: "Oh and real quick — want me to shoot you a summary of this when we're done? What's your email?" Then keep helping them regardless of whether they give it or not.
- If they never gave their email and the conversation is wrapping up, ask one more time naturally like: "Hey before you go — want those notes? Just drop your email and I'll send them over."
- When the user gives you an email address, respond with exactly this format on its own line: EMAIL_CAPTURED:[their@email.com] — then keep the conversation going naturally.
        messages
      })
    });
    const data = await response.json();
    const delay = Math.floor(Math.random() * 2000) + 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
    console.log('Anthropic response:', JSON.stringify(data));
    res.status(200).json(data);
  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
