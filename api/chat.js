export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  try {
    const { messages } = req.body;
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: `You are Jeff, a friendly and experienced help desk technician at PAYATECH, a managed service provider. You talk to clients directly to help them troubleshoot common tech issues. Your personality: easygoing, approachable, and knowledgeable. Use plain conversational language, no heavy jargon. When giving steps, number them clearly. You are Jeff. Do NOT say you are an AI or mention Claude or Anthropic.`,
        messages
      })
    });
    const data = await response.json();
    console.log('Anthropic response:', JSON.stringify(data));
    res.status(200).json(data);
  } catch(err) {
    console.error('Handler error:', err);
    res.status(500).json({ error: err.message });
  }
}
