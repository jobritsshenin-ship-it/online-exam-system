import { Copy, Trash2 } from 'lucide-react'

const optionFields = ['option1', 'option2', 'option3', 'option4']

export function QuestionEditor({
  question,
  index,
  disabled,
  onChange,
  onDelete,
  onDuplicate,
}) {
  if (!question) {
    return (
      <div className="question-editor empty-editor">
        <p className="empty-state">Generate or add a question to start editing.</p>
      </div>
    )
  }

  return (
    <div className="question-editor">
      <div className="panel-title-row">
        <div>
          <p className="eyebrow">Question {index + 1}</p>
          <h3>MCQ editor</h3>
        </div>
        <div className="answer-actions">
          <button className="secondary-button" type="button" onClick={onDuplicate} disabled={disabled}>
            <Copy size={16} aria-hidden="true" />
            Duplicate
          </button>
          <button className="secondary-button danger-button" type="button" onClick={onDelete} disabled={disabled}>
            <Trash2 size={16} aria-hidden="true" />
            Delete
          </button>
        </div>
      </div>

      <label>
        Question text
        <textarea
          value={question.question}
          onChange={(event) => onChange({ question: event.target.value })}
          rows="4"
          disabled={disabled}
        />
      </label>

      <div className="builder-two-column">
        {optionFields.map((field, optionIndex) => (
          <label key={field}>
            Option {optionIndex + 1}
            <input
              value={question[field]}
              onChange={(event) => onChange({ [field]: event.target.value })}
              disabled={disabled}
            />
          </label>
        ))}
      </div>

      <div className="builder-two-column compact-fields">
        <label>
          Correct answer
          <select
            value={question.correctAnswer}
            onChange={(event) => onChange({ correctAnswer: event.target.value })}
            disabled={disabled}
          >
            {optionFields.map((field, optionIndex) => (
              <option value={field} key={field}>
                Option {optionIndex + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          Marks
          <input
            type="number"
            min="1"
            value={question.marks}
            onChange={(event) => onChange({ marks: Number(event.target.value) })}
            disabled={disabled}
          />
        </label>
      </div>

      <label>
        Explanation
        <textarea
          value={question.explanation}
          onChange={(event) => onChange({ explanation: event.target.value })}
          rows="3"
          disabled={disabled}
        />
      </label>
    </div>
  )
}
