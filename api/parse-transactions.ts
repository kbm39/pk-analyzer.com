export const config = { runtime: 'edge' }

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server missing ANTHROPIC_API_KEY' }), { status: 500 })
  }

  let pdfBase64: string
  try {
    const body = await req.json()
    pdfBase64 = body?.pdfBase64
    if (typeof pdfBase64 !== 'string' || !pdfBase64.trim()) {
      return new Response(JSON.stringify({ error: 'Missing pdfBase64' }), { status: 400 })
    }
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400 })
  }

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'pdfs-2024-09-25',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
            },
            {
              type: 'text',
              text: `Extract every transaction from this bank statement and return ONLY a valid JSON array. Each item must have:
- "date": string in YYYY-MM-DD format
- "description": string (merchant/payee name)
- "amount": number (negative for debits/withdrawals, positive for credits/deposits)

Return ONLY the JSON array, no explanation. Example: [{"date":"2023-01-15","description":"WALMART","amount":-45.67}]`,
            },
          ],
        },
      ],
    }),
  })

  if (!r.ok) {
    const err = await r.text()
    return new Response(JSON.stringify({ error: `Anthropic error: ${err}` }), { status: 502 })
  }

  const data = await r.json() as { content?: Array<{ text?: string }> }
  const raw = data.content?.[0]?.text ?? ''
  const match = raw.match(/\[[\s\S]*\]/)
  if (!match) {
    return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
  }

  try {
    const transactions = JSON.parse(match[0])
    return new Response(JSON.stringify({ transactions }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch {
    return new Response(JSON.stringify({ transactions: [] }), { status: 200 })
  }
}
