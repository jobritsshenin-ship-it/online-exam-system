import { createElement, useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  Flag,
  Loader2,
  LogOut,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react'
import { ExamBuilder } from './components/admin/ExamBuilder'
import { ExportResultsPanel } from './components/admin/ExportResultsPanel'
import './index.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'
const AUTH_STORAGE_KEY = 'exam_portal_auth'

const demoAccounts = {
  student: {
    email: 'student@example.com',
    password: 'Student@123',
  },
  admin: {
    email: 'admin@example.com',
    password: 'Admin@123',
  },
}

function formatApiErrorDetail(detail) {
  if (typeof detail === 'string') {
    return detail
  }

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === 'string') return item
        const location = Array.isArray(item.loc) ? item.loc.join('.') : ''
        const message = item.msg ?? JSON.stringify(item)
        return location ? `${location}: ${message}` : message
      })
      .join(' ')
  }

  if (detail && typeof detail === 'object') {
    return detail.message ?? JSON.stringify(detail)
  }

  return ''
}

async function apiRequest(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.'
    try {
      const data = await response.json()
      message = formatApiErrorDetail(data.detail) || message
    } catch {
      message = response.statusText || message
    }
    throw new Error(message)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

function readStoredAuth() {
  try {
    const value = localStorage.getItem(AUTH_STORAGE_KEY)
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

function mapSubmissionAnswers(submission) {
  const answers = {}
  const review = {}
  for (const answer of submission?.answers ?? []) {
    if (answer.selected_option_id) {
      answers[answer.question_id] = answer.selected_option_id
    }
    review[answer.question_id] = answer.is_marked_for_review
  }
  return { answers, review }
}

function App() {
  const [auth, setAuth] = useState(readStoredAuth)

  function handleAuthenticated(nextAuth) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth))
    setAuth(nextAuth)
  }

  function handleLogout() {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setAuth(null)
  }

  if (!auth) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />
  }

  return (
    <div className="app-shell">
      <TopBar user={auth.user} onLogout={handleLogout} />
      {auth.user.role === 'admin' ? (
        <AdminDashboard token={auth.access_token} />
      ) : (
        <StudentDashboard token={auth.access_token} user={auth.user} />
      )}
    </div>
  )
}

function LoginScreen({ onAuthenticated }) {
  const [credentials, setCredentials] = useState(demoAccounts.student)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(event) {
    event.preventDefault()
    setError('')
    setIsLoading(true)
    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: credentials,
      })
      onAuthenticated(data)
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  function fillDemoAccount(account) {
    setCredentials(demoAccounts[account])
    setError('')
  }

  return (
    <main className="login-layout">
      <section className="brand-panel" aria-label="Online examination portal">
        <div className="brand-mark">
          <BookOpenCheck size={34} aria-hidden="true" />
        </div>
        <p className="eyebrow">Online Examination System</p>
        <h1>Exam control room</h1>
        <p className="brand-copy">
          Secure sign-in for students and administrators, with live access to published exams.
        </p>
        <div className="signal-strip">
          <span>JWT auth</span>
          <span>PostgreSQL</span>
          <span>Redis ready</span>
        </div>
      </section>

      <section className="login-card" aria-label="Sign in">
        <div className="section-heading compact">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <p className="eyebrow">Sign in</p>
            <h2>Continue to dashboard</h2>
          </div>
        </div>

        <div className="segmented-control" aria-label="Demo account">
          <button type="button" onClick={() => fillDemoAccount('student')}>
            <UserRound size={16} aria-hidden="true" />
            Student
          </button>
          <button type="button" onClick={() => fillDemoAccount('admin')}>
            <ShieldCheck size={16} aria-hidden="true" />
            Admin
          </button>
        </div>

        <form className="form-grid" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={credentials.email}
              onChange={(event) =>
                setCredentials((current) => ({ ...current, email: event.target.value }))
              }
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={credentials.password}
              onChange={(event) =>
                setCredentials((current) => ({ ...current, password: event.target.value }))
              }
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="form-error">{error}</p> : null}
          <button className="primary-button" type="submit" disabled={isLoading}>
            {isLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : null}
            Sign in
          </button>
        </form>
      </section>
    </main>
  )
}

