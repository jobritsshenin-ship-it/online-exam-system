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

const csvHeaderAliases = {
  question: ['question', 'prompt', 'question_text'],
  option1: ['option1', 'option_1', 'option a', 'option_a', 'a'],
  option2: ['option2', 'option_2', 'option b', 'option_b', 'b'],
  option3: ['option3', 'option_3', 'option c', 'option_c', 'c'],
  option4: ['option4', 'option_4', 'option d', 'option_d', 'd'],
  correct_answer: ['correct_answer', 'answer', 'correct answer', 'correctoption', 'correct_option'],
  marks: ['marks', 'mark', 'points', 'score'],
  explanation: ['explanation', 'reason', 'rationale'],
}

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
  const lowerCorrectAnswer = correctAnswer.toLowerCase()
  const prefixedLetter = lowerCorrectAnswer.match(/^(?:option\s*)?([a-d])(?:[).:-]|\s|$)/)
  if (prefixedLetter) {
    const optionIndex = prefixedLetter[1].charCodeAt(0) - 'a'.charCodeAt(0)
    return options[optionIndex]?.trim() ? `option${optionIndex + 1}` : ''
  }

  const labelMap = {
    a: 0,
    b: 1,
    c: 2,
    d: 3,
    '1': 0,
    '2': 1,
    '3': 2,
    '4': 3,
    option1: 0,
    option2: 1,
    option3: 2,
    option4: 3,
  }
  if (Object.prototype.hasOwnProperty.call(labelMap, lowerCorrectAnswer)) {
    const optionIndex = labelMap[lowerCorrectAnswer]
    return options[optionIndex]?.trim() ? `option${optionIndex + 1}` : ''
  }

  const matchIndex = options.findIndex((option) => option.trim() === correctAnswer)
  return matchIndex >= 0 && options[matchIndex].trim() ? `option${matchIndex + 1}` : ''
}

function getHeaderIndexes(header) {
  const indexMap = {}
  questionCsvHeaders.forEach((field) => {
    indexMap[field] = header.findIndex((value) => csvHeaderAliases[field].includes(value))
  })
  return indexMap
}

function getMappedValue(values, indexMap, field) {
  const index = indexMap[field]
  return index >= 0 ? values[index] ?? '' : ''
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
  const exactHeader =
    header.length === questionCsvHeaders.length &&
    questionCsvHeaders.every((field, index) => header[index] === field)
  const headerIndexes = exactHeader ? null : getHeaderIndexes(header)
  const hasMappedHeader =
    headerIndexes &&
    ['question', 'option1', 'option2', 'correct_answer'].every((field) => headerIndexes[field] >= 0)
  const hasHeader = exactHeader || hasMappedHeader

  if (!hasHeader) {
    return {
      validRows: [],
      invalidRows: [
        ...invalidRows,
        {
          rowNumber: 1,
          errors: [`Header must include at least: question, option1, option2, correct_answer. Preferred format: ${questionCsvHeaders.join(',')}`],
        },
      ],
    }
  }

  const validRows = []
  const dataRows = rows.slice(1)

  dataRows.forEach((rawValues, index) => {
    const values = exactHeader ? normalizeQuestionCsvRow(rawValues) : rawValues.map((value) => value.trim())
    const [
      positionalQuestion = '',
      positionalOption1 = '',
      positionalOption2 = '',
      positionalOption3 = '',
      positionalOption4 = '',
      positionalCorrectAnswerRaw = '',
      positionalMarksRaw = '',
      positionalExplanation = '',
    ] = values
    const question = exactHeader ? positionalQuestion : getMappedValue(values, headerIndexes, 'question')
    const option1 = exactHeader ? positionalOption1 : getMappedValue(values, headerIndexes, 'option1')
    const option2 = exactHeader ? positionalOption2 : getMappedValue(values, headerIndexes, 'option2')
    const option3 = exactHeader ? positionalOption3 : getMappedValue(values, headerIndexes, 'option3')
    const option4 = exactHeader ? positionalOption4 : getMappedValue(values, headerIndexes, 'option4')
    const correctAnswerRaw = exactHeader
      ? positionalCorrectAnswerRaw
      : getMappedValue(values, headerIndexes, 'correct_answer')
    const marksRaw = exactHeader ? positionalMarksRaw : getMappedValue(values, headerIndexes, 'marks')
    const explanation = exactHeader
      ? positionalExplanation
      : getMappedValue(values, headerIndexes, 'explanation')
    const errors = []
    const marks = marksRaw ? Number(marksRaw) : 1
    const options = [option1, option2, option3, option4]
    const filledOptionCount = options.filter((option) => option.trim()).length
    const correctAnswer = getCorrectAnswerField(correctAnswerRaw || '', options)

    if (exactHeader && values.length < 6) errors.push(`expected at least 6 columns, found ${values.length}`)
    if (!question) errors.push('question is required')
    if (filledOptionCount < 2) errors.push('at least 2 options are required')
    if (!correctAnswerRaw) errors.push('correct_answer is required')
    if (correctAnswerRaw && !correctAnswer) {
      errors.push('correct_answer must match an option exactly, A-D, option1-option4, or 1-4')
    }
    if (marksRaw && Number.isNaN(marks)) errors.push('marks must be numeric')
    if (!Number.isNaN(marks) && marks < 1) errors.push('marks must be at least 1')

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
