export type ParsedTransaction = {
  date: string
  description: string
  amount: number
  category?: string
}

const MAX_TRANSACTIONS = 1000

const amountPattern = /\(?-?\$?\s*[\d,]+(?:\.\d{1,2})?\)?/

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/\$/g, '').replace(/,/g, '').trim()
  if (!cleaned) {
    return null
  }

  const isNegative = cleaned.startsWith('(') && cleaned.endsWith(')')
  const numeric = Number(cleaned.replace(/[()]/g, ''))
  if (Number.isNaN(numeric)) {
    return null
  }

  return isNegative ? -numeric : numeric
}

function splitCsvRow(row: string, delimiter: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < row.length; i += 1) {
    const char = row[i]

    if (char === '"') {
      const escapedQuote = inQuotes && row[i + 1] === '"'
      if (escapedQuote) {
        current += '"'
        i += 1
      } else {
        inQuotes = !inQuotes
      }
      continue
    }

    if (char === delimiter && !inQuotes) {
      fields.push(current.trim())
      current = ''
      continue
    }

    current += char
  }

  fields.push(current.trim())
  return fields
}

function detectDelimiter(headerLine: string): string {
  const candidates = [',', ';', '\t']
  const counts = candidates.map((delimiter) => ({
    delimiter,
    count: headerLine.split(delimiter).length,
  }))

  counts.sort((a, b) => b.count - a.count)
  return counts[0]?.delimiter ?? ','
}

function normalizeDate(raw: string): string {
  const value = raw.trim()
  if (!value) {
    return new Date().toISOString().slice(0, 10)
  }

  const parsed = new Date(value)
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10)
  }

  const mmddyyyy = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/)
  if (mmddyyyy) {
    const month = mmddyyyy[1].padStart(2, '0')
    const day = mmddyyyy[2].padStart(2, '0')
    const year = mmddyyyy[3].length === 2 ? `20${mmddyyyy[3]}` : mmddyyyy[3]
    return `${year}-${month}-${day}`
  }

  return value
}

function getColumnIndex(headers: string[], aliases: string[]): number {
  return headers.findIndex((header) => aliases.some((alias) => header.includes(alias)))
}

function parseCsv(text: string): ParsedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return []
  }

  const delimiter = detectDelimiter(lines[0])
  const headers = splitCsvRow(lines[0].toLowerCase(), delimiter)

  const dateIndex = getColumnIndex(headers, ['date', 'posted'])
  const descriptionIndex = getColumnIndex(headers, ['description', 'merchant', 'details', 'name'])
  const amountIndex = getColumnIndex(headers, ['amount', 'value'])
  const debitIndex = getColumnIndex(headers, ['debit', 'withdrawal'])
  const creditIndex = getColumnIndex(headers, ['credit', 'deposit'])
  const categoryIndex = getColumnIndex(headers, ['category', 'type', 'memo'])

  const records: ParsedTransaction[] = []

  for (let i = 1; i < lines.length && records.length < MAX_TRANSACTIONS; i += 1) {
    const fields = splitCsvRow(lines[i], delimiter)

    const date = normalizeDate(fields[dateIndex] ?? '')
    const description = (fields[descriptionIndex] ?? '').replace(/\s+/g, ' ').trim()

    let amount: number | null = null
    if (amountIndex >= 0) {
      amount = toNumber(fields[amountIndex] ?? '')
    } else {
      const debit = debitIndex >= 0 ? toNumber(fields[debitIndex] ?? '') ?? 0 : 0
      const credit = creditIndex >= 0 ? toNumber(fields[creditIndex] ?? '') ?? 0 : 0
      amount = credit !== 0 ? credit : debit !== 0 ? -Math.abs(debit) : null
    }

    if (!description || amount === null) {
      continue
    }

    const rawCategory = categoryIndex >= 0 ? (fields[categoryIndex] ?? '').trim() : undefined

    records.push({ date, description, amount, ...(rawCategory ? { category: rawCategory } : {}) })
  }

  return records
}

function parseText(text: string): ParsedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const records: ParsedTransaction[] = []

  for (const line of lines) {
    if (records.length >= MAX_TRANSACTIONS) {
      break
    }

    const amountMatch = line.match(amountPattern)
    const dateMatch = line.match(/(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)/)
    if (!amountMatch || !dateMatch) {
      continue
    }

    const amount = toNumber(amountMatch[0])
    if (amount === null) {
      continue
    }

    const date = normalizeDate(dateMatch[0])
    const description = line
      .replace(dateMatch[0], '')
      .replace(amountMatch[0], '')
      .replace(/\s+/g, ' ')
      .trim()

    if (!description) {
      continue
    }

    records.push({ date, description, amount })
  }

  return records
}

