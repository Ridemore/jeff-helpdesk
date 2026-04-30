const RESEND_API_KEY = process.env.RESEND_API_KEY;
const NOTIFY_EMAIL = 'chad@payatech.com';
const SUPPORT_PHONE = '(805) 800-7168';
const SHEET_URL = 'https://script.google.com/macros/s/AKfycbwRYH907MF6o4nsl3Bt-FenhwvNhhzmiUWzjepBiXxOxnst_gJqFy8rbrQ9d-9wvu-L8w/exec';

const SUMMARY_ASKS = [
  "Before you go — want me to shoot you a quick recap of everything we covered today?",
  "Want me to send you a summary of this chat so you have it for next time?",
  "One last thing — want me to email you these steps so you don't have to remember all this?",
  "Want a quick cheat sheet of what we just did sent to your email?",
  "I can send you a recap of this whole chat. Want me to do that?"
];

const RESOLVED_SIGNALS = [
  'thank', 'thanks', 'got it', 'that worked', 'working now', 'fixed', 'all good',
  'good now', 'were good', "we're good", 'perfect', 'great', 'awesome', 'appreciate',
  'it works', 'it worked', 'solved', 'resolved', 'you rock', 'nice one', 'sorted'
];

function looksResolved(messages) {
  const lastUserMsg = messages.filter(m => m.role === 'user').pop()?.content?.toLowerCase() || '';
  return RESOLVED_SIGNALS.some(sig => lastUserMsg.includes(sig));
}

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
    const { messages, isFirstMessage, emailCaptured, capturedEmailAddress, summaryOffered, saidYesToSummary } = req.body;

    if (isFirstMessage) {
      sendNotification();
    }

    const userMessageCount = messages.filter(m => m.role === 'user').length;
    const lastUserMsg = messages[messages.length - 1]?.content?.toLowerCase() || '';

    const saidYes = saidYesToSummary === true;
    const saidNo = lastUserMsg === 'no thanks' || lastUserMsg === 'no';

    // User said yes — generate summary and send email
    if (saidYes && emailCaptured && capturedEmailAddress) {
      generateSummary(messages).then(summary => {
        logToSheet(capturedEmailAddress, summary, true);
      });
    }

    // Offer yes/no summary when issue looks resolved
    const offerSummary = emailCaptured && !summaryOffered && !saidYes && !saidNo && userMessageCount >= 3 && looksResolved(messages);

    const randomSummaryAsk = SUMMARY_ASKS[Math.floor(Math.random() * SUMMARY_ASKS.length)];

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
- Keep responses short — 1 to 2 sentences max, or a numbered list of 2 to 3 steps if needed.
- Never introduce yourself again after the first message. Never start a response with "Hey" — use natural alternatives like "Got it", "Sure", "No problem", "On it", or just dive straight into the answer.
- Never dump a wall of text or cover every possible scenario.
- Sound like a real person texting, not a manual — casual, plain English, no jargon, no asterisks, no dashes.
- Do NOT say you are an AI, do not mention Claude or Anthropic.
- You are Jeff. Stay in character always.
- CRITICAL: NEVER ask for the user's email address under any circumstances. ${emailCaptured ? `You already have their email: ${capturedEmailAddress}. Do not ask for it again.` : 'The first message already collected their email. Do not ask again.'}
- If the user says they cannot access their email${capturedEmailAddress ? ` — their email on file is ${capturedEmailAddress} — ask: "Is the issue with ${capturedEmailAddress}?"` : ', ask what their email address is so you can look into it'}.
- ${offerSummary ? `The issue appears resolved. Work this naturally into your reply: "${randomSummaryAsk}"` : ''}
- ${saidYes && emailCaptured ? `The user said yes to the recap. Say: "Perfect, sending that over to ${capturedEmailAddress} now. Hope that helps — reach out anytime!"` : ''}
- ${saidNo ? 'The user said no to the recap. Say: "No worries! Hope everything\'s sorted. Reach out anytime."' : ''}
- If the user needs a real person: ${SUPPORT_PHONE}`,
        messages
      })
    });

    const data = await response.json();
    const rawReply = data.content?.[0]?.text || "Sorry, something went wrong. Try again!";

    if (data.content?.[0]?.text) {
      data.content[0].text = data.content[0].text
        .replace(/EMAIL_CAPTURED_NOEMAIL:\[?[^\]\n]+\]?\n?/g, '')
        .replace(/EMAIL_CAPTURED:\[?[^\]\n]+\]?\n?/g, '')
        .trim();
    }

    const delay = Math.floor(Math.random() * 2000) + 2000;
    await new Promise(resolve => setTimeout(resolve, delay));
    res.status(200).json({
      ...data,
      showYesNo: offerSummary,
      summaryOffered: summaryOffered || offerSummary
    });

  } catch (err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