function TopBar({ user, onLogout }) {
  return (
    <header className="topbar">
      <div className="topbar-brand">
        <BookOpenCheck size={26} aria-hidden="true" />
        <div>
          <strong>Online Examination System</strong>
          <span>{user.role === 'admin' ? 'Administrator workspace' : 'Student workspace'}</span>
        </div>
      </div>
      <div className="topbar-actions">
        <span className="user-pill">
          <UserRound size={16} aria-hidden="true" />
          {user.full_name}
        </span>
        <button className="icon-button" type="button" onClick={onLogout} title="Sign out">
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}

function StudentDashboard({ token, user }) {
  const [exams, setExams] = useState([])
  const [activeExam, setActiveExam] = useState(null)
  const [activeSubmission, setActiveSubmission] = useState(null)
  const [answers, setAnswers] = useState({})
  const [review, setReview] = useState({})
  const [result, setResult] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [status, setStatus] = useState({ loading: true, error: '', success: '' })

  const selectedCount = Object.values(answers).filter(Boolean).length
  const reviewCount = Object.values(review).filter(Boolean).length
  const totalQuestions = activeExam?.questions?.length ?? 0
  const canSubmit = activeExam && selectedCount === totalQuestions && totalQuestions > 0

  const loadStudentData = useCallback(async () => {
    setStatus({ loading: true, error: '', success: '' })
    try {
      const [examData, submissionData] = await Promise.all([
        apiRequest('/exams', { token }),
        apiRequest('/exams/submissions/me', { token }),
      ])
      setExams(examData)
      setSubmissions(submissionData)
    } catch (err) {
      setStatus({ loading: false, error: err.message, success: '' })
      return
    }
    setStatus({ loading: false, error: '', success: '' })
  }, [token])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStudentData()
  }, [loadStudentData])

  const reportEvent = useCallback(
    async (eventType, details) => {
      if (!activeExam) return
      try {
        await apiRequest(`/exams/${activeExam.id}/proctoring-events`, {
          method: 'POST',
          token,
          body: { event_type: eventType, details },
        })
      } catch {
        // Proctor events should not interrupt the exam-taking flow.
      }
    },
    [activeExam, token],
  )

  async function startExam(exam) {
    setStatus({ loading: true, error: '', success: '' })
    try {
      const submission = await apiRequest(`/exams/${exam.id}/start`, { method: 'POST', token })
      const mapped = mapSubmissionAnswers(submission)
      setActiveExam(exam)
      setActiveSubmission(submission)
      setAnswers(mapped.answers)
      setReview(mapped.review)
      setResult(null)
    } catch (err) {
      setStatus({ loading: false, error: err.message, success: '' })
      return
    }
    setStatus({ loading: false, error: '', success: '' })
  }

  async function saveAnswer(questionId, optionId = answers[questionId] ?? null, shouldReview = review[questionId] ?? false) {
    if (!activeExam) return
    setStatus((current) => ({ ...current, loading: true, error: '', success: '' }))
    try {
      const submission = await apiRequest(`/exams/${activeExam.id}/answers`, {
        method: 'POST',
        token,
        body: {
          question_id: questionId,
          selected_option_id: optionId,
          is_marked_for_review: shouldReview,
        },
      })
      const mapped = mapSubmissionAnswers(submission)
      setActiveSubmission(submission)
      setAnswers(mapped.answers)
      setReview(mapped.review)
      setStatus({ loading: false, error: '', success: 'Answer saved.' })
    } catch (err) {
      setStatus({ loading: false, error: err.message, success: '' })
    }
  }

  async function clearAnswer(questionId) {
    const nextAnswers = { ...answers }
    delete nextAnswers[questionId]
    const nextReview = { ...review, [questionId]: false }
    setAnswers(nextAnswers)
    setReview(nextReview)
    await saveAnswer(questionId, null, false)
  }

  async function toggleReview(questionId) {
    const nextReviewValue = !review[questionId]
    setReview((current) => ({ ...current, [questionId]: nextReviewValue }))
    await saveAnswer(questionId, answers[questionId] ?? null, nextReviewValue)
  }

  async function submitExam() {
    if (!canSubmit) return
    setStatus({ loading: true, error: '', success: '' })
    try {
      const data = await apiRequest(`/exams/${activeExam.id}/submit`, {
        method: 'POST',
        token,
        body: {
          answers: Object.entries(answers).map(([questionId, optionId]) => ({
            question_id: Number(questionId),
            selected_option_id: optionId,
          })),
        },
      })
      setResult(data)
      setActiveExam(null)
      setActiveSubmission(null)
      setAnswers({})
      setReview({})
      await loadStudentData()
    } catch (err) {
      setStatus({ loading: false, error: err.message, success: '' })
    }
  }

  return (
    <main className="workspace">
      <section className="dashboard-hero">
        <div>
          <p className="eyebrow">Welcome back</p>
          <h1>{user.full_name}</h1>
          <p>Published exams appear here as soon as an administrator opens them.</p>
        </div>
        <div className="metric-row">
          <Metric label="Available" value={exams.length} />
          <Metric label="Submissions" value={submissions.length} />
          <Metric label="For review" value={reviewCount} />
        </div>
      </section>

      {status.error ? <p className="notice error">{status.error}</p> : null}
      {status.success ? <p className="notice success">{status.success}</p> : null}

      {activeExam ? (
        <ExamAttempt
          exam={activeExam}
          submission={activeSubmission}
          answers={answers}
          review={review}
          setAnswers={setAnswers}
          selectedCount={selectedCount}
          canSubmit={canSubmit}
          isLoading={status.loading}
          onSave={saveAnswer}
          onClear={clearAnswer}
          onToggleReview={toggleReview}
          onSubmit={submitExam}
          onCancel={() => setActiveExam(null)}
          onProctorEvent={reportEvent}
        />
      ) : (
        <section className="content-grid">
          <div className="main-column">
            <SectionTitle icon={ClipboardList} eyebrow="Student exams" title="Available exams" />
            {status.loading ? <LoadingBlock label="Loading exams" /> : null}
            <div className="exam-list">
              {exams.map((exam) => (
                <article className="exam-card" key={exam.id}>
                  <div>
                    <h3>{exam.title}</h3>
                    <p>{exam.description}</p>
                  </div>
                  <div className="exam-meta">
                    <span>{exam.duration_minutes} min</span>
                    <span>{exam.questions.length} questions</span>
                  </div>
                  <button className="primary-button" type="button" onClick={() => startExam(exam)}>
                    Start exam
                  </button>
                </article>
              ))}
              {!status.loading && exams.length === 0 ? (
                <p className="empty-state">No published exams are available right now.</p>
              ) : null}
            </div>
          </div>

          <aside className="side-column">
            <SectionTitle icon={CheckCircle2} eyebrow="Results" title="Recent submissions" />
            {result ? (
              <div className="result-panel">
                <strong>Latest score</strong>
                <span>{result.score} marks</span>
              </div>
            ) : null}
            <div className="submission-list">
              {submissions.map((submission) => (
                <div className="submission-item" key={submission.id}>
                  <span>Exam #{submission.exam_id}</span>
                  <strong>{submission.score ?? 0} marks</strong>
                </div>
              ))}
              {submissions.length === 0 ? (
                <p className="empty-state">Submitted exams will appear here.</p>
              ) : null}
            </div>
          </aside>
        </section>
      )}
    </main>
  )
}

