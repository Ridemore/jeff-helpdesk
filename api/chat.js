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
          content: `Summarize this help desk conversation in exactly 3 bullet points using this format:
🔧 What the issue was
✅ What we tried or fixed
📞 What the next step is if the problem continues

No dashes, no asterisks, no extra text. Just the 3 lines. Keep it short and friendly.

Conversation:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`
        }
      ]
    })
  });
  const data = await response.json();
  return data.content?.[0]?.text || 'No summary available';
}

async function logToSheet(email, summary, sendEmail) {
  await fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, summary, sendEmail })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages, isFirstMessage, emailCaptured } = req.body;

    if (isFirstMessage) {
      sendNotification();
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
- If the user says they can't access their email, immediately ask: "Got it — what's your email address so I can look into that?" If they provide it, tag it as EMAIL_CAPTURED_NOEMAIL:[their@email.com] — this captures the lead but does NOT send them notes.
- After your FIRST answer on any other issue, casually slip in: "Oh and real quick — want me to shoot you a summary of this when we're done? What's your email?" Then keep helping them regardless of whether they give it or not.
- ${emailCaptured ? 'IMPORTANT: You already have this user\'s email. Do NOT ask for it again. Do not mention notes or email at all.' : 'If the conversation is wrapping up and you still do not have their email, ask one more time: "Hey before you go — want those notes? Just drop your email and I\'ll send them over."'}
- When the user agrees to receive notes AND gives their email, respond with exactly this format on its own line: EMAIL_CAPTURED:[their@email.com] — this will send them the notes email.
- If the user needs to speak to a real person, give them this number: ${SUPPORT_PHONE}`,
        messages
      })
    });

    const data = await response.json();
    const rawReply = data.content?.[0]?.text || "Sorry, something went wrong. Try again!";

    // EMAIL_CAPTURED — send notes + log to sheet
    const emailMatch = rawReply.match(/EMAIL_CAPTURED:\[?([^\]\n]+)\]?/);
    if (emailMatch && !rawReply.includes('EMAIL_CAPTURED_NOEMAIL')) {
      const capturedEmail = emailMatch[1];
      generateSummary(messages).then(summary => {
        logToSheet(capturedEmail, summary, true);
      });
    }

    // EMAIL_CAPTURED_NOEMAIL — log to sheet only, no notes email
    const noEmailMatch = rawReply.match(/EMAIL_CAPTURED_NOEMAIL:\[?([^\]\n]+)\]?/);
    if (noEmailMatch) {
      const capturedEmail = noEmailMatch[1];
      generateSummary(messages).then(summary => {
        logToSheet(capturedEmail, summary, false);
      });
    }

    // Strip both tags before sending to frontend
    if (data.content?.[0]?.text) {
      data.content[0].text = data.content[0].text
        .replace(/EMAIL_CAPTURED_NOEMAIL:\[?[^\]\n]+\]?\n?/g, '')
        .replace(/EMAIL_CAPTURED:\[?[^\]\n]+\]?\n?/g, '')
        .trim();
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
