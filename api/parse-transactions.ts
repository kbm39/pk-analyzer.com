import type { VercelRequest, VercelResponse } from '@vercel/node'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    console.error('Missing ANTHROPIC_API_KEY')
    return res.status(500).json({ error: 'Server missing ANTHROPIC_API_KEY' })
  }

  const { pdfBase64 } = req.body ?? {}
  if (typeof pdfBase64 !== 'string' || !pdfBase64.trim()) {
    return res.status(400).json({ error: 'Missing pdfBase64' })
  }

  console.log(`Received PDF base64 length: ${pdfBase64.length}`)

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
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

    const data = await r.json() as any
    console.log('Anthropic response status:', r.status)

    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data))
      return res.status(502).json({ error: 'Anthropic API error', detail: data })
    }

    const raw = data.content?.[0]?.text ?? ''
    console.log('Claude response (first 200 chars):', raw.slice(0, 200))

    const match = raw.match(/\[[\s\S]*\]/)
    if (!match) {
      console.log('No JSON array found in response')
      return res.status(200).json({ transactions: [] })
    }

    const transactions = JSON.parse(match[0])
    console.log(`Parsed ${transactions.length} transactions`)
    return res.status(200).json({ transactions })
  } catch (err) {
    console.error('Handler error:', String(err))
    return res.status(500).json({ error: String(err) })
  }
}
