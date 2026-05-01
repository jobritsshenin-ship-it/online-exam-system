import { useRef, useState } from 'react'
import { Download, FileText, Loader2, Upload } from 'lucide-react'

export function WordImportPanel({ disabled, hasSavedExam, onImport }) {
  const [selectedFile, setSelectedFile] = useState(null)
  const [isUploading, setIsUploading] = useState(false)
  const [summary, setSummary] = useState(null)
  const fileInputRef = useRef(null)

  async function handleImport() {
    if (!selectedFile || disabled || isUploading) return
    setIsUploading(true)
    setSummary(null)
    try {
      const result = await onImport(selectedFile)
      setSummary(result)
      setSelectedFile(null)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <section className="builder-block">
      <div className="section-heading compact">
        <FileText size={20} aria-hidden="true" />
        <div>
          <p className="eyebrow">Word import</p>
          <h3>Import questions from .docx</h3>
        </div>
      </div>

      <div className="template-actions">
        <a className="secondary-button" href="/templates/word_question_import_template.docx" download>
          <Download size={16} aria-hidden="true" />
          Download Word Template
        </a>
      </div>

      <p className="csv-format">
        Supported format: Q1 question lines, A-D options, Answer, optional Marks, and optional Explanation.
      </p>

      <div className="word-import-row">
        <input
          ref={fileInputRef}
          type="file"
          accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          disabled={disabled || isUploading || !hasSavedExam}
          onChange={(event) => {
            setSelectedFile(event.target.files?.[0] ?? null)
            setSummary(null)
          }}
        />
        <button
          className="primary-button"
          type="button"
          onClick={handleImport}
          disabled={disabled || isUploading || !hasSavedExam || !selectedFile}
        >
          {isUploading ? <Loader2 className="spin" size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          Import Word (.docx)
        </button>
      </div>

      {!hasSavedExam ? (
        <p className="empty-state">Save the exam draft before importing a Word file.</p>
      ) : null}

      {summary ? (
        <div className={summary.invalid_count > 0 ? 'notice error' : 'notice success'}>
          <p>
            {summary.created_count} created, {summary.valid_count} valid block
            {summary.valid_count === 1 ? '' : 's'}, {summary.invalid_count} invalid block
            {summary.invalid_count === 1 ? '' : 's'}.
          </p>
          {summary.blocks
            ?.filter((block) => !block.valid)
            .slice(0, 5)
            .map((block) => (
              <p key={block.block_number}>
                Block {block.block_number}: {block.errors.join(', ')}
              </p>
            ))}
        </div>
      ) : null}
    </section>
  )
}
