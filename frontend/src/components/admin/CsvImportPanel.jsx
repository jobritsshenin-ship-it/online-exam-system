import { useMemo, useState } from 'react'
import { Download, FileUp } from 'lucide-react'
import { parseQuestionCsv, questionCsvHeaders } from '../../utils/csv'

export function CsvImportPanel({ disabled, onImport }) {
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState('')
  const [validRows, setValidRows] = useState([])
  const [invalidRows, setInvalidRows] = useState([])

  const hasParsedRows = validRows.length > 0 || invalidRows.length > 0

  const expectedFormat = useMemo(
    () => questionCsvHeaders.join(','),
    [],
  )

  async function parseFile(file) {
    if (!file) return
    const text = await file.text()
    const parsed = parseQuestionCsv(text)
    setFileName(file.name)
    setValidRows(parsed.validRows)
    setInvalidRows(parsed.invalidRows)
  }

  function handleDrop(event) {
    event.preventDefault()
    setIsDragging(false)
    void parseFile(event.dataTransfer.files?.[0])
  }

  function importValidRows() {
    if (validRows.length === 0) return
    onImport(validRows)
    setValidRows([])
    setInvalidRows([])
    setFileName('')
  }

  return (
    <section className="builder-block">
      <div className="section-heading compact">
        <FileUp size={20} aria-hidden="true" />
        <div>
          <p className="eyebrow">CSV import</p>
          <h3>Import questions into draft</h3>
        </div>
      </div>

      <div className="template-actions">
        <a className="secondary-button" href="/templates/question_import_template.csv" download>
          <Download size={16} aria-hidden="true" />
          Download CSV Template
        </a>
      </div>

      <div
        className={`csv-dropzone ${isDragging ? 'dragging' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
      >
        <FileUp size={24} aria-hidden="true" />
        <strong>Drop CSV file here</strong>
        <span>or select a file</span>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={disabled}
          onChange={(event) => void parseFile(event.target.files?.[0])}
        />
      </div>

      <p className="csv-format">
        Format: <code>{expectedFormat}</code>
      </p>
      <p className="csv-format">
        <strong>Required columns:</strong> question, option1, option2, option3, option4,
        correct_answer, marks, explanation.
      </p>
      <ul className="import-rules">
        <li>question is required.</li>
        <li>at least 2 options are required.</li>
        <li>correct_answer may be exact option text, A/B/C/D, option1-option4, or 1/2/3/4.</li>
        <li>marks defaults to 1 if empty.</li>
        <li>explanation is optional.</li>
      </ul>
      <p className="csv-format">
        Example:{' '}
        <code>"What protocol assigns IP addresses?","DNS","FTP","DHCP","ARP","DHCP",1,"DHCP assigns addresses."</code>
      </p>

      {fileName ? <p className="empty-state">Parsed file: {fileName}</p> : null}

      {hasParsedRows ? (
        <div className="csv-preview">
          <div className="csv-preview-header">
            <strong>{validRows.length} valid rows</strong>
            <span>{invalidRows.length} invalid rows</span>
          </div>

          {invalidRows.length > 0 ? (
            <div className="csv-errors">
              {invalidRows.map((row) => (
                <p key={row.rowNumber}>
                  Row {row.rowNumber}: {row.errors.join(', ')}
                </p>
              ))}
            </div>
          ) : null}

          {validRows.slice(0, 5).map((row, index) => (
            <div className="csv-row-preview" key={`${row.question}-${index}`}>
              <strong>{row.question}</strong>
              <span>
                Correct: {row.correctAnswerText} - {row.marks} mark{row.marks === 1 ? '' : 's'}
              </span>
            </div>
          ))}

          <button className="primary-button" type="button" onClick={importValidRows} disabled={validRows.length === 0}>
            Import valid rows
          </button>
        </div>
      ) : null}
    </section>
  )
}
