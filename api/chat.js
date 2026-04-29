const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = 'chad@payatech.com';
const SUPPORT_PHONE = '(805) 800-7168';
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbwRYH907MF6o4nsl3Bt-FenhwvNhhzmiUWzjepBiXxOxnst_gJqFy8rbrQ9d-9wvu-L8w/exec';

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
      max_tokens: 150,
      messages: [
        {
          role: 'user',
          content: `Summarize this help desk conversation in exactly 3 very short bullet points, one sentence each max:
🔧 Issue: [one line]
✅ Fixed: [one line]
📞 Next step: [one line]

No dashes, no asterisks, no extra text. Just the 3 lines. Be brief.

Conversation:
${messages.map(m => `${m.role}: ${m.content}`).join('\n')}`
        }
      ]
    })
  });
  const data = await response.json();
  return data.content?.[0]?.text || 'No summary available';
}

async function logToSheet(email, summary, ticketNumber) {
  await fetch(SHEET_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, summary, sendEmail: true, ticketNumber })
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages, isFirstMessage, emailCaptured, capturedEmail, ticketNumber } = req.body;

    if (isFirstMessage) {
      sendNotification();
    }

    const userMessageCount = messages.filter(m => m.role === 'user').length;
    const isFirstUserMessage = userMessageCount === 1;

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
- Keep responses short — 1 to 2 sentences max, or a numbered list of 2 to 3 steps if needed. Never introduce yourself again after the first message. When the user gives their email, just thank them briefly and ask what the issue is. Never start a response with "Hey" — use natural alternatives like "Got it", "Sure", "No problem", "On it", or just dive straight into the answer.
- Never dump a wall of text or cover every possible scenario
- Sound like a real person texting, not a manual — casual, plain English, no jargon, no asterisks, no dashes
- Do NOT say you are an AI, do not mention Claude or Anthropic
- You are Jeff. Stay in character always.
- Do NOT ask for the user's email at any point — it was already collected at the start.
- ${isFirstUserMessage ? 'The user\'s first message is their email address. You MUST immediately tag it on its own line exactly like this: EMAIL_CAPTURED:[their@email.com] — then thank them briefly and ask what the issue is. Example: "EMAIL_CAPTURED:[chad@payatech.com]\nAwesome, got your ticket open! What can I help you with today?"' : ''}
- ${emailCaptured ? 'IMPORTANT: You already have this user\'s email. Do NOT ask for it again under any circumstances. If the user says they cannot access their email, confirm by asking: "Is it the email you gave me that you\'re having trouble with, or a different one?" Then help them troubleshoot.' : ''}
- ${!emailCaptured && !isFirstUserMessage ? 'If the user says they cannot access their email, confirm by asking: "Is it the email you gave me that you\'re having trouble with, or a different one?" Then help them troubleshoot.' : ''}
- When you say anything like "you're all set", "glad that worked", "happy to help", "let me know if anything else comes up", or any closing phrase, you MUST add CONVERSATION_COMPLETE on its own line at the very end of your response. No exceptions.- If the user needs to speak to a real person, give them this number: ${SUPPORT_PHONE}`,
        messages
      })
    });

    const data = await response.json();
    const rawReply = data.content?.[0]?.text || "Sorry, something went wrong. Try again!";
    const allMessages = [...messages, { role: 'assistant', content: rawReply }];

    // When conversation is complete — generate summary and log everything at once
    if (rawReply.includes('CONVERSATION_COMPLETE') && capturedEmail) {
      const summary = await generateSummary(allMessages);
      await logToSheet(capturedEmail, summary, ticketNumber);
    }

    if (data.content?.[0]?.text) {
      data.content[0].text = data.content[0].text
        .replace(/EMAIL_CAPTURED_NOEMAIL:\[?[^\]\n]+\]?\n?/g, '')
        .replace(/EMAIL_CAPTURED:\[?[^\]\n]+\]?\n?/g, '')
        .replace(/CONVERSATION_COMPLETE\n?/g, '')
        .trim();
    }

    const delay = Math.floor(Math.random() * 2000) + 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
    res.status(200).json(data);

  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