function ExamAttempt({
  exam,
  submission,
  answers,
  review,
  setAnswers,
  selectedCount,
  canSubmit,
  isLoading,
  onSave,
  onClear,
  onToggleReview,
  onSubmit,
  onCancel,
  onProctorEvent,
}) {
  useEffect(() => {
    function logVisibility() {
      if (document.visibilityState === 'hidden') {
        void onProctorEvent('tab_hidden', 'Student switched away from the exam tab.')
      }
    }
    function logBlur() {
      void onProctorEvent('window_blur', 'Browser window lost focus during the exam.')
    }
    function logClipboard(event) {
      void onProctorEvent(event.type, `Clipboard event detected: ${event.type}.`)
    }

    document.addEventListener('visibilitychange', logVisibility)
    window.addEventListener('blur', logBlur)
    document.addEventListener('copy', logClipboard)
    document.addEventListener('paste', logClipboard)
    document.addEventListener('contextmenu', logClipboard)

    return () => {
      document.removeEventListener('visibilitychange', logVisibility)
      window.removeEventListener('blur', logBlur)
      document.removeEventListener('copy', logClipboard)
      document.removeEventListener('paste', logClipboard)
      document.removeEventListener('contextmenu', logClipboard)
    }
  }, [onProctorEvent])

  return (
    <section className="attempt-layout">
      <div className="attempt-header">
        <div>
          <p className="eyebrow">In progress</p>
          <h2>{exam.title}</h2>
          <p>
            {exam.duration_minutes} minutes · attempt #{submission?.id}
          </p>
        </div>
        <div className="attempt-actions">
          <span className="progress-pill">
            {selectedCount}/{exam.questions.length} answered
          </span>
          <button className="secondary-button" type="button" onClick={onCancel}>
            Leave
          </button>
        </div>
      </div>

      <div className="question-status-grid" aria-label="Question status">
        {exam.questions.map((question, index) => (
          <span
            className={`question-status ${answers[question.id] ? 'answered' : ''} ${review[question.id] ? 'review' : ''}`}
            key={question.id}
          >
            {index + 1}
          </span>
        ))}
      </div>

      <div className="question-stack">
        {exam.questions.map((question, index) => (
          <fieldset className="question-panel" key={question.id}>
            <legend>
              {index + 1}. {question.prompt}
            </legend>
            <div className="option-grid">
              {question.options.map((option) => (
                <label className="option-row" key={option.id}>
                  <input
                    type="radio"
                    name={`question-${question.id}`}
                    checked={answers[question.id] === option.id}
                    onChange={() =>
                      setAnswers((current) => ({ ...current, [question.id]: option.id }))
                    }
                  />
                  <span>{option.text}</span>
                </label>
              ))}
            </div>
            <div className="answer-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={() => onSave(question.id)}
                disabled={isLoading}
              >
                <Save size={16} aria-hidden="true" />
                Save
              </button>
              <button
                className="secondary-button"
                type="button"
                onClick={() => onClear(question.id)}
                disabled={isLoading}
              >
                <Trash2 size={16} aria-hidden="true" />
                Unsave
              </button>
              <button
                className={`secondary-button ${review[question.id] ? 'review-active' : ''}`}
                type="button"
                onClick={() => onToggleReview(question.id)}
                disabled={isLoading}
              >
                <Flag size={16} aria-hidden="true" />
                {review[question.id] ? 'Unmark review' : 'Review'}
              </button>
            </div>
          </fieldset>
        ))}
      </div>

      <button
        className="primary-button submit-button"
        type="button"
        disabled={!canSubmit || isLoading}
        onClick={onSubmit}
      >
        {isLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
        Submit exam
      </button>
    </section>
  )
}

function AdminDashboard({ token }) {
  const [exams, setExams] = useState([])
  const [selectedExam, setSelectedExam] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [status, setStatus] = useState({ loading: true, error: '', success: '' })

  const loadAdminData = useCallback(
    async (examId = null) => {
      setStatus((current) => ({ ...current, loading: true, error: '' }))
      try {
        const examData = await apiRequest('/exams', { token })
        setExams(examData)
        const nextExamId = examId ?? examData[0]?.id
        if (nextExamId) {
          const [detailedExam, submissionData] = await Promise.all([
            apiRequest(`/exams/${nextExamId}/admin`, { token }),
            apiRequest(`/exams/${nextExamId}/submissions`, { token }),
          ])
          setSelectedExam(detailedExam)
          setSubmissions(submissionData)
        }
      } catch (err) {
        setStatus({ loading: false, error: err.message, success: '' })
        return
      }
      setStatus({ loading: false, error: '', success: '' })
    },
    [token],
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAdminData(null)
  }, [loadAdminData])

  async function selectExam(examId) {
    await loadAdminData(examId)
  }

  async function persistBuilderDraft(draft, publishAfterSave = false) {
    if (!draft.metadata.title) {
      setStatus({ loading: false, error: 'Exam title is required.', success: '' })
      return
    }

    if (publishAfterSave && draft.questions.length === 0) {
      setStatus({ loading: false, error: 'Add at least one complete question before publishing.', success: '' })
      return
    }

    setStatus({ loading: true, error: '', success: '' })
    try {
      const metadata = {
        title: draft.metadata.title,
        subject: draft.metadata.subject,
        description: draft.metadata.description,
        duration_minutes: draft.metadata.duration_minutes,
      }
      let examId = draft.examId
      const wasPublished = Boolean(
        examId && selectedExam?.id === examId && selectedExam.is_published,
      )
      const shouldPublishAfterPersist = publishAfterSave || draft.metadata.is_published

      if (examId) {
        if (wasPublished) {
          await apiRequest(`/exams/${examId}/publish`, {
            method: 'PATCH',
            token,
            body: { is_published: false },
          })
        }
        await apiRequest(`/exams/${examId}`, {
          method: 'PATCH',
          token,
          body: metadata,
        })
      } else {
        const createdExam = await apiRequest('/exams', {
          method: 'POST',
          token,
          body: { ...metadata, is_published: false },
        })
        examId = createdExam.id
      }

      const existingQuestions = draft.questions.filter((question) => question.id)
      const newQuestions = draft.questions.filter((question) => !question.id)

      await Promise.all(
        existingQuestions.map((question) =>
          apiRequest(`/exams/${examId}/questions/${question.id}`, {
            method: 'PUT',
            token,
            body: {
              prompt: question.prompt,
              explanation: question.explanation,
              question_type: question.question_type,
              marks: question.marks,
              sort_order: question.sort_order,
              options: question.options,
            },
          }),
        ),
      )

      if (newQuestions.length > 0) {
        await apiRequest(`/exams/${examId}/questions/bulk`, {
          method: 'POST',
          token,
          body: {
            questions: newQuestions,
          },
        })
      }

      if (shouldPublishAfterPersist) {
        await apiRequest(`/exams/${examId}/publish`, {
          method: 'PATCH',
          token,
          body: { is_published: true },
        })
      }

      setStatus({
        loading: false,
        error: '',
        success: shouldPublishAfterPersist ? 'Exam published.' : 'Draft saved.',
      })
      await loadAdminData(examId)
    } catch (err) {
      setStatus({ loading: false, error: err.message, success: '' })
    }
  }

  async function deleteBuilderQuestion(questionId) {
    if (!selectedExam) return
    setStatus({ loading: true, error: '', success: '' })
    try {
      await apiRequest(`/exams/${selectedExam.id}/questions/${questionId}`, {
        method: 'DELETE',
        token,
      })
      setStatus({ loading: false, error: '', success: 'Question deleted.' })
      await loadAdminData(selectedExam.id)
    } catch (err) {
      setStatus({ loading: false, error: err.message, success: '' })
    }
  }

  async function togglePublished(exam) {
    setStatus({ loading: true, error: '', success: '' })
    try {
      await apiRequest(`/exams/${exam.id}/publish`, {
        method: 'PATCH',
        token,
        body: { is_published: !exam.is_published },
      })
      await loadAdminData(exam.id)
    } catch (err) {
      setStatus({ loading: false, error: err.message, success: '' })
    }
  }

  return (
    <main className="workspace">
      <section className="dashboard-hero admin">
        <div>
          <p className="eyebrow">Administrator</p>
          <h1>Exam management</h1>
          <p>Create, import, review submissions, and investigate suspicious activity.</p>
        </div>
        <div className="metric-row">
          <Metric label="Exams" value={exams.length} />
          <Metric label="Published" value={exams.filter((exam) => exam.is_published).length} />
          <Metric label="Flags" value={submissions.reduce((total, item) => total + item.cheat_event_count, 0)} />
        </div>
      </section>

      {status.error ? <p className="notice error">{status.error}</p> : null}
      {status.success ? <p className="notice success">{status.success}</p> : null}

      <section className="content-grid admin-grid">
        <div className="main-column">
          <SectionTitle icon={ClipboardList} eyebrow="Catalog" title="All exams" />
          {status.loading && exams.length === 0 ? <LoadingBlock label="Loading exams" /> : null}
          <div className="exam-list">
            {exams.map((exam) => (
              <article
                className={`exam-card selectable ${selectedExam?.id === exam.id ? 'selected' : ''}`}
                key={exam.id}
              >
                <button className="blank-button" type="button" onClick={() => selectExam(exam.id)}>
                  <h3>{exam.title}</h3>
                  <p>{exam.description}</p>
                </button>
                <div className="exam-meta">
                  <span>{exam.duration_minutes} min</span>
                  <span>{exam.questions.length} questions</span>
                  <span>{exam.is_published ? 'Published' : 'Draft'}</span>
                </div>
                <button className="secondary-button" type="button" onClick={() => togglePublished(exam)}>
                  {exam.is_published ? 'Unpublish' : 'Publish'}
                </button>
              </article>
            ))}
          </div>
        </div>

        <aside className="side-column forms-column">
          <ExamBuilder
            selectedExam={selectedExam}
            isSaving={status.loading}
            onSaveDraft={(draft) => persistBuilderDraft(draft, false)}
            onPublish={(draft) => persistBuilderDraft(draft, true)}
            onDeleteQuestion={deleteBuilderQuestion}
          />
        </aside>
      </section>

      {selectedExam ? (
        <>
          <AdminExamDetails exam={selectedExam} />
          <ExportResultsPanel
            exams={exams}
            selectedExam={selectedExam}
            submissions={submissions}
            onSelectExam={selectExam}
          />
          <SubmissionReviewPanel submissions={submissions} />
        </>
      ) : null}
    </main>
  )
}

