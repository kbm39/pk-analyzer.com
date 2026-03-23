export type ParsedTransaction = {
  date: string
  description: string
  amount: number
  category?: string
}

const MAX_TRANSACTIONS = 1000
const DEBUG = typeof window !== 'undefined' && (window as any).__DEBUG_PARSE__ === true

const amountPattern = /\(?-?\$?\s*[\d,]+(?:\.\d{1,2})?\)?(?:\s*(?:cr|dr))?|\$?\s*[\d,]+(?:\.\d{1,2})?-(?=\s|$)/i
const datePattern = /(\d{1,2}\s*[\/\-.]\s*\d{1,2}(?:\s*[\/\-.]\s*\d{2,4})?|\d{4}\s*[\/\-.]\s*\d{1,2}\s*[\/\-.]\s*\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,\s*\d{2,4})?)/i

function debugLog(message: string, data?: unknown): void {
  if (DEBUG) {
    console.log(`[PARSE DEBUG] ${message}`, data ?? '')
  }
}

function toNumber(raw: string): number | null {
  const normalized = raw.trim()
  const hasTrailingMinus = /-\s*$/.test(normalized)
  const hasDr = /\bdr\b/i.test(normalized)
  const hasCr = /\bcr\b/i.test(normalized)
  const cleaned = normalized.replace(/\$/g, '').replace(/,/g, '').replace(/\b(?:cr|dr)\b/gi, '').trim()
  if (!cleaned) {
    return null
  }

  const isNegative = cleaned.startsWith('(') && cleaned.endsWith(')')
  const numeric = Number(cleaned.replace(/[()]/g, ''))
  if (Number.isNaN(numeric)) {
    return null
  }

  if (isNegative || hasTrailingMinus || hasDr) return -Math.abs(numeric)
  if (hasCr) return Math.abs(numeric)
  return numeric
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

  const yyyymmdd = value.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/)
  if (yyyymmdd) {
    const year = yyyymmdd[1]
    const month = yyyymmdd[2].padStart(2, '0')
    const day = yyyymmdd[3].padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  const monthNamed = value.match(/^([a-zA-Z]{3,9})\s+(\d{1,2})(?:,\s*(\d{2,4}))?$/)
  if (monthNamed) {
    const yearPart = monthNamed[3] ?? String(new Date().getFullYear())
    const year = yearPart.length === 2 ? `20${yearPart}` : yearPart
    const parsedNamed = new Date(`${monthNamed[1]} ${monthNamed[2]}, ${year}`)
    if (!Number.isNaN(parsedNamed.getTime())) return parsedNamed.toISOString().slice(0, 10)
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
  const descriptionIndex = getColumnIndex(headers, ['description', 'merchant', 'details', 'payee', 'name'])
  const amountIndex = getColumnIndex(headers, ['amount', 'value'])
  const debitIndex = getColumnIndex(headers, ['debit', 'withdrawal'])
  const creditIndex = getColumnIndex(headers, ['credit', 'deposit'])
  // Prioritise 'categor' substring so "Category", "Categories", "Categorization" all match.
  // Avoid 'type' and 'memo' — both can false-match unrelated columns (e.g. "Transaction Type").
  const categoryIndex = getColumnIndex(headers, ['categor', 'tag', 'label', 'classification'])

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
    const dateMatch = line.match(datePattern)
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

function parseStatementLikeLines(text: string): ParsedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const records: ParsedTransaction[] = []

  for (const line of lines) {
    if (records.length >= MAX_TRANSACTIONS) break

    const dateMatch = line.match(datePattern)
    if (!dateMatch) continue

    const amounts = Array.from(line.matchAll(new RegExp(amountPattern, 'gi')))
    const amountToken = amounts.length > 0 ? amounts[amounts.length - 1][0] : null
    if (!amountToken) continue

    const amount = toNumber(amountToken)
    if (amount === null) continue

    const dateToken = dateMatch[0]
    const description = line
      .replace(dateToken, ' ')
      .replace(amountToken, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!description || description.length < 2) continue

    records.push({
      date: normalizeDate(dateToken),
      description,
      amount,
    })
  }

  return records
}

function parseAdjacentLinePairs(text: string): ParsedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const records: ParsedTransaction[] = []

  for (let i = 0; i < lines.length - 1 && records.length < MAX_TRANSACTIONS; i += 1) {
    const combined = `${lines[i]} ${lines[i + 1]}`
    const dateMatch = combined.match(datePattern)
    const amountMatches = Array.from(combined.matchAll(new RegExp(amountPattern, 'gi')))
    const amountToken = amountMatches.length > 0 ? amountMatches[amountMatches.length - 1][0] : null

    if (!dateMatch || !amountToken) continue

    const amount = toNumber(amountToken)
    if (amount === null) continue

    const dateToken = dateMatch[0]
    const description = combined
      .replace(dateToken, ' ')
      .replace(amountToken, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!description || description.length < 2) continue

    records.push({
      date: normalizeDate(dateToken),
      description,
      amount,
    })
    i += 1
  }

  return records
}

