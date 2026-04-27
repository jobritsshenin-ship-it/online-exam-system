export function parseCsvLine(line) {
  const values = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      values.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  values.push(current.trim())
  return values
}

export function parseCsvRows(text) {
  const rows = []
  let row = []
  let current = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]

    if (char === '"' && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      row.push(current.trim())
      current = ''
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') {
        index += 1
      }
      row.push(current.trim())
      if (row.some((value) => value.length > 0)) {
        rows.push(row)
      }
      row = []
      current = ''
    } else {
      current += char
    }
  }

  row.push(current.trim())
  if (row.some((value) => value.length > 0)) {
    rows.push(row)
  }

  return { rows, unterminatedQuote: quoted }
}

export const questionCsvHeaders = [
  'question',
  'option1',
  'option2',
  'option3',
  'option4',
  'correct_answer',
  'marks',
  'explanation',
]

function stripBom(value) {
  return value.replace(/^\uFEFF/, '')
}

function normalizeQuestionCsvRow(values) {
  const normalized = values.map((value) => value.trim())
  if (normalized.length > questionCsvHeaders.length) {
    return [
      ...normalized.slice(0, 7),
      normalized.slice(7).join(',').trim(),
    ]
  }
  return normalized
}

function getCorrectAnswerField(correctAnswerRaw, options) {
  const correctAnswer = correctAnswerRaw.trim()
  const matchIndex = options.findIndex((option) => option.trim() === correctAnswer)
  return matchIndex >= 0 ? `option${matchIndex + 1}` : ''
}

export function parseQuestionCsv(text) {
  const { rows, unterminatedQuote } = parseCsvRows(text)
  if (rows.length === 0) {
    return { validRows: [], invalidRows: [{ rowNumber: 1, errors: ['File is empty.'] }] }
  }

  const invalidRows = []

  if (unterminatedQuote) {
    invalidRows.push({ rowNumber: rows.length, errors: ['CSV has an unterminated quoted value.'] })
  }

  const header = rows[0].map((value) => stripBom(value).trim().toLowerCase())
  const hasHeader =
    header.length === questionCsvHeaders.length &&
    questionCsvHeaders.every((field, index) => header[index] === field)

  if (!hasHeader) {
    return {
      validRows: [],
      invalidRows: [
        ...invalidRows,
        {
          rowNumber: 1,
          errors: [`Header must be exactly: ${questionCsvHeaders.join(',')}`],
        },
      ],
    }
  }

  const validRows = []
  const dataRows = rows.slice(1)

  dataRows.forEach((rawValues, index) => {
    const values = normalizeQuestionCsvRow(rawValues)
    const [
      question = '',
      option1 = '',
      option2 = '',
      option3 = '',
      option4 = '',
      correctAnswerRaw = '',
      marksRaw = '',
      explanation = '',
    ] = values
    const errors = []
    const marks = Number(marksRaw)
    const options = [option1, option2, option3, option4]
    const correctAnswer = getCorrectAnswerField(correctAnswerRaw || '', options)

    if (values.length < 7) errors.push(`expected at least 7 columns, found ${values.length}`)
    if (!question) errors.push('question is required')
    if (!option1) errors.push('option1 is required')
    if (!option2) errors.push('option2 is required')
    if (!option3) errors.push('option3 is required')
    if (!option4) errors.push('option4 is required')
    if (!correctAnswerRaw) errors.push('correct_answer is required')
    if (correctAnswerRaw && !correctAnswer) {
      errors.push('correct_answer must exactly match one of option1, option2, option3, or option4')
    }
    if (!marksRaw || Number.isNaN(marks)) errors.push('marks must be numeric')

    if (errors.length > 0) {
      invalidRows.push({ rowNumber: index + 2, errors })
      return
    }

    validRows.push({
      question,
      option1,
      option2,
      option3,
      option4,
      correctAnswer,
      correctAnswerText: options[Number(correctAnswer.replace('option', '')) - 1],
      marks,
      explanation,
    })
  })

  return { validRows, invalidRows }
}

export function escapeCsvValue(value) {
  const text = value === null || value === undefined ? '' : String(value)
  if (!/[",\n\r]/.test(text)) {
    return text
  }
  return `"${text.replaceAll('"', '""')}"`
}

export function rowsToCsv(headers, rows) {
  const lines = [
    headers.map(escapeCsvValue).join(','),
    ...rows.map((row) => headers.map((header) => escapeCsvValue(row[header])).join(',')),
  ]
  return lines.join('\n')
}

export function downloadCsv(filename, headers, rows) {
  if (rows.length === 0) {
    return false
  }

  const blob = new Blob([rowsToCsv(headers, rows)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
  return true
}
