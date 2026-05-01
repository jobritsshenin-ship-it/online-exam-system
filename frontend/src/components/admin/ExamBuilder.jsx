import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenCheck, CheckCircle2, FilePlus2, Plus, Rocket, Save } from 'lucide-react'
import { CsvImportPanel } from './CsvImportPanel'
import { QuestionEditor } from './QuestionEditor'
import { QuestionNavigator } from './QuestionNavigator'
import { WordImportPanel } from './WordImportPanel'

const emptyMetadata = {
  title: '',
  subject: '',
  description: '',
  duration_minutes: 30,
  is_published: false,
}

function createEmptyQuestion(index = 0) {
  return {
    clientId: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    backendId: null,
    question: '',
    option1: '',
    option2: '',
    option3: '',
    option4: '',
    optionIds: {},
    correctAnswer: 'option1',
    marks: 1,
    explanation: '',
    sortOrder: index + 1,
  }
}

function fromApiQuestion(question, index) {
  const options = [...question.options].sort((a, b) => a.sort_order - b.sort_order)
  const correctIndex = Math.max(0, options.findIndex((option) => option.is_correct))
  return {
    clientId: `backend-${question.id}`,
    backendId: question.id,
    question: question.prompt,
    option1: options[0]?.text ?? '',
    option2: options[1]?.text ?? '',
    option3: options[2]?.text ?? '',
    option4: options[3]?.text ?? '',
    optionIds: {
      option1: options[0]?.id ?? null,
      option2: options[1]?.id ?? null,
      option3: options[2]?.id ?? null,
      option4: options[3]?.id ?? null,
    },
    correctAnswer: `option${correctIndex + 1}`,
    marks: question.marks,
    explanation: question.explanation ?? '',
    sortOrder: question.sort_order || index + 1,
  }
}

function toApiQuestion(question, index) {
  const correctIndex = Number(question.correctAnswer.replace('option', '')) - 1
  const options = ['option1', 'option2', 'option3', 'option4']
    .map((field, optionIndex) => ({
      id: question.optionIds?.[field] ?? null,
      text: question[field].trim(),
      is_correct: optionIndex === correctIndex,
      sort_order: optionIndex + 1,
    }))
    .filter((option) => option.text)

  return {
    id: question.backendId,
    prompt: question.question.trim(),
    explanation: question.explanation?.trim() || null,
    question_type: 'mcq',
    marks: Number(question.marks || 1),
    sort_order: index + 1,
    options,
  }
}

function isCompleteQuestion(question) {
  const optionFields = ['option1', 'option2', 'option3', 'option4']
  const filledOptions = optionFields.filter((field) => question[field].trim())
  const selectedCorrectAnswer = question.correctAnswer

  return (
    question.question.trim() &&
    filledOptions.length >= 2 &&
    filledOptions.includes(selectedCorrectAnswer) &&
    Number(question.marks) > 0
  )
}

function isBlankLocalQuestion(question) {
  return (
    question &&
    !question.backendId &&
    !question.question.trim() &&
    !question.option1.trim() &&
    !question.option2.trim() &&
    !question.option3.trim() &&
    !question.option4.trim()
  )
}

function totalMarks(questions) {
  return questions.reduce((total, question) => total + Number(question.marks || 0), 0)
}