function parseWindowedLines(text: string): ParsedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const records: ParsedTransaction[] = []

  for (let i = 0; i < lines.length && records.length < MAX_TRANSACTIONS; i += 1) {
    for (let windowSize = 2; windowSize <= 4; windowSize += 1) {
      if (i + windowSize > lines.length) break

      const combined = lines.slice(i, i + windowSize).join(' ')
      const dateMatch = combined.match(datePattern)
      if (!dateMatch) continue

      const amountMatches = Array.from(combined.matchAll(new RegExp(amountPattern, 'gi')))
      const amountToken = amountMatches.length > 0 ? amountMatches[amountMatches.length - 1][0] : null
      if (!amountToken) continue

      const amount = toNumber(amountToken)
      if (amount === null) continue

      const dateToken = dateMatch[0]
      const description = combined
        .replace(dateToken, ' ')
        .replace(amountToken, ' ')
        .replace(/\s+/g, ' ')
        .trim()

      if (!description || description.length < 2) continue

      records.push({
        date: normalizeDate(dateToken),
        description,
        amount,
      })

      i += windowSize - 1
      break
    }
  }

  return records
}

function parseRunningDateLedger(text: string): ParsedTransaction[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)

  const records: ParsedTransaction[] = []
  let activeDate: string | null = null

  for (const line of lines) {
    if (records.length >= MAX_TRANSACTIONS) break

    const dateMatch = line.match(datePattern)
    if (dateMatch) {
      activeDate = normalizeDate(dateMatch[0])
    }

    if (!activeDate) continue

    const amountMatches = Array.from(line.matchAll(new RegExp(amountPattern, 'gi')))
    const amountToken = amountMatches.length > 0 ? amountMatches[amountMatches.length - 1][0] : null
    if (!amountToken) continue

    const amount = toNumber(amountToken)
    if (amount === null) continue

    const description = line
      .replace(datePattern, ' ')
      .replace(amountToken, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    if (!description || description.length < 2) continue

    records.push({
      date: activeDate,
      description,
      amount,
    })
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

function parseBruteForce(text: string): ParsedTransaction[] {
  debugLog('Attempting brute force parsing...')
  const records: ParsedTransaction[] = []
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  
  // Look for ANY pattern of: date-like thing, text, number-like thing
  const anyDatePattern = /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{4}[\/-]\d{1,2}[\/-]\d{1,2})/
  const anyAmountPattern = /[\d,]{2,}\.\d{1,2}|[\d,]+(?=\s|$)/
  
  for (const line of lines) {
    if (records.length >= MAX_TRANSACTIONS) break
    
    const dateMatch = line.match(anyDatePattern)
    const amountMatch = line.match(anyAmountPattern)
    
    if (!dateMatch || !amountMatch) continue
    
    const amount = toNumber(amountMatch[0])
    if (amount === null) continue
    
    const description = line
      .replace(dateMatch[0], '')
      .replace(amountMatch[0], '')
      .replace(/\s+/g, ' ')
      .trim()
    
    if (description.length < 2) continue
    
    records.push({
      date: normalizeDate(dateMatch[0]),
      description,
      amount,
    })
  }
  
  debugLog(`Brute force found ${records.length} transactions`)
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

      const positionedItems = content.items
        .map((item) => {
          const candidate = item as Record<string, unknown>
          const str = 'str' in candidate ? String((candidate as { str: unknown }).str ?? '') : ''
          const transform = Array.isArray(candidate.transform) ? (candidate.transform as number[]) : null
          if (!str || !transform || transform.length < 6) return null
          return {
            str: str.replace(/\s+/g, ' ').trim(),
            x: Number(transform[4] ?? 0),
            y: Number(transform[5] ?? 0),
          }
        })
        .filter((item): item is { str: string; x: number; y: number } => Boolean(item?.str))

      // Group glyphs by Y coordinate to rebuild visual rows from bank statement tables.
      if (positionedItems.length > 0) {
        positionedItems.sort((a, b) => {
          if (Math.abs(a.y - b.y) > 1.5) return b.y - a.y
          return a.x - b.x
        })

        const rows: Array<{ y: number; items: Array<{ str: string; x: number }> }> = []
        for (const item of positionedItems) {
          const existingRow = rows.find((row) => Math.abs(row.y - item.y) <= 1.8)
          if (existingRow) {
            existingRow.items.push({ str: item.str, x: item.x })
          } else {
            rows.push({ y: item.y, items: [{ str: item.str, x: item.x }] })
          }
        }

        rows.sort((a, b) => b.y - a.y)
        const pageLines = rows
          .map((row) =>
            row.items
              .sort((a, b) => a.x - b.x)
              .map((entry) => entry.str)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim(),
          )
          .filter(Boolean)

        fullText += `${pageLines.join('\n')}\n`
      } else {
        const pageText = content.items
          .map((item) => ('str' in (item as Record<string, unknown>) ? String((item as { str: unknown }).str ?? '') : ''))
          .join(' ')
        fullText += `${pageText}\n`
      }
    } catch {
      // Skip problematic pages and continue extracting whatever is readable.
    }
  }

  return fullText
}