function AdminExamDetails({ exam }) {
  return (
    <section className="details-band">
      <SectionTitle icon={BookOpenCheck} eyebrow="Selected exam" title={exam.title} />
      <div className="question-stack compact-stack">
        {exam.questions.map((question, index) => (
          <article className="question-panel" key={question.id}>
            <div className="panel-title-row">
              <h3>
                {index + 1}. {question.prompt}
              </h3>
              <span className="review-note">{question.marks} mark{question.marks === 1 ? '' : 's'}</span>
            </div>
            <div className="option-grid">
              {question.options.map((option) => (
                <div className={`option-row read-only ${option.is_correct ? 'correct' : ''}`} key={option.id}>
                  <span>{option.text}</span>
                  {option.is_correct ? <CheckCircle2 size={16} aria-label="Correct answer" /> : null}
                </div>
              ))}
            </div>
          </article>
        ))}
        {exam.questions.length === 0 ? <p className="empty-state">No questions yet.</p> : null}
      </div>
    </section>
  )
}

function SubmissionReviewPanel({ submissions }) {
  function getStudentDetails(submission) {
    return [
      submission.student_register_number,
      submission.student_department,
      submission.student_batch,
      submission.student_class_name,
    ]
      .filter(Boolean)
      .join(' - ')
  }

  return (
    <section className="details-band">
      <SectionTitle icon={Users} eyebrow="Student work" title="Submitted answers and flags" />
      <div className="submission-review-list">
        {submissions.map((submission) => (
          <article className="submission-review-card" key={submission.id}>
            <div className="panel-title-row">
              <div>
                <h3>{submission.student_full_name}</h3>
                <p className="empty-state">{submission.student_email}</p>
                {getStudentDetails(submission) ? (
                  <p className="empty-state">{getStudentDetails(submission)}</p>
                ) : null}
              </div>
              <div className="exam-meta">
                <span>{submission.status}</span>
                <span>{submission.score ?? 0} marks</span>
                <span className={submission.cheat_event_count ? 'flag-pill' : ''}>
                  {submission.cheat_event_count} flags
                </span>
              </div>
            </div>

            {submission.cheat_event_count ? (
              <div className="cheat-panel">
                <AlertTriangle size={18} aria-hidden="true" />
                <div>
                  <strong>Suspicious activity</strong>
                  {submission.events.map((event) => (
                    <p key={event.id}>
                      {event.event_type}: {event.details}
                    </p>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="answer-review-grid">
              {submission.answers.map((answer) => (
                <div className={`answer-review-item ${answer.is_correct ? 'correct' : 'wrong'}`} key={answer.id}>
                  <strong>{answer.question_prompt}</strong>
                  <span>Selected: {answer.selected_option_text ?? 'Not answered'}</span>
                  <span>Correct: {answer.correct_option_text ?? 'Not set'}</span>
                  <span>{answer.marks_awarded} marks</span>
                  {answer.is_marked_for_review ? <span className="review-note">Marked for review</span> : null}
                </div>
              ))}
            </div>
          </article>
        ))}
        {submissions.length === 0 ? <p className="empty-state">No submissions for this exam yet.</p> : null}
      </div>
    </section>
  )
}

function SectionTitle({ icon, eyebrow, title }) {
  return (
    <div className="section-heading">
      {createElement(icon, { size: 20, 'aria-hidden': 'true' })}
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function LoadingBlock({ label }) {
  return (
    <div className="loading-block">
      <Loader2 className="spin" size={18} aria-hidden="true" />
      {label}
    </div>
  )
}

export default App