function parseLoosePdfText(text: string): ParsedTransaction[] {
  const records: ParsedTransaction[] = []
  const datePattern = /\b(\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\b/g

  const matches = Array.from(text.matchAll(datePattern))
  if (matches.length === 0) {
    return []
  }

  for (let i = 0; i < matches.length && records.length < MAX_TRANSACTIONS; i += 1) {
    const match = matches[i]
    const dateText = match[1]
    const start = match.index ?? 0
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? text.length) : Math.min(start + 240, text.length)
    const chunk = text.slice(start, end)

    const amounts = Array.from(chunk.matchAll(/\(?-?\$?\s*[\d,]+(?:\.\d{1,2})?\)?/g))
    const bestAmount = amounts.length > 0 ? amounts[amounts.length - 1][0] : null
    if (!bestAmount) {
      continue
    }

    const amount = toNumber(bestAmount)
    if (amount === null) {
      continue
    }

    const description = chunk
      .replace(dateText, ' ')
      .replace(bestAmount, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!description || description.length < 2) {
      continue
    }

    records.push({
      date: normalizeDate(dateText),
      description,
      amount,
    })
  }

  return records
}

async function parseXlsx(file: File): Promise<ParsedTransaction[]> {
  const readXlsxFile = (await import('read-excel-file/browser')).default
  const rows = await readXlsxFile(file)
  if (rows.length < 2) return []

  const toCell = (cell: unknown): string => {
    if (cell instanceof Date) return cell.toISOString().slice(0, 10)
    if (cell === null || cell === undefined) return ''
    return String(cell)
  }

  const csvText = (rows as unknown[][])
    .map((row: unknown[]) => row.map((cell: unknown) => `"${toCell(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n')

  return parseCsv(csvText)
}

async function extractPdfText(
  pdfjsLib: {
    getDocument: (args: { data: ArrayBuffer; disableWorker?: boolean }) => {
      promise: Promise<{ numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: unknown[] }> }> }>
    }
    GlobalWorkerOptions?: { workerSrc?: string }
  },
  buffer: ArrayBuffer,
  disableWorker = false,
): Promise<string> {
  const pdf = await pdfjsLib.getDocument({ data: buffer, disableWorker }).promise
  let fullText = ''

  for (let i = 1; i <= pdf.numPages; i += 1) {
    try {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item) => ('str' in (item as Record<string, unknown>) ? String((item as { str: unknown }).str ?? '') : ''))
        .join(' ')
      fullText += `${pageText}\n`
    } catch {
      // Skip problematic pages and continue extracting whatever is readable.
    }
  }

  return fullText
}

async function parsePdf(buffer: ArrayBuffer): Promise<ParsedTransaction[]> {
  let fullText = ''

  try {
    const pdfjsLib = await import('pdfjs-dist')
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).href
    }
    fullText = await extractPdfText(pdfjsLib, buffer)
  } catch {
    // Fallback for PDFs/environments that fail on the default bundle/worker path.
    const legacyPdfJsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
    fullText = await extractPdfText(legacyPdfJsLib, buffer, true)
  }

  const csvCandidate = parseCsv(fullText)
  if (csvCandidate.length > 0) return csvCandidate

  const lineCandidate = parseText(fullText)
  if (lineCandidate.length > 0) return lineCandidate

  return parseLoosePdfText(fullText)
}

export async function extractTransactionsFromFile(file: File): Promise<ParsedTransaction[]> {
  const lowerName = file.name.toLowerCase()

  if (lowerName.endsWith('.xlsx')) {
    return parseXlsx(file)
  }

  if (lowerName.endsWith('.pdf')) {
    const buffer = await file.arrayBuffer()
    return parsePdf(buffer)
  }

  const text = await file.text()

  if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
    return parseCsv(text)
  }

  const csvCandidate = parseCsv(text)
  if (csvCandidate.length > 0) return csvCandidate
  return parseText(text)
}

export function suggestCategory(description: string, amount: number): string {
  const value = description.toLowerCase()

  if (amount > 0 && /(payroll|salary|direct deposit|income|deposit)/.test(value)) {
    return 'Income'
  }
  if (/(rent|mortgage)/.test(value)) {
    return 'Housing'
  }
  if (/(electric|water|gas|utility|internet|phone)/.test(value)) {
    return 'Utilities'
  }
  if (/(grocery|market|whole foods|trader joe|costco|safeway)/.test(value)) {
    return 'Groceries'
  }
  if (/(restaurant|coffee|cafe|doordash|ubereats|grubhub)/.test(value)) {
    return 'Dining'
  }
  if (/(uber|lyft|shell|chevron|exxon|transit|parking|toll)/.test(value)) {
    return 'Transport'
  }
  if (/(doctor|hospital|clinic|pharmacy|cvs|walgreens)/.test(value)) {
    return 'Healthcare'
  }
  if (/(insurance|geico|state farm|progressive)/.test(value)) {
    return 'Insurance'
  }
  if (/(transfer|zelle|venmo|cash app|paypal)/.test(value)) {
    return 'Transfer'
  }

  return 'Other'
}