async function extractPdfTextWithOcr(buffer: ArrayBuffer): Promise<string> {
  if (typeof document === 'undefined') return ''

  try {
    const [pdfjsLib, tesseract] = await Promise.all([
      import('pdfjs-dist/legacy/build/pdf.mjs'),
      import('tesseract.js'),
    ])

    const pdf = await pdfjsLib.getDocument({ data: buffer, disableWorker: true } as any).promise
    const pageLimit = Math.min(pdf.numPages, 20)
    let fullText = ''

    for (let i = 1; i <= pageLimit; i += 1) {
      try {
        const page = await pdf.getPage(i)
        const viewport = page.getViewport({ scale: 2 })
        const canvas = document.createElement('canvas')
        const ctx = canvas.getContext('2d')
        if (!ctx) continue

        canvas.width = Math.ceil(viewport.width)
        canvas.height = Math.ceil(viewport.height)

        await page.render({ canvas: canvas as any, canvasContext: ctx, viewport } as any).promise
        const result = await tesseract.recognize(canvas, 'eng')
        const pageText = result?.data?.text ?? ''
        fullText += `${pageText}\n`
      } catch {
        // Continue OCR for remaining pages even if one page fails.
      }
    }

    return fullText
  } catch {
    return ''
  }
}

async function parsePdf(buffer: ArrayBuffer): Promise<ParsedTransaction[]> {
  let fullText = ''
  debugLog('Starting PDF parsing...')

  try {
    const pdfjsLib = await import('pdfjs-dist')
    if (pdfjsLib.GlobalWorkerOptions) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).href
    }
    fullText = await extractPdfText(pdfjsLib, buffer)
    debugLog('PDF text extraction (ESM) succeeded', { length: fullText.length })
  } catch (e) {
    debugLog('PDF text extraction (ESM) failed', { error: String(e) })
  }

  if (!fullText.trim()) {
    try {
      const pdfjsLib = await import('pdfjs-dist')
      fullText = await extractPdfText(pdfjsLib, buffer, true)
      debugLog('PDF text extraction (no worker) succeeded', { length: fullText.length })
    } catch (e) {
      debugLog('PDF text extraction (no worker) failed', { error: String(e) })
    }
  }

  if (!fullText.trim()) {
    try {
      // Fallback for PDFs/environments that fail on the default bundle/worker path.
      const legacyPdfJsLib = await import('pdfjs-dist/legacy/build/pdf.mjs')
      fullText = await extractPdfText(legacyPdfJsLib, buffer, true)
      debugLog('PDF text extraction (legacy) succeeded', { length: fullText.length })
    } catch (e) {
      debugLog('PDF text extraction (legacy) failed', { error: String(e) })
    }
  }

  if (!fullText.trim()) {
    debugLog('Attempting OCR fallback...')
    fullText = await extractPdfTextWithOcr(buffer)
    debugLog('OCR extraction completed', { length: fullText.length })
  }

  if (!fullText.trim()) {
    debugLog('No text extracted from PDF')
    return []
  }

  debugLog('PDF text extracted, attempting parsers...', { textLength: fullText.length, firstChars: fullText.slice(0, 500) })

  const csvCandidate = parseCsv(fullText)
  if (csvCandidate.length > 0) {
    debugLog('✓ CSV parser succeeded', { count: csvCandidate.length })
    return csvCandidate
  }
  debugLog('✗ CSV parser failed')

  const lineCandidate = parseText(fullText)
  if (lineCandidate.length > 0) {
    debugLog('✓ Line parser succeeded', { count: lineCandidate.length })
    return lineCandidate
  }
  debugLog('✗ Line parser failed')

  const statementCandidate = parseStatementLikeLines(fullText)
  if (statementCandidate.length > 0) {
    debugLog('✓ Statement parser succeeded', { count: statementCandidate.length })
    return statementCandidate
  }
  debugLog('✗ Statement parser failed')

  const adjacentLineCandidate = parseAdjacentLinePairs(fullText)
  if (adjacentLineCandidate.length > 0) {
    debugLog('✓ Adjacent lines parser succeeded', { count: adjacentLineCandidate.length })
    return adjacentLineCandidate
  }
  debugLog('✗ Adjacent lines parser failed')

  const windowedCandidate = parseWindowedLines(fullText)
  if (windowedCandidate.length > 0) {
    debugLog('✓ Windowed lines parser succeeded', { count: windowedCandidate.length })
    return windowedCandidate
  }
  debugLog('✗ Windowed lines parser failed')

  const runningDateCandidate = parseRunningDateLedger(fullText)
  if (runningDateCandidate.length > 0) {
    debugLog('✓ Running date parser succeeded', { count: runningDateCandidate.length })
    return runningDateCandidate
  }
  debugLog('✗ Running date parser failed')

  const looseCandidate = parseLoosePdfText(fullText)
  if (looseCandidate.length > 0) {
    debugLog('✓ Loose PDF parser succeeded', { count: looseCandidate.length })
    return looseCandidate
  }
  debugLog('✗ Loose PDF parser failed')

  const bruteCandidate = parseBruteForce(fullText)
  if (bruteCandidate.length > 0) {
    debugLog('✓ Brute force parser succeeded', { count: bruteCandidate.length })
    return bruteCandidate
  }
  debugLog('✗ Brute force parser failed')

  // Text was extracted but all parsers failed — the embedded text may be garbage/unstructured.
  // Fall back to OCR unconditionally on the original buffer.
  debugLog('All text parsers failed — attempting OCR as final fallback on original buffer...')
  const ocrText = await extractPdfTextWithOcr(buffer)
  debugLog('OCR final fallback text length', { length: ocrText.length, firstChars: ocrText.slice(0, 200) })

  if (!ocrText.trim()) {
    debugLog('OCR final fallback returned no text')
    return []
  }

  // Run every parser on the OCR output
  for (const [name, fn] of [
    ['CSV', parseCsv],
    ['Line', parseText],
    ['Statement', parseStatementLikeLines],
    ['Adjacent', parseAdjacentLinePairs],
    ['Windowed', parseWindowedLines],
    ['RunningDate', parseRunningDateLedger],
    ['Loose', parseLoosePdfText],
    ['BruteForce', parseBruteForce],
  ] as Array<[string, (t: string) => ParsedTransaction[]]>) {
    const result = fn(ocrText)
    if (result.length > 0) {
      debugLog(`✓ OCR fallback + ${name} parser succeeded`, { count: result.length })
      return result
    }
    debugLog(`✗ OCR fallback + ${name} parser failed`)
  }

  debugLog('All parsers exhausted including OCR fallback')
  return []
}

