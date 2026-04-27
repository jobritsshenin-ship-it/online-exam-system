import { Plus } from 'lucide-react'

function getQuestionState(question) {
  if (!question.question?.trim()) return 'empty'
  if (!question.option1?.trim() || !question.option2?.trim() || !question.option3?.trim() || !question.option4?.trim()) {
    return 'incomplete'
  }
  return 'ready'
}

export function QuestionNavigator({ questions, activeIndex, onSelect, onAdd }) {
  return (
    <aside className="question-navigator" aria-label="Question navigator">
      <div className="navigator-header">
        <span className="navigator-label">Questions</span>
        <button className="icon-button compact-icon" type="button" onClick={onAdd} title="Add question">
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="navigator-list">
        {questions.map((question, index) => (
          <button
            className={`navigator-item ${activeIndex === index ? 'active' : ''} ${getQuestionState(question)}`}
            type="button"
            key={question.clientId}
            onClick={() => onSelect(index)}
          >
            {index + 1}
          </button>
        ))}
      </div>
    </aside>
  )
}