export function ExamBuilder({
  selectedExam,
  isSaving,
  onSaveDraft,
  onPublish,
  onDeleteQuestion,
  onImportWord,
}) {
  const [metadata, setMetadata] = useState(emptyMetadata)
  const [questions, setQuestions] = useState([createEmptyQuestion(0)])
  const [activeIndex, setActiveIndex] = useState(0)
  const [generateCount, setGenerateCount] = useState(10)
  const [importMessage, setImportMessage] = useState('')
  const questionsRef = useRef(questions)

  function setDraftQuestions(updater) {
    const nextQuestions =
      typeof updater === 'function' ? updater(questionsRef.current) : updater
    questionsRef.current = nextQuestions
    setQuestions(nextQuestions)
    return nextQuestions
  }

  useEffect(() => {
    if (!selectedExam) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMetadata(emptyMetadata)
      setDraftQuestions([createEmptyQuestion(0)])
      setActiveIndex(0)
      setImportMessage('')
      return
    }

    const nextQuestions =
      selectedExam.questions.length > 0
        ? selectedExam.questions.map(fromApiQuestion)
        : [createEmptyQuestion(0)]

    setMetadata({
      title: selectedExam.title,
      subject: selectedExam.subject ?? '',
      description: selectedExam.description ?? '',
      duration_minutes: selectedExam.duration_minutes,
      is_published: selectedExam.is_published,
    })
    setDraftQuestions(nextQuestions)
    setActiveIndex(0)
    setImportMessage('')
  }, [selectedExam])

  const completedCount = questions.filter(isCompleteQuestion).length
  const calculatedMarks = useMemo(() => totalMarks(questions), [questions])
  const isPublished = Boolean(selectedExam?.is_published)
  const hasTitle = Boolean(metadata.title.trim())
  const canSaveDraft = !isSaving && hasTitle
  const canPublish = !isSaving && hasTitle && completedCount > 0
  const validationMessages = [
    !hasTitle ? 'Exam title is required.' : '',
    completedCount === 0 ? 'At least one complete question is required before publishing.' : '',
  ].filter(Boolean)

  function updateMetadata(field, value) {
    setMetadata((current) => ({ ...current, [field]: value }))
  }

  function updateQuestion(index, updates) {
    setDraftQuestions((current) =>
      current.map((question, itemIndex) =>
        itemIndex === index ? { ...question, ...updates } : question,
      ),
    )
    setImportMessage('')
  }

  function generateQuestionSlots() {
    const count = Math.max(1, Number(generateCount || 1))
    const nextQuestions = setDraftQuestions((current) => {
      const baseQuestions =
        current.length === 1 && isBlankLocalQuestion(current[0]) ? [] : current
      const newSlots = Array.from({ length: count }, (_, index) =>
        createEmptyQuestion(baseQuestions.length + index),
      )
      return [...baseQuestions, ...newSlots]
    })
    setActiveIndex(Math.max(0, nextQuestions.length - count))
    setImportMessage('')
  }

  function addQuestion() {
    const nextQuestions = setDraftQuestions((current) => [
      ...current,
      createEmptyQuestion(current.length),
    ])
    setActiveIndex(nextQuestions.length - 1)
    setImportMessage('')
  }

  async function deleteQuestion(index) {
    const question = questionsRef.current[index]
    if (question?.backendId) {
      await onDeleteQuestion(question.backendId)
    }
    const nextQuestions = setDraftQuestions((current) => {
      const next = current.filter((_, itemIndex) => itemIndex !== index)
      return next.length > 0 ? next : [createEmptyQuestion(0)]
    })
    setActiveIndex((current) => Math.max(0, Math.min(current, nextQuestions.length - 1)))
    setImportMessage('')
  }

  function duplicateQuestion(index) {
    const question = questionsRef.current[index]
    const duplicate = {
      ...question,
      clientId: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      backendId: null,
      optionIds: {},
    }
    setDraftQuestions((current) => [
      ...current.slice(0, index + 1),
      duplicate,
      ...current.slice(index + 1),
    ])
    setActiveIndex(index + 1)
    setImportMessage('')
  }

  function importQuestions(rows) {
    const currentQuestions = questionsRef.current
    const imported = rows.map((row, index) => ({
      clientId: `csv-${Date.now()}-${index}`,
      backendId: null,
      question: row.question,
      option1: row.option1,
      option2: row.option2,
      option3: row.option3,
      option4: row.option4,
      correctAnswer: row.correctAnswer,
      marks: row.marks,
      explanation: row.explanation,
      sortOrder: currentQuestions.length + index + 1,
    }))
    const shouldReplaceBlank =
      currentQuestions.length === 1 &&
      !currentQuestions[0].backendId &&
      !currentQuestions[0].question.trim()

    setDraftQuestions((current) => {
      const shouldReplaceBlank =
        current.length === 1 && !current[0].backendId && !current[0].question.trim()
      return shouldReplaceBlank ? imported : [...current, ...imported]
    })
    setActiveIndex(shouldReplaceBlank ? 0 : currentQuestions.length)
    setImportMessage(`${imported.length} CSV question${imported.length === 1 ? '' : 's'} added to the exam draft.`)
  }

  function buildDraft() {
    const draftQuestions = questionsRef.current
    const completeQuestions = draftQuestions.filter(isCompleteQuestion).map(toApiQuestion)
    return {
      examId: selectedExam?.id ?? null,
      metadata: {
        ...metadata,
        title: metadata.title.trim(),
        subject: metadata.subject.trim() || null,
        description: metadata.description.trim() || null,
        duration_minutes: Number(metadata.duration_minutes),
      },
      questions: completeQuestions,
    }
  }

  return (
    <section className="exam-builder-module">
      <div className="builder-topbar">
        <div className="section-heading compact">
          <BookOpenCheck size={22} aria-hidden="true" />
          <div>
            <p className="eyebrow">Unified module</p>
            <h2>Exam Builder</h2>
          </div>
        </div>
        <div className="exam-meta">
          <span>{questions.length} slots</span>
          <span>{completedCount} ready</span>
          <span>{calculatedMarks} marks</span>
        </div>
      </div>

      <div className="builder-block">
        <div className="builder-two-column">
          <label>
            Exam title
            <input
              value={metadata.title}
              onChange={(event) => updateMetadata('title', event.target.value)}
            />
          </label>
          <label>
            Subject / category
            <input
              value={metadata.subject}
              onChange={(event) => updateMetadata('subject', event.target.value)}
            />
          </label>
        </div>
        <label>
          Description
          <textarea
            rows="3"
            value={metadata.description}
            onChange={(event) => updateMetadata('description', event.target.value)}
          />
        </label>
        <div className="builder-three-column">
          <label>
            Duration
            <input
              type="number"
              min="1"
              value={metadata.duration_minutes}
              onChange={(event) => updateMetadata('duration_minutes', event.target.value)}
            />
          </label>
          <label>
            Total marks
            <input value={calculatedMarks} disabled />
          </label>
          <label className="check-row builder-toggle">
            <input
              type="checkbox"
              checked={metadata.is_published}
              onChange={(event) => updateMetadata('is_published', event.target.checked)}
              disabled={isSaving}
            />
            Publish immediately
          </label>
        </div>
        {isPublished ? (
          <p className="empty-state">This exam is published. Updates are still allowed from this builder.</p>
        ) : null}
      </div>

      <div className="builder-block generation-row">
        <label>
          Number of questions
          <input
            type="number"
            min="1"
            value={generateCount}
            onChange={(event) => setGenerateCount(event.target.value)}
            disabled={isSaving}
          />
        </label>
        <button className="secondary-button" type="button" onClick={generateQuestionSlots} disabled={isSaving}>
          <FilePlus2 size={16} aria-hidden="true" />
          Generate slots
        </button>
        <button className="secondary-button" type="button" onClick={addQuestion} disabled={isSaving}>
          <Plus size={16} aria-hidden="true" />
          Add one
        </button>
      </div>

      <div className="builder-workspace">
        <QuestionNavigator
          questions={questions}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
          onAdd={addQuestion}
        />
        <QuestionEditor
          question={questions[activeIndex]}
          index={activeIndex}
          disabled={isSaving}
          onChange={(updates) => updateQuestion(activeIndex, updates)}
          onDelete={() => void deleteQuestion(activeIndex)}
          onDuplicate={() => duplicateQuestion(activeIndex)}
        />
      </div>

      <CsvImportPanel disabled={isSaving} onImport={importQuestions} />
      <WordImportPanel
        disabled={isSaving}
        hasSavedExam={Boolean(selectedExam?.id)}
        onImport={onImportWord}
      />
      {importMessage ? <p className="notice success">{importMessage}</p> : null}
      {isPublished ? (
        <p className="notice success">
          This exam is currently published. Saving changes will briefly unpublish it, apply the update,
          and publish it again when you use Publish / update exam.
        </p>
      ) : null}
      {validationMessages.length > 0 ? (
        <div className="notice error">
          {validationMessages.map((message) => (
            <p key={message}>{message}</p>
          ))}
        </div>
      ) : null}

      <div className="builder-actions">
        <button className="secondary-button" type="button" disabled={!canSaveDraft} onClick={() => onSaveDraft(buildDraft())}>
          <Save size={16} aria-hidden="true" />
          Save draft
        </button>
        <button className="primary-button" type="button" disabled={!canPublish} onClick={() => onPublish(buildDraft())}>
          {metadata.is_published ? <CheckCircle2 size={16} aria-hidden="true" /> : <Rocket size={16} aria-hidden="true" />}
          Publish / update exam
        </button>
      </div>
    </section>
  )
}