export async function extractTransactionsFromFile(file: File): Promise<ParsedTransaction[]> {
  const lowerName = file.name.toLowerCase()
  debugLog(`Processing file: ${file.name} (${file.size} bytes)`)

  if (lowerName.endsWith('.xlsx')) {
    debugLog('File type: XLSX')
    try {
      const result = await parseXlsx(file)
      debugLog(`XLSX parsing resulted in ${result.length} transactions`)
      return result
    } catch (e) {
      debugLog('XLSX parsing error', { error: String(e) })
      return []
    }
  }

  if (lowerName.endsWith('.pdf')) {
    debugLog('File type: PDF')
    try {
      const buffer = await file.arrayBuffer()
      const result = await parsePdf(buffer)
      debugLog(`PDF parsing resulted in ${result.length} transactions`)
      return result
    } catch (e) {
      debugLog('PDF parsing error', { error: String(e) })
      return []
    }
  }

  try {
    const text = await file.text()
    debugLog(`File text extracted (${text.length} chars)`)

    if (lowerName.endsWith('.csv') || lowerName.endsWith('.tsv')) {
      debugLog('File type: CSV/TSV')
      const result = parseCsv(text)
      debugLog(`CSV parsing resulted in ${result.length} transactions`)
      return result
    }

    debugLog('File type: Text (trying parsers)')
    const csvCandidate = parseCsv(text)
    if (csvCandidate.length > 0) {
      debugLog(`CSV parser found ${csvCandidate.length} transactions`)
      return csvCandidate
    }

    const textCandidate = parseText(text)
    if (textCandidate.length > 0) {
      debugLog(`Text parser found ${textCandidate.length} transactions`)
      return textCandidate
    }

    const statementCandidate = parseStatementLikeLines(text)
    if (statementCandidate.length > 0) {
      debugLog(`Statement parser found ${statementCandidate.length} transactions`)
      return statementCandidate
    }

    const adjacentCandidate = parseAdjacentLinePairs(text)
    if (adjacentCandidate.length > 0) {
      debugLog(`Adjacent parser found ${adjacentCandidate.length} transactions`)
      return adjacentCandidate
    }

    const windowedCandidate = parseWindowedLines(text)
    if (windowedCandidate.length > 0) {
      debugLog(`Windowed parser found ${windowedCandidate.length} transactions`)
      return windowedCandidate
    }

    const runningDateCandidate = parseRunningDateLedger(text)
    if (runningDateCandidate.length > 0) {
      debugLog(`Running date parser found ${runningDateCandidate.length} transactions`)
      return runningDateCandidate
    }

    const looseCandidate = parseLoosePdfText(text)
    if (looseCandidate.length > 0) {
      debugLog(`Loose parser found ${looseCandidate.length} transactions`)
      return looseCandidate
    }

    const bruteCandidate = parseBruteForce(text)
    if (bruteCandidate.length > 0) {
      debugLog(`Brute force parser found ${bruteCandidate.length} transactions`)
      return bruteCandidate
    }

    debugLog('All parsers failed - no transactions found')
    return []
  } catch (e) {
    debugLog('File text extraction error', { error: String(e) })
    return []
  }
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
