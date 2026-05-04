import { createElement, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Archive,
  BookOpenCheck,
  CheckCircle2,
  ClipboardList,
  Download,
  Edit,
  Eye,
  Flag,
  KeyRound,
  Loader2,
  LogOut,
  PlusCircle,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserCheck,
  UserPlus,
  UserRound,
  UserX,
  Users,
  X,
} from 'lucide-react'
import { ExamBuilder } from './components/admin/ExamBuilder'
import { downloadCsv } from './utils/csv'
import './index.css'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000/api/v1'
const AUTH_STORAGE_KEY = 'exam_portal_auth'
const STUDENT_EMAIL_DOMAIN = '@stellamaryscoe.edu.in'
const COLLEGE_NAME = "Stella Mary's College of Engineering"
const PORTAL_TITLE = 'Skill Enhancement Exam Portal'
const SYSTEM_EXAM_WARNING = 'The exam will be submitted automatically when the timer ends. Leaving the exam screen will also submit your attempt.'
const DEFAULT_EXAM_INSTRUCTIONS = 'Read the exam instructions carefully before starting. Answer every question and keep the exam screen open until the timer ends.'
const EXAM_POLICY_POINTS = [
  'You cannot manually submit before the exam time ends.',
  'You cannot leave the exam screen during an active attempt.',
  'Your answers are saved as you select them.',
  'The exam will auto-submit when time expires.',
  'Leaving, refreshing, switching tabs, minimizing, or exiting fullscreen will auto-submit the exam.',
]
const DEPARTMENT_OPTIONS = ['CSE', 'AIDS', 'MECH', 'CIVIL', 'EEE', 'ECE', 'MBA', 'S&H']
const YEAR_OPTIONS = ['1st Year', '2nd Year', '3rd Year', '4th Year']

const createEmptyCredentials = () => ({
  email: '',
  password: '',
})

const createEmptySignup = () => ({
  full_name: '',
  institutional_email: '',
  register_number: '',
  department: '',
  year: '',
  password: '',
  confirmPassword: '',
})

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

class ApiError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

function isAuthExpiredError(error) {
  return error?.status === 401
}

async function apiRequest(path, { method = 'GET', token, body, keepalive = false } = {}) {
  const isFormData = body instanceof FormData
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      keepalive,
      headers: {
        ...(!isFormData ? { 'Content-Type': 'application/json' } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    })
  } catch {
    throw new ApiError('Unable to connect to the server. Please make sure the backend is running.')
  }

  if (!response.ok) {
    let message = 'Something went wrong. Please try again.'
    try {
      const data = await response.json()
      message = formatApiErrorDetail(data.detail) || message
    } catch {
      message = response.statusText || message
    }
    if (response.status === 403) {
      message = 'You do not have permission to perform this action.'
    }
    throw new ApiError(message, response.status)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

function handleAuthenticatedError(error, onAuthExpired) {
  if (isAuthExpiredError(error)) {
    onAuthExpired()
    return true
  }
  return false
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
    if (hasSelectedAnswer(answer.selected_option_id)) {
      answers[answer.question_id] = answer.selected_option_id
    }
    review[answer.question_id] = answer.is_marked_for_review
  }
  return { answers, review }
}

function hasSelectedAnswer(value) {
  return value !== undefined && value !== null
}

function buildSelectedAnswerPayload(answers) {
  return Object.entries(answers)
    .filter(([, optionId]) => hasSelectedAnswer(optionId))
    .map(([questionId, optionId]) => ({
      question_id: Number(questionId),
      selected_option_id: optionId,
    }))
}

function formatStudentExamError(message) {
  const normalizedMessage = message?.toLowerCase() ?? ''

  if (normalizedMessage.includes('already submitted')) {
    return 'You have already completed this exam.'
  }

  if (normalizedMessage.includes('already started or submitted')) {
    return 'This exam attempt is no longer available.'
  }

  if (normalizedMessage.includes('cannot be reopened')) {
    return 'This exam attempt was already started and cannot be reopened.'
  }

  if (normalizedMessage.includes('exam time has expired')) {
    return 'Your exam session has expired.'
  }

  if (normalizedMessage.includes('exam has ended')) {
    return 'This exam has ended.'
  }

  if (normalizedMessage.includes('exam has not started')) {
    return 'This exam has not started yet.'
  }

  if (normalizedMessage.includes('answer every question')) {
    return 'Please answer every question before submitting this exam.'
  }

  return message || 'Unable to continue this exam right now.'
}

function getAutoSubmitSuccessMessage(reason) {
  if (reason === 'timer_expired') {
    return 'Time is over. Your exam has been submitted automatically.'
  }

  if (reason === 'route_leave' || reason === 'logout_during_exam') {
    return 'Your exam was submitted because you left the exam screen.'
  }

  return 'Your exam was submitted automatically by the exam security rules.'
}

function formatDateTime(value) {
  if (!value) return 'Not available'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not available'
  return date.toLocaleString()
}

function formatActivityAction(value) {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function formatActivityDetails(value) {
  if (!value) return '-'
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed)
        .map(([key, item]) => `${formatActivityAction(key)}: ${String(item)}`)
        .join(', ')
    }
  } catch {
    return value
  }
  return value
}

function sanitizeCsvFilename(value) {
  return String(value || 'exam')
    .trim()
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'exam'
}

function getSubmissionAnswerStatus(answer) {
  if (!answer?.selected_option_id) return 'Unanswered'
  return answer.is_correct ? 'Correct' : 'Wrong'
}

function getAttemptDeadline(submission, exam) {
  const startedAt = submission?.started_at ? new Date(submission.started_at) : null
  const endsAt = exam.ends_at ? new Date(exam.ends_at) : null
  const hasValidEndsAt = endsAt && !Number.isNaN(endsAt.getTime())
  const durationMinutes = Number(exam.duration_minutes)

  if (!startedAt || Number.isNaN(startedAt.getTime())) {
    return hasValidEndsAt ? endsAt : null
  }

  if (!Number.isFinite(durationMinutes) || durationMinutes < 1) {
    return hasValidEndsAt ? endsAt : null
  }

  const durationDeadline = new Date(startedAt.getTime() + durationMinutes * 60 * 1000)

  if (hasValidEndsAt && endsAt < durationDeadline) {
    return endsAt
  }

  return durationDeadline
}

function formatRemainingTime(totalSeconds) {
  const safeSeconds = Math.max(0, totalSeconds)
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const seconds = safeSeconds % 60
  const parts = hours > 0 ? [hours, minutes, seconds] : [minutes, seconds]
  return parts.map((part) => String(part).padStart(2, '0')).join(':')
}

function getQuestionStatusLabel(status) {
  const labels = {
    'not-visited': 'Not Visited',
    'not-answered': 'Not Answered',
    answered: 'Answered',
    marked: 'Marked for Review',
    'answered-marked': 'Answered & Marked for Review',
  }

  return labels[status] ?? status
}

const QUESTION_STATUS_ORDER = [
  'not-visited',
  'not-answered',
  'answered',
  'marked',
  'answered-marked',
]

function App() {
  const [auth, setAuth] = useState(readStoredAuth)
  const [isStudentAttemptActive, setIsStudentAttemptActive] = useState(false)
  const logoutGuardRef = useRef(null)

  function handleAuthenticated(nextAuth) {
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(nextAuth))
    setIsStudentAttemptActive(false)
    setAuth(nextAuth)
  }

  async function handleLogout() {
    if (logoutGuardRef.current) {
      await logoutGuardRef.current('logout')
    }
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setIsStudentAttemptActive(false)
    setAuth(null)
  }

  function handleAuthExpired() {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    setIsStudentAttemptActive(false)
    setAuth(null)
  }

  const registerLogoutGuard = useCallback((handler) => {
    logoutGuardRef.current = handler
    setIsStudentAttemptActive(Boolean(handler))
  }, [])

  if (!auth) {
    return <LoginScreen onAuthenticated={handleAuthenticated} />
  }

  return (
    <div className="app-shell">
      <TopBar
        user={auth.user}
        onLogout={handleLogout}
        hideLogout={auth.user.role === 'student' && isStudentAttemptActive}
      />
      {auth.user.role === 'admin' ? (
        <AdminDashboard
          key={`admin-${auth.user.id}-${auth.access_token}`}
          token={auth.access_token}
          onAuthExpired={handleAuthExpired}
        />
      ) : (
        <StudentDashboard
          key={`student-${auth.user.id}-${auth.access_token}`}
          token={auth.access_token}
          user={auth.user}
          onAuthExpired={handleAuthExpired}
          onLogoutGuardChange={registerLogoutGuard}
        />
      )}
    </div>
  )
}

function LoginScreen({ onAuthenticated }) {
  const [mode, setMode] = useState('signin')
  const [signInRole, setSignInRole] = useState('student')
  const [credentials, setCredentials] = useState(createEmptyCredentials)
  const [signup, setSignup] = useState(createEmptySignup)
  const [isLoading, setIsLoading] = useState(false)
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [isLogoVisible, setIsLogoVisible] = useState(true)

  async function handleLoginSubmit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')
    setIsLoading(true)
    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: credentials,
      })
      const currentUser = await apiRequest('/auth/me', { token: data.access_token })
      onAuthenticated({ ...data, user: currentUser })
    } catch (err) {
      setError(err.message)
    } finally {
      setIsLoading(false)
    }
  }

  function validateSignup() {
    const fullName = signup.full_name.trim()
    const institutionalEmail = signup.institutional_email.trim().toLowerCase()
    const registerNumber = signup.register_number.trim()
    const department = signup.department.trim()
    const year = signup.year.trim()

    if (!fullName) return 'Full name is required.'
    if (!institutionalEmail) return 'Institutional email is required.'
    if (!institutionalEmail.endsWith(STUDENT_EMAIL_DOMAIN)) {
      return "Use your official Stella Mary's institutional email address."
    }
    if (!registerNumber) return 'Register number is required.'
    if (!department) return 'Department is required.'
    if (!DEPARTMENT_OPTIONS.includes(department)) return 'Choose a valid department.'
    if (!year) return 'Year is required.'
    if (!YEAR_OPTIONS.includes(year)) return 'Choose a valid year.'
    if (!signup.password) return 'Password is required.'
    if (signup.password !== signup.confirmPassword) return 'Confirm password must match.'

    return ''
  }

  async function handleSignupSubmit(event) {
    event.preventDefault()
    setError('')
    setSuccess('')

    const validationError = validateSignup()
    if (validationError) {
      setError(validationError)
      return
    }

    setIsRegistering(true)
    try {
      await apiRequest('/auth/register', {
        method: 'POST',
        body: {
          email: signup.institutional_email.trim().toLowerCase(),
          full_name: signup.full_name.trim(),
          password: signup.password,
          role: 'student',
          register_number: signup.register_number.trim(),
          department: signup.department.trim(),
          batch: '',
          class_name: signup.year.trim(),
          is_active: true,
          is_superuser: false,
        },
      })
      setSignInRole('student')
      setCredentials(createEmptyCredentials())
      setSignup(createEmptySignup())
      setMode('signin')
      setSuccess('Account created successfully. Please sign in.')
    } catch (err) {
      setError(err.message)
    } finally {
      setIsRegistering(false)
    }
  }

  function selectSignInRole(role) {
    setSignInRole(role)
    setError('')
    setSuccess('')
    setMode('signin')
  }

  return (
    <main className="auth-page">
      <section className="login-card auth-card" aria-label="Authentication">
        <div className="auth-brand">
          <div className="auth-logo-frame" aria-hidden="true">
            {isLogoVisible ? (
              <img
                src="/branding/stella-marys-logo.png"
                alt=""
                onError={() => setIsLogoVisible(false)}
              />
            ) : (
              <BookOpenCheck size={38} aria-hidden="true" />
            )}
          </div>
          <p className="eyebrow">{COLLEGE_NAME}</p>
          <h1>{PORTAL_TITLE}</h1>
          <p>Secure online examination portal for students and administrators.</p>
        </div>

        <div className="section-heading compact auth-form-heading">
          {mode === 'signin' ? (
            <ShieldCheck size={22} aria-hidden="true" />
          ) : (
            <UserPlus size={22} aria-hidden="true" />
          )}
          <div>
            <p className="eyebrow">{mode === 'signin' ? 'Sign in' : 'Student registration'}</p>
            <h2>{mode === 'signin' ? 'Continue to dashboard' : 'Create student account'}</h2>
          </div>
        </div>

        <div className="segmented-control auth-tabs" aria-label="Authentication mode">
          <button
            className={mode === 'signin' ? 'active' : ''}
            type="button"
            onClick={() => {
              setMode('signin')
              setError('')
            }}
          >
            <ShieldCheck size={16} aria-hidden="true" />
            Sign In
          </button>
          <button
            className={mode === 'signup' ? 'active' : ''}
            type="button"
            onClick={() => {
              setMode('signup')
              setError('')
              setSuccess('')
            }}
          >
            <UserPlus size={16} aria-hidden="true" />
            Student Sign Up
          </button>
        </div>

        {mode === 'signin' ? (
          <>
            <div className="segmented-control login-role-switch" aria-label="Sign in role">
              <button
                className={signInRole === 'student' ? 'active' : ''}
                type="button"
                onClick={() => selectSignInRole('student')}
              >
                <UserRound size={16} aria-hidden="true" />
                Student
              </button>
              <button
                className={signInRole === 'admin' ? 'active' : ''}
                type="button"
                onClick={() => selectSignInRole('admin')}
              >
                <ShieldCheck size={16} aria-hidden="true" />
                Admin
              </button>
            </div>

            <form className="form-grid" onSubmit={handleLoginSubmit}>
              <label>
                Email
                <input
                  type="email"
                  value={credentials.email}
                  onChange={(event) =>
                    setCredentials((current) => ({ ...current, email: event.target.value }))
                  }
                  autoComplete="email"
                  placeholder="Enter your email"
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
                  placeholder="Enter your password"
                  required
                />
              </label>
              {error ? <p className="form-error">{error}</p> : null}
              {success ? <p className="form-success">{success}</p> : null}
              <button className="primary-button" type="submit" disabled={isLoading}>
                {isLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : null}
                Sign in
              </button>
            </form>
          </>
        ) : (
          <form className="form-grid signup-form" onSubmit={handleSignupSubmit}>
            <label>
              Full Name
              <input
                value={signup.full_name}
                onChange={(event) =>
                  setSignup((current) => ({ ...current, full_name: event.target.value }))
                }
                autoComplete="name"
                placeholder="Enter your full name"
                required
              />
            </label>
            <label>
              Institutional Email
              <input
                type="email"
                value={signup.institutional_email}
                onChange={(event) =>
                  setSignup((current) => ({ ...current, institutional_email: event.target.value }))
                }
                autoComplete="email"
                placeholder="name@stellamaryscoe.edu.in"
                required
              />
            </label>
            <div className="form-two-column">
              <label>
                Password
                <input
                  type="password"
                  value={signup.password}
                  onChange={(event) =>
                    setSignup((current) => ({ ...current, password: event.target.value }))
                  }
                  autoComplete="new-password"
                  placeholder="Create a password"
                  required
                />
              </label>
              <label>
                Confirm Password
                <input
                  type="password"
                  value={signup.confirmPassword}
                  onChange={(event) =>
                    setSignup((current) => ({ ...current, confirmPassword: event.target.value }))
                  }
                  autoComplete="new-password"
                  placeholder="Confirm your password"
                  required
                />
              </label>
            </div>
            <div className="form-two-column">
              <label>
                Register Number
                <input
                  value={signup.register_number}
                  onChange={(event) =>
                    setSignup((current) => ({ ...current, register_number: event.target.value }))
                  }
                  placeholder="Enter register number"
                  required
                />
              </label>
              <label>
                Department
                <select
                  value={signup.department}
                  onChange={(event) =>
                    setSignup((current) => ({ ...current, department: event.target.value }))
                  }
                  required
                >
                  <option value="">Select department</option>
                  {DEPARTMENT_OPTIONS.map((department) => (
                    <option value={department} key={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              Year
              <select
                value={signup.year}
                onChange={(event) =>
                  setSignup((current) => ({ ...current, year: event.target.value }))
                }
                required
              >
                <option value="">Select year</option>
                {YEAR_OPTIONS.map((year) => (
                  <option value={year} key={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <button className="primary-button" type="submit" disabled={isRegistering}>
              {isRegistering ? <Loader2 className="spin" size={18} aria-hidden="true" /> : null}
              Create account
            </button>
          </form>
        )}
      </section>
      <footer className="auth-footer">
        <span>&copy; Stella Mary's College of Engineering &mdash; Skill Enhancement Exam Portal</span>
        <small>For authorized students and administrators only.</small>
      </footer>
    </main>
  )
}

function TopBar({ user, onLogout, hideLogout = false }) {
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
        {!hideLogout ? (
          <button className="icon-button" type="button" onClick={onLogout} title="Sign out">
            <LogOut size={18} aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </header>
  )
}

function StudentDashboard({ token, user, onAuthExpired, onLogoutGuardChange }) {
  const [exams, setExams] = useState([])
  const [activeExam, setActiveExam] = useState(null)
  const [activeSubmission, setActiveSubmission] = useState(null)
  const [answers, setAnswers] = useState({})
  const [review, setReview] = useState({})
  const [result, setResult] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [status, setStatus] = useState({ loading: true, error: '', success: '' })
  const activeExamRef = useRef(activeExam)
  const answersRef = useRef(answers)
  const hasAutoSubmittedRef = useRef(false)
  const autoSubmitInProgressRef = useRef(false)

  const currentStudentId = Number(user.id)
  const currentStudentSubmissions = useMemo(
    () => submissions.filter((submission) => Number(submission.student_id) === currentStudentId),
    [currentStudentId, submissions],
  )
  const selectedCount = Object.values(answers).filter(hasSelectedAnswer).length
  const reviewCount = Object.values(review).filter(Boolean).length
  const submissionsByExamId = useMemo(() => {
    const map = new Map()
    currentStudentSubmissions.forEach((submission) => {
      map.set(Number(submission.exam_id), submission)
    })
    return map
  }, [currentStudentSubmissions])
  const examsById = useMemo(() => {
    const map = new Map()
    exams.forEach((exam) => {
      map.set(exam.id, exam)
    })
    return map
  }, [exams])

  useEffect(() => {
    activeExamRef.current = activeExam
  }, [activeExam])

  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  const loadStudentData = useCallback(async () => {
    setStatus({ loading: true, error: '', success: '' })
    try {
      const [examData, submissionData] = await Promise.all([
        apiRequest('/exams', { token }),
        apiRequest('/exams/submissions/me', { token }),
      ])
      setExams(examData)
      setSubmissions(
        submissionData.filter((submission) => Number(submission.student_id) === currentStudentId),
      )
    } catch (err) {
      if (handleAuthenticatedError(err, onAuthExpired)) return
      setStatus({ loading: false, error: formatStudentExamError(err.message), success: '' })
      return
    }
    setStatus({ loading: false, error: '', success: '' })
  }, [currentStudentId, onAuthExpired, token])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStudentData()
  }, [loadStudentData])

  const upsertCurrentStudentSubmission = useCallback((submission) => {
    if (!submission || Number(submission.student_id) !== currentStudentId) return
    setSubmissions((current) => {
      const existingIndex = current.findIndex((item) => Number(item.id) === Number(submission.id))
      if (existingIndex === -1) {
        return [submission, ...current]
      }

      return current.map((item, index) => (index === existingIndex ? submission : item))
    })
  }, [currentStudentId])

  const reportEvent = useCallback(
    async (eventType, details, { keepalive = false } = {}) => {
      const exam = activeExamRef.current
      if (!exam) return
      try {
        await apiRequest(`/exams/${exam.id}/proctoring-events`, {
          method: 'POST',
          token,
          keepalive,
          body: { event_type: eventType, details, severity: 'critical' },
        })
      } catch (err) {
        if (handleAuthenticatedError(err, onAuthExpired)) return
        // Proctor events should not interrupt the exam-taking flow.
      }
    },
    [onAuthExpired, token],
  )

  const autoSubmitActiveExam = useCallback(
    async (reason = 'manual_security_lock', { keepalive = false, updateUi = true } = {}) => {
      const exam = activeExamRef.current
      if (!exam || hasAutoSubmittedRef.current || autoSubmitInProgressRef.current) return null
      hasAutoSubmittedRef.current = true
      autoSubmitInProgressRef.current = true

      const requestBody = {
        reason,
        answers: buildSelectedAnswerPayload(answersRef.current),
      }

      try {
        const data = await apiRequest(`/exams/${exam.id}/auto-submit`, {
          method: 'POST',
          token,
          keepalive,
          body: requestBody,
        })

        if (updateUi) {
          setResult({ ...data, exam_title: exam.title })
          upsertCurrentStudentSubmission(data)
          setActiveExam(null)
          setActiveSubmission(null)
          setAnswers({})
          setReview({})
          await loadStudentData()
          setStatus({
            loading: false,
            error: '',
            success: getAutoSubmitSuccessMessage(reason),
          })
        }

        return data
      } catch (err) {
        hasAutoSubmittedRef.current = false
        autoSubmitInProgressRef.current = false
        if (updateUi) {
          if (handleAuthenticatedError(err, onAuthExpired)) return null
          setStatus({ loading: false, error: formatStudentExamError(err.message), success: '' })
        }
        return null
      }
    },
    [loadStudentData, onAuthExpired, token, upsertCurrentStudentSubmission],
  )

  useEffect(() => {
    onLogoutGuardChange(activeExam ? () => autoSubmitActiveExam('logout_during_exam') : null)
    return () => onLogoutGuardChange(null)
  }, [activeExam, autoSubmitActiveExam, onLogoutGuardChange])

  async function startExam(exam) {
    setStatus({ loading: true, error: '', success: '' })
    try {
      const submission = await apiRequest(`/exams/${exam.id}/start`, { method: 'POST', token })
      const mapped = mapSubmissionAnswers(submission)
      hasAutoSubmittedRef.current = false
      autoSubmitInProgressRef.current = false
      setActiveExam(exam)
      setActiveSubmission(submission)
      setAnswers(mapped.answers)
      setReview(mapped.review)
      setResult(null)
    } catch (err) {
      if (handleAuthenticatedError(err, onAuthExpired)) return
      const normalizedMessage = err.message?.toLowerCase() ?? ''
      if (
        normalizedMessage.includes('cannot be reopened') ||
        normalizedMessage.includes('already started') ||
        normalizedMessage.includes('already submitted')
      ) {
        await loadStudentData()
      }
      setStatus({ loading: false, error: formatStudentExamError(err.message), success: '' })
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
      setActiveSubmission(submission)
      setAnswers((current) => {
        const nextAnswers = { ...current }
        if (hasSelectedAnswer(optionId)) {
          nextAnswers[questionId] = optionId
        } else {
          delete nextAnswers[questionId]
        }
        return nextAnswers
      })
      setReview((current) => ({
        ...current,
        [questionId]: Boolean(shouldReview),
      }))
      setStatus({ loading: false, error: '', success: 'Answer saved.' })
      return true
    } catch (err) {
      if (handleAuthenticatedError(err, onAuthExpired)) return
      const normalizedMessage = err.message?.toLowerCase() ?? ''
      if (
        normalizedMessage.includes('exam time has expired') ||
        normalizedMessage.includes('exam has ended')
      ) {
        await autoSubmitActiveExam('timer_expired')
        return false
      }
      setStatus({ loading: false, error: formatStudentExamError(err.message), success: '' })
      return false
    }
  }

  async function clearAnswer(questionId) {
    const nextAnswers = { ...answers }
    delete nextAnswers[questionId]
    const nextReview = { ...review, [questionId]: false }
    setAnswers(nextAnswers)
    setReview(nextReview)
    return saveAnswer(questionId, null, false)
  }

  async function toggleReview(questionId) {
    const nextReviewValue = !review[questionId]
    setReview((current) => ({ ...current, [questionId]: nextReviewValue }))
    return saveAnswer(questionId, answers[questionId] ?? null, nextReviewValue)
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
          <Metric label="Submissions" value={currentStudentSubmissions.length} />
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
          user={user}
          selectedCount={selectedCount}
          isLoading={status.loading}
          onSave={saveAnswer}
          onClear={clearAnswer}
          onToggleReview={toggleReview}
          onAutoSubmit={autoSubmitActiveExam}
          onProctorEvent={reportEvent}
        />
      ) : (
        <section className="content-grid">
          <div className="main-column">
            <SectionTitle icon={ClipboardList} eyebrow="Student exams" title="Available exams" />
            {status.loading ? <LoadingBlock label="Loading exams" /> : null}
            <div className="exam-list">
              {exams.map((exam) => (
                <StudentExamCard
                  exam={exam}
                  key={exam.id}
                  submission={submissionsByExamId.get(Number(exam.id))}
                  onStart={() => startExam(exam)}
                />
              ))}
              {!status.loading && exams.length === 0 ? (
                <p className="empty-state">No published exams are available right now.</p>
              ) : null}
            </div>
          </div>

          <aside className="side-column">
            <SectionTitle icon={CheckCircle2} eyebrow="Results" title="Recent submissions" />
            {result ? (
              <div className="submitted-panel">
                <h3>Exam Submitted Successfully</h3>
                <p>Your responses have been saved. Results will be published by the admin later.</p>
                <div className="exam-meta">
                  <span>{result.exam_title ?? `Exam #${result.exam_id}`}</span>
                  <span>{result.status}</span>
                  <span>{formatDateTime(result.submitted_at)}</span>
                </div>
              </div>
            ) : null}
            <div className="submission-list">
              {currentStudentSubmissions.map((submission) => (
                <div className="submission-item" key={submission.id}>
                  <div>
                    <span>{examsById.get(submission.exam_id)?.title ?? `Exam #${submission.exam_id}`}</span>
                    <p className="empty-state">
                      {submission.is_result_published
                        ? 'Results published'
                        : 'You have already completed this exam. Results are not published yet.'}
                    </p>
                  </div>
                  <strong>
                    {submission.is_result_published && submission.score !== null
                      ? `${submission.score} marks`
                      : 'Results pending'}
                  </strong>
                </div>
              ))}
              {currentStudentSubmissions.length === 0 ? (
                <p className="empty-state">Submitted exams will appear here.</p>
              ) : null}
            </div>
          </aside>
        </section>
      )}
    </main>
  )
}

function StudentExamCard({ exam, submission, onStart }) {
  const hasSubmission = Boolean(submission)
  const isCompleted = submission?.status === 'submitted'
  const isLocked = submission?.status === 'in_progress'
  const resultStatus = submission?.is_result_published ? 'Results published' : 'Results pending'
  const examInstructions = exam.instructions?.trim() || DEFAULT_EXAM_INSTRUCTIONS

  return (
    <article className="exam-card">
      <div>
        <h3>{exam.title}</h3>
        <p>{exam.description}</p>
      </div>
      <div className="exam-meta">
        <span>{exam.duration_minutes} min</span>
        <span>{exam.questions.length} questions</span>
        {isCompleted ? <span>Completed</span> : null}
        {isLocked ? <span>Attempt locked</span> : null}
        {hasSubmission ? <span>{resultStatus}</span> : null}
      </div>
      {hasSubmission ? (
        <p className="empty-state">
          {isLocked
            ? 'This exam attempt was already started. Re-entry is locked by the backend.'
            : submission.is_result_published
              ? 'Results published. Check your recent submissions for your score.'
              : 'You have already completed this exam. Results are not published yet.'}
        </p>
      ) : (
        <>
          <div className="exam-instructions">
            <strong>Exam Instructions</strong>
            <p>{examInstructions}</p>
            <ul>
              {EXAM_POLICY_POINTS.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>
          <p className="exam-start-warning">
            {SYSTEM_EXAM_WARNING}
          </p>
          <button className="primary-button" type="button" onClick={onStart}>
            Start exam
          </button>
        </>
      )}
    </article>
  )
}

function ExamAttempt({
  exam,
  submission,
  answers,
  review,
  setAnswers,
  user,
  selectedCount,
  isLoading,
  onSave,
  onClear,
  onToggleReview,
  onAutoSubmit,
  onProctorEvent,
}) {
  const questions = useMemo(() => exam.questions ?? [], [exam.questions])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [fullscreenWarning, setFullscreenWarning] = useState('')
  const [visited, setVisited] = useState(() =>
    questions[0] ? { [questions[0].id]: true } : {},
  )
  const autoSubmitRef = useRef(false)
  const deadline = useMemo(() => getAttemptDeadline(submission, exam), [exam, submission])
  const [remainingSeconds, setRemainingSeconds] = useState(() =>
    deadline ? Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000)) : 0,
  )
  const currentQuestion = questions[currentIndex] ?? questions[0]
  const totalQuestions = questions.length
  const unansweredCount = Math.max(0, totalQuestions - selectedCount)
  const markedCount = Object.values(review).filter(Boolean).length
  const isLastQuestion = currentIndex >= totalQuestions - 1
  const isFirstQuestion = currentIndex === 0
  const isUrgent = Boolean(deadline) && remainingSeconds <= 60
  const currentStatus = currentQuestion ? getQuestionStatus(currentQuestion) : 'not-visited'
  const statusCounts = {
    'not-visited': 0,
    'not-answered': 0,
    answered: 0,
    marked: 0,
    'answered-marked': 0,
  }

  questions.forEach((question) => {
    const questionStatus = getQuestionStatus(question)
    statusCounts[questionStatus] += 1
  })

  useEffect(() => {
    autoSubmitRef.current = false
  }, [submission?.id])

  useEffect(() => {
    if (!deadline) return undefined

    function updateRemainingTime() {
      setRemainingSeconds(Math.max(0, Math.floor((deadline.getTime() - Date.now()) / 1000)))
    }

    updateRemainingTime()
    const timerId = window.setInterval(updateRemainingTime, 1000)
    return () => window.clearInterval(timerId)
  }, [deadline])

  useEffect(() => {
    if (!deadline || remainingSeconds > 0 || autoSubmitRef.current) return
    autoSubmitRef.current = true
    void onAutoSubmit('timer_expired')
  }, [deadline, onAutoSubmit, remainingSeconds])

  useEffect(() => {
    let requestedFullscreen = false
    const rootElement = document.documentElement

    async function enterFullscreen() {
      if (!rootElement.requestFullscreen || document.fullscreenElement) return
      requestedFullscreen = true
      try {
        await rootElement.requestFullscreen()
        setFullscreenWarning('')
      } catch {
        setFullscreenWarning('Fullscreen permission was denied. Do not leave the exam screen.')
      } finally {
        window.setTimeout(() => {
          requestedFullscreen = false
        }, 500)
      }
    }

    void enterFullscreen()

    function handleFullscreenChange() {
      if (requestedFullscreen || document.fullscreenElement || autoSubmitRef.current) return
      autoSubmitRef.current = true
      void onProctorEvent('fullscreen_exit', 'Student exited fullscreen during the exam.')
      void onAutoSubmit('fullscreen_exit')
    }

    function logVisibility() {
      if (document.visibilityState === 'hidden' && !autoSubmitRef.current) {
        autoSubmitRef.current = true
        void onProctorEvent('tab_hidden', 'Student switched away from the exam tab.', { keepalive: true })
        void onAutoSubmit('tab_hidden', { keepalive: true })
      }
    }
    function logBlur() {
      if (requestedFullscreen || autoSubmitRef.current) return
      autoSubmitRef.current = true
      void onProctorEvent('window_blur', 'Browser window lost focus during the exam.')
      void onAutoSubmit('window_blur')
    }
    function logClipboard(event) {
      void onProctorEvent(event.type, `Clipboard event detected: ${event.type}.`)
    }
    function handlePageLeave() {
      if (autoSubmitRef.current) return
      autoSubmitRef.current = true
      void onProctorEvent('page_unload', 'Student left or refreshed the exam page.', { keepalive: true })
      void onAutoSubmit('page_unload', { keepalive: true, updateUi: false })
    }
    function handleBeforeUnload() {
      handlePageLeave()
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)
    document.addEventListener('visibilitychange', logVisibility)
    window.addEventListener('blur', logBlur)
    window.addEventListener('pagehide', handlePageLeave)
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('copy', logClipboard)
    document.addEventListener('paste', logClipboard)
    document.addEventListener('contextmenu', logClipboard)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      document.removeEventListener('visibilitychange', logVisibility)
      window.removeEventListener('blur', logBlur)
      window.removeEventListener('pagehide', handlePageLeave)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('copy', logClipboard)
      document.removeEventListener('paste', logClipboard)
      document.removeEventListener('contextmenu', logClipboard)
    }
  }, [onAutoSubmit, onProctorEvent])

  function getQuestionStatus(question) {
    const isAnswered = hasSelectedAnswer(answers[question.id])
    const isMarked = Boolean(review[question.id])
    const isVisited = Boolean(visited[question.id])

    if (isAnswered && isMarked) return 'answered-marked'
    if (isMarked) return 'marked'
    if (isAnswered) return 'answered'
    if (isVisited) return 'not-answered'
    return 'not-visited'
  }

  function selectCurrentAnswer(optionId) {
    if (!currentQuestion) return
    setVisited((current) =>
      current[currentQuestion.id] ? current : { ...current, [currentQuestion.id]: true },
    )
    setAnswers((current) => ({ ...current, [currentQuestion.id]: optionId }))
  }

  function goToQuestion(index) {
    const nextIndex = Math.max(0, Math.min(index, totalQuestions - 1))
    const nextQuestion = questions[nextIndex]
    if (nextQuestion) {
      setVisited((current) =>
        current[nextQuestion.id] ? current : { ...current, [nextQuestion.id]: true },
      )
    }
    setCurrentIndex(nextIndex)
  }

  async function saveAndNext() {
    if (!currentQuestion) return
    const didSave = await onSave(
      currentQuestion.id,
      answers[currentQuestion.id] ?? null,
      review[currentQuestion.id] ?? false,
    )
    if (didSave && !isLastQuestion) {
      goToQuestion(currentIndex + 1)
    }
  }

  async function clearCurrentResponse() {
    if (!currentQuestion) return
    await onClear(currentQuestion.id)
  }

  async function toggleCurrentReview() {
    if (!currentQuestion) return
    await onToggleReview(currentQuestion.id)
  }

  if (!currentQuestion) {
    return (
      <section className="attempt-layout">
        <p className="empty-state">No questions are available for this exam.</p>
      </section>
    )
  }

  return (
    <section className="attempt-layout">
      <div className="exam-attempt-screen">
        <div className="exam-attempt-topbar">
          <div>
            <p className="eyebrow">In progress</p>
            <h2>{exam.title}</h2>
            <p>{user.full_name} - {user.email}</p>
            <p className="exam-security-warning">
              {SYSTEM_EXAM_WARNING}
            </p>
            {fullscreenWarning ? <p className="exam-fullscreen-warning">{fullscreenWarning}</p> : null}
          </div>
          <div className="attempt-topbar-actions">
            <span className={`timer-pill ${isUrgent ? 'urgent' : ''}`}>
              {deadline ? formatRemainingTime(remainingSeconds) : '--:--'}
            </span>
            <span className="auto-submit-pill">Auto-submit at time end</span>
          </div>
        </div>

        <div className="exam-attempt-grid">
          <section className="attempt-question-card" aria-label="Current question">
            <div className="question-card-header">
              <div>
                <p className="eyebrow">Question {currentIndex + 1} of {totalQuestions}</p>
                <h3>{currentQuestion.prompt}</h3>
              </div>
              <span className={`question-state-badge ${currentStatus}`}>
                {getQuestionStatusLabel(currentStatus)}
              </span>
            </div>

            <div className="attempt-option-list">
              {currentQuestion.options.map((option) => (
                <label
                  className={`attempt-option-card ${answers[currentQuestion.id] === option.id ? 'selected' : ''}`}
                  key={option.id}
                >
                  <input
                    type="radio"
                    name={`current-question-${currentQuestion.id}`}
                    checked={answers[currentQuestion.id] === option.id}
                    onChange={() => selectCurrentAnswer(option.id)}
                  />
                  <span>{option.text}</span>
                </label>
              ))}
            </div>

            <div className="attempt-button-row">
              <button
                className="secondary-button"
                type="button"
                disabled={isFirstQuestion || isLoading}
                onClick={() => goToQuestion(currentIndex - 1)}
              >
                Previous
              </button>
              <button className="secondary-button" type="button" disabled={isLoading} onClick={clearCurrentResponse}>
                <Trash2 size={16} aria-hidden="true" />
                Clear Response
              </button>
              <button
                className={`secondary-button ${review[currentQuestion.id] ? 'review-active' : ''}`}
                type="button"
                disabled={isLoading}
                onClick={toggleCurrentReview}
              >
                <Flag size={16} aria-hidden="true" />
                {review[currentQuestion.id] ? 'Unmark Review' : 'Mark for Review'}
              </button>
              <button className="primary-button" type="button" disabled={isLoading} onClick={saveAndNext}>
                {isLoading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
                {isLastQuestion ? 'Save' : 'Save & Next'}
              </button>
              <button
                className="secondary-button"
                type="button"
                disabled={isLastQuestion || isLoading}
                onClick={() => goToQuestion(currentIndex + 1)}
              >
                Next
              </button>
            </div>
          </section>

          <aside className="attempt-palette" aria-label="Question palette">
            <div className="palette-summary">
              <div>
                <strong>{selectedCount}</strong>
                <span>Answered</span>
              </div>
              <div>
                <strong>{unansweredCount}</strong>
                <span>Not answered</span>
              </div>
              <div>
                <strong>{markedCount}</strong>
                <span>Marked</span>
              </div>
            </div>

            <div className="palette-grid">
              {questions.map((question, index) => {
                const state = getQuestionStatus(question)
                return (
                  <button
                    className={`palette-item ${state} ${currentIndex === index ? 'active' : ''}`}
                    type="button"
                    key={question.id}
                    onClick={() => goToQuestion(index)}
                    aria-label={`Question ${index + 1}: ${getQuestionStatusLabel(state)}`}
                    aria-current={currentIndex === index ? 'true' : undefined}
                  >
                    {index + 1}
                  </button>
                )
              })}
            </div>

            <div className="palette-legend" aria-label="Question status legend">
              {QUESTION_STATUS_ORDER.map((state) => (
                <div className={`legend-row ${state}`} key={state}>
                  <span className={`status-icon ${state}`} aria-hidden="true" />
                  <span className="legend-label">{getQuestionStatusLabel(state)}</span>
                  <strong className="legend-count" aria-label={`${statusCounts[state]} questions`}>
                    {statusCounts[state]}
                  </strong>
                </div>
              ))}
            </div>
            <p className="palette-auto-note">Auto-submit at time end</p>
          </aside>
        </div>
      </div>
    </section>
  )
}

function AdminDashboard({ token, onAuthExpired }) {
  const [exams, setExams] = useState([])
  const [selectedExam, setSelectedExam] = useState(null)
  const [submissions, setSubmissions] = useState([])
  const [users, setUsers] = useState([])
  const [activityLogs, setActivityLogs] = useState([])
  const [summary, setSummary] = useState(null)
  const [activeTab, setActiveTab] = useState('exams')
  const [status, setStatus] = useState({ loading: true, error: '', success: '' })
  const [isCreatingExam, setIsCreatingExam] = useState(false)
  const [userForm, setUserForm] = useState({
    full_name: '',
    email: '',
    password: '',
    role: 'student',
    department: '',
    class_name: '',
    register_number: '',
  })
  const [userSearch, setUserSearch] = useState('')
  const [roleFilter, setRoleFilter] = useState('all')
  const [resetState, setResetState] = useState({ userId: null, password: '' })
  const [deleteExamCandidate, setDeleteExamCandidate] = useState(null)
  const [examListTab, setExamListTab] = useState('active')
  const [resultExamSearch, setResultExamSearch] = useState('')
  const [resultStudentSearch, setResultStudentSearch] = useState('')
  const [resultStatusFilter, setResultStatusFilter] = useState('all')
  const [resultPublishFilter, setResultPublishFilter] = useState('all')
  const [resultExportExamId, setResultExportExamId] = useState('')
  const [activitySearch, setActivitySearch] = useState('')
  const [activityActionFilter, setActivityActionFilter] = useState('all')
  const [submissionDetailState, setSubmissionDetailState] = useState({
    isOpen: false,
    loading: false,
    error: '',
    submission: null,
  })
  const isPersistingDraftRef = useRef(false)

  const dashboardSummary = useMemo(() => {
    const submittedScores = submissions
      .filter((submission) => submission.status === 'submitted' && submission.score !== null)
      .map((submission) => Number(submission.score))
    const localAverage =
      submittedScores.length > 0
        ? submittedScores.reduce((total, score) => total + score, 0) / submittedScores.length
        : null

    return {
      total_exams: summary?.total_exams ?? exams.length,
      published_exams: summary?.published_exams ?? exams.filter((exam) => exam.is_published && !exam.is_archived).length,
      draft_exams: summary?.draft_exams ?? exams.filter((exam) => !exam.is_published && !exam.is_archived).length,
      archived_exams: summary?.archived_exams ?? exams.filter((exam) => exam.is_archived).length,
      total_students: summary?.total_students ?? users.filter((user) => user.role === 'student').length,
      total_admins: summary?.total_admins ?? users.filter((user) => user.role === 'admin').length,
      total_submissions: summary?.total_submissions ?? submissions.length,
      average_score: summary?.average_score ?? localAverage,
    }
  }, [exams, submissions, summary, users])

  const activeExams = useMemo(() => exams.filter((exam) => !exam.is_archived), [exams])
  const archivedExams = useMemo(() => exams.filter((exam) => exam.is_archived), [exams])
  const visibleExamList = examListTab === 'archived' ? archivedExams : activeExams
  const examById = useMemo(
    () => new Map(exams.map((exam) => [exam.id, exam])),
    [exams],
  )
  const submissionCountByExamId = useMemo(() => {
    const counts = new Map()
    submissions.forEach((submission) => {
      counts.set(submission.exam_id, (counts.get(submission.exam_id) ?? 0) + 1)
    })
    return counts
  }, [submissions])
  const filteredResultSubmissions = useMemo(() => {
    const examSearch = resultExamSearch.trim().toLowerCase()
    const studentSearch = resultStudentSearch.trim().toLowerCase()
    return submissions.filter((submission) => {
      const exam = examById.get(submission.exam_id)
      const examText = [exam?.title, exam?.subject].filter(Boolean).join(' ').toLowerCase()
      const studentText = [
        submission.student_full_name,
        submission.student_email,
        submission.student_register_number,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      const isResultPublished = Boolean(exam?.is_result_published)

      return (
        (!examSearch || examText.includes(examSearch)) &&
        (!studentSearch || studentText.includes(studentSearch)) &&
        (resultStatusFilter === 'all' || submission.status === resultStatusFilter) &&
        (
          resultPublishFilter === 'all' ||
          (resultPublishFilter === 'published' && isResultPublished) ||
          (resultPublishFilter === 'not-published' && !isResultPublished)
        )
      )
    })
  }, [
    examById,
    resultExamSearch,
    resultPublishFilter,
    resultStatusFilter,
    resultStudentSearch,
    submissions,
  ])

  const filteredUsers = useMemo(() => {
    const search = userSearch.trim().toLowerCase()
    return users.filter((user) => {
      const matchesRole = roleFilter === 'all' || user.role === roleFilter
      const searchable = [
        user.full_name,
        user.email,
        user.register_number,
        user.department,
        user.class_name,
        user.batch,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return matchesRole && (!search || searchable.includes(search))
    })
  }, [roleFilter, userSearch, users])

  const activityActionOptions = useMemo(
    () => Array.from(new Set(activityLogs.map((log) => log.action))).sort(),
    [activityLogs],
  )

  const filteredActivityLogs = useMemo(() => {
    const search = activitySearch.trim().toLowerCase()
    return activityLogs.filter((log) => {
      const searchable = [
        log.action,
        log.admin_email,
        log.entity_type,
        log.entity_id,
        formatActivityDetails(log.details),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()

      return (
        (activityActionFilter === 'all' || log.action === activityActionFilter) &&
        (!search || searchable.includes(search))
      )
    })
  }, [activityActionFilter, activityLogs, activitySearch])

  const loadAdminData = useCallback(
    async (examId = null) => {
      setStatus((current) => ({ ...current, loading: true, error: '' }))
      try {
        const [examData, userData, summaryData, activityData] = await Promise.all([
          apiRequest('/exams', { token }),
          apiRequest('/auth/users', { token }),
          apiRequest('/admin/summary', { token }),
          apiRequest('/admin/activity?limit=200', { token }),
        ])
        setExams(examData)
        setUsers(userData)
        setSummary(summaryData)
        setActivityLogs(activityData)
        const submissionSets = await Promise.all(
          examData.map((exam) => apiRequest(`/exams/${exam.id}/submissions`, { token })),
        )
        const allSubmissions = submissionSets.flat()
        setSubmissions(allSubmissions)
        const requestedExamExists = examId && examData.some((exam) => exam.id === examId)
        const nextExamId = requestedExamExists
          ? examId
          : examData.find((exam) => !exam.is_archived)?.id ?? examData[0]?.id
        if (nextExamId) {
          const detailedExam = await apiRequest(`/exams/${nextExamId}/admin`, { token })
          setSelectedExam(detailedExam)
        } else {
          setSelectedExam(null)
        }
      } catch (err) {
        if (handleAuthenticatedError(err, onAuthExpired)) return
        setStatus({ loading: false, error: err.message, success: '' })
        return
      }
      setStatus({ loading: false, error: '', success: '' })
    },
    [onAuthExpired, token],
  )

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadAdminData(null)
  }, [loadAdminData])

  async function selectExam(examId) {
    await loadAdminData(examId)
  }

  function showError(err) {
    if (handleAuthenticatedError(err, onAuthExpired)) return true
    setStatus({ loading: false, error: err.message, success: '' })
    return true
  }

  async function persistBuilderDraft(draft, publishAfterSave = false) {
    if (isPersistingDraftRef.current) return

    if (!draft.metadata.title) {
      setStatus({ loading: false, error: 'Exam title is required.', success: '' })
      return
    }

    if (publishAfterSave && draft.questions.length === 0) {
      setStatus({ loading: false, error: 'Add at least one complete question before publishing.', success: '' })
      return
    }

    setStatus({ loading: true, error: '', success: '' })
    isPersistingDraftRef.current = true
    try {
      const metadata = {
        title: draft.metadata.title,
        subject: draft.metadata.subject,
        description: draft.metadata.description,
        instructions: draft.metadata.instructions,
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
      showError(err)
    } finally {
      isPersistingDraftRef.current = false
    }
  }

  async function createNewExam() {
    if (isCreatingExam) return
    setIsCreatingExam(true)
    setStatus({ loading: true, error: '', success: '' })
    try {
      const createdExam = await apiRequest('/exams', {
        method: 'POST',
        token,
        body: {
          title: 'Untitled Exam',
          duration_minutes: 30,
          is_published: false,
        },
      })
      setStatus({ loading: false, error: '', success: 'Draft exam created.' })
      await loadAdminData(createdExam.id)
    } catch (err) {
      showError(err)
    } finally {
      setIsCreatingExam(false)
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
      showError(err)
    }
  }

  async function importWordQuestions(file) {
    if (!selectedExam?.id) {
      setStatus({ loading: false, error: 'Save the exam draft before importing a Word file.', success: '' })
      return null
    }

    setStatus({ loading: true, error: '', success: '' })
    const wasPublished = Boolean(selectedExam.is_published)
    let unpublishedForImport = false

    try {
      if (wasPublished) {
        await apiRequest(`/exams/${selectedExam.id}/publish`, {
          method: 'PATCH',
          token,
          body: { is_published: false },
        })
        unpublishedForImport = true
      }

      const formData = new FormData()
      formData.append('file', file)
      const result = await apiRequest(`/exams/${selectedExam.id}/questions/import-docx`, {
        method: 'POST',
        token,
        body: formData,
      })

      if (unpublishedForImport) {
        await apiRequest(`/exams/${selectedExam.id}/publish`, {
          method: 'PATCH',
          token,
          body: { is_published: true },
        })
      }

      setStatus({
        loading: false,
        error: result.invalid_count > 0 ? 'Word import found invalid question blocks. No questions were created.' : '',
        success: result.invalid_count > 0 ? '' : `${result.created_count} Word question${result.created_count === 1 ? '' : 's'} imported.`,
      })
      await loadAdminData(selectedExam.id)
      return result
    } catch (err) {
      if (unpublishedForImport) {
        try {
          await apiRequest(`/exams/${selectedExam.id}/publish`, {
            method: 'PATCH',
            token,
            body: { is_published: true },
          })
        } catch {
          // The original error is more useful to show here.
        }
      }
      showError(err)
      return null
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
      showError(err)
    }
  }

  async function toggleResultsPublished(exam) {
    setStatus({ loading: true, error: '', success: '' })
    try {
      await apiRequest(`/exams/${exam.id}/results-publish`, {
        method: 'PATCH',
        token,
        body: { is_result_published: !exam.is_result_published },
      })
      setStatus({
        loading: false,
        error: '',
        success: exam.is_result_published ? 'Results unpublished.' : 'Results published.',
      })
      await loadAdminData(exam.id)
    } catch (err) {
      showError(err)
    }
  }

  async function toggleArchived(exam) {
    setStatus({ loading: true, error: '', success: '' })
    try {
      await apiRequest(`/exams/${exam.id}/archive`, {
        method: 'PATCH',
        token,
        body: { is_archived: !exam.is_archived },
      })
      setStatus({
        loading: false,
        error: '',
        success: exam.is_archived ? 'Exam restored.' : 'Exam archived.',
      })
      setExamListTab(exam.is_archived ? 'active' : 'archived')
      await loadAdminData(exam.id)
    } catch (err) {
      showError(err)
    }
  }

  async function confirmDeleteExam() {
    if (!deleteExamCandidate) return
    setStatus({ loading: true, error: '', success: '' })
    try {
      await apiRequest(`/exams/${deleteExamCandidate.id}`, {
        method: 'DELETE',
        token,
      })
      const remainingExams = exams.filter((exam) => exam.id !== deleteExamCandidate.id)
      const nextExamId = remainingExams[0]?.id ?? null
      setDeleteExamCandidate(null)
      setStatus({ loading: false, error: '', success: 'Exam deleted.' })
      await loadAdminData(nextExamId)
    } catch (err) {
      setDeleteExamCandidate(null)
      showError(err)
    }
  }

  async function handleCreateUser(event) {
    event.preventDefault()
    if (userForm.role === 'student' && !userForm.register_number.trim()) {
      setStatus({ loading: false, error: 'Register number is required for student users.', success: '' })
      return
    }
    if (userForm.role === 'student' && !userForm.department.trim()) {
      setStatus({ loading: false, error: 'Department is required for student users.', success: '' })
      return
    }
    if (userForm.role === 'student' && !DEPARTMENT_OPTIONS.includes(userForm.department.trim())) {
      setStatus({ loading: false, error: 'Choose a valid department for student users.', success: '' })
      return
    }
    if (userForm.role === 'student' && !userForm.class_name.trim()) {
      setStatus({ loading: false, error: 'Year is required for student users.', success: '' })
      return
    }
    if (userForm.role === 'student' && !YEAR_OPTIONS.includes(userForm.class_name.trim())) {
      setStatus({ loading: false, error: 'Choose a valid year for student users.', success: '' })
      return
    }

    setStatus({ loading: true, error: '', success: '' })
    try {
      await apiRequest('/auth/users', {
        method: 'POST',
        token,
        body: {
          email: userForm.email.trim().toLowerCase(),
          full_name: userForm.full_name.trim(),
          password: userForm.password,
          role: userForm.role,
          register_number: userForm.register_number.trim(),
          department: userForm.department.trim(),
          batch: '',
          class_name: userForm.class_name.trim(),
          is_active: true,
          is_superuser: false,
        },
      })
      setUserForm({
        full_name: '',
        email: '',
        password: '',
        role: 'student',
        department: '',
        class_name: '',
        register_number: '',
      })
      setStatus({ loading: false, error: '', success: 'User created.' })
      await loadAdminData(selectedExam?.id ?? null)
    } catch (err) {
      showError(err)
    }
  }

  async function toggleUserActive(user) {
    setStatus({ loading: true, error: '', success: '' })
    try {
      await apiRequest(`/auth/users/${user.id}`, {
        method: 'PATCH',
        token,
        body: { is_active: !user.is_active },
      })
      setStatus({
        loading: false,
        error: '',
        success: user.is_active ? 'User deactivated.' : 'User reactivated.',
      })
      await loadAdminData(selectedExam?.id ?? null)
    } catch (err) {
      showError(err)
    }
  }

  async function resetPassword(event) {
    event.preventDefault()
    if (!resetState.userId || !resetState.password) return
    setStatus({ loading: true, error: '', success: '' })
    try {
      await apiRequest(`/auth/users/${resetState.userId}/reset-password`, {
        method: 'POST',
        token,
        body: { new_password: resetState.password },
      })
      setResetState({ userId: null, password: '' })
      setStatus({ loading: false, error: '', success: 'Password reset successfully.' })
      await loadAdminData(selectedExam?.id ?? null)
    } catch (err) {
      showError(err)
    }
  }

  function getTotalMarks(exam) {
    return exam?.questions?.reduce((total, question) => total + Number(question.marks || 0), 0) ?? 0
  }

  function getAnswerMaxMarks(submission, answer) {
    const exam = examById.get(submission.exam_id)
    const question = exam?.questions?.find((item) => item.id === answer.question_id)
    return Number(question?.marks ?? 0)
  }

  function getStudentYear(submission) {
    return submission.student_class_name ?? submission.student_batch ?? ''
  }

  async function openSubmissionDetail(submissionId) {
    setSubmissionDetailState({
      isOpen: true,
      loading: true,
      error: '',
      submission: null,
    })
    try {
      const detail = await apiRequest(`/exams/submissions/${submissionId}`, { token })
      setSubmissionDetailState({
        isOpen: true,
        loading: false,
        error: '',
        submission: detail,
      })
    } catch (err) {
      if (handleAuthenticatedError(err, onAuthExpired)) return
      setSubmissionDetailState({
        isOpen: true,
        loading: false,
        error: err.message,
        submission: null,
      })
    }
  }

  function closeSubmissionDetail() {
    setSubmissionDetailState({
      isOpen: false,
      loading: false,
      error: '',
      submission: null,
    })
  }

  function exportExamMarksCsv() {
    const examId = Number(resultExportExamId)
    const exam = examById.get(examId)
    if (!exam) {
      setStatus({ loading: false, error: 'Select an exam before downloading marks.', success: '' })
      return
    }

    const totalMarks = getTotalMarks(exam)
    const rows = submissions
      .filter((submission) => Number(submission.exam_id) === examId)
      .map((submission) => {
        const hasScore = submission.score !== null && submission.score !== undefined
        const score = hasScore ? Number(submission.score) : null
        const isSubmitted = submission.status === 'submitted'
        return {
          exam_title: exam.title,
          student_name: submission.student_full_name,
          email: submission.student_email,
          register_number: submission.student_register_number ?? '',
          department: submission.student_department ?? '',
          year: getStudentYear(submission),
          score: hasScore ? score : '',
          total_marks: totalMarks,
          percentage: hasScore && totalMarks ? ((score / totalMarks) * 100).toFixed(2) : '',
          status: isSubmitted && hasScore ? (score >= 50 ? 'Pass' : 'Fail') : 'In Progress',
          submitted_at: submission.submitted_at ?? '',
        }
      })

    if (!downloadCsv(`${sanitizeCsvFilename(exam.title)}-marks.csv`, [
      'exam_title',
      'student_name',
      'email',
      'register_number',
      'department',
      'year',
      'score',
      'total_marks',
      'percentage',
      'status',
      'submitted_at',
    ], rows)) {
      setStatus({ loading: false, error: 'No submissions are available for the selected exam.', success: '' })
      return
    }
    setStatus({ loading: false, error: '', success: 'Exam marks CSV downloaded.' })
  }

  function exportStudentPerformanceCsv(submission) {
    const exam = examById.get(submission.exam_id)
    const totalMarks = getTotalMarks(exam)
    const submissionAnswers = submission.answers ?? []
    const totalScore = submission.score ?? submissionAnswers.reduce(
      (total, answer) => total + Number(answer.marks_awarded || 0),
      0,
    )
    const rows = [
      ...submissionAnswers.map((answer, index) => ({
        exam_title: exam?.title ?? `Exam ${submission.exam_id}`,
        student_name: submission.student_full_name,
        email: submission.student_email,
        register_number: submission.student_register_number ?? '',
        department: submission.student_department ?? '',
        year: getStudentYear(submission),
        submitted_at: submission.submitted_at ?? '',
        question_no: index + 1,
        question: answer.question_prompt,
        student_answer: answer.selected_option_text ?? '',
        correct_answer: answer.correct_option_text ?? '',
        marks_awarded: answer.marks_awarded,
        max_marks: getAnswerMaxMarks(submission, answer),
        status: getSubmissionAnswerStatus(answer),
      })),
      {
        exam_title: 'TOTAL',
        student_name: '',
        email: '',
        register_number: '',
        department: '',
        year: '',
        submitted_at: '',
        question_no: '',
        question: '',
        student_answer: '',
        correct_answer: '',
        marks_awarded: totalScore,
        max_marks: totalMarks,
        status: '',
      },
    ]

    if (!downloadCsv(`${sanitizeCsvFilename(submission.student_full_name)}-performance.csv`, [
      'exam_title',
      'student_name',
      'email',
      'register_number',
      'department',
      'year',
      'submitted_at',
      'question_no',
      'question',
      'student_answer',
      'correct_answer',
      'marks_awarded',
      'max_marks',
      'status',
    ], rows)) {
      setStatus({ loading: false, error: 'No performance rows are available for this submission.', success: '' })
      return
    }
    setStatus({ loading: false, error: '', success: 'Student performance CSV downloaded.' })
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
          <Metric label="Exams" value={dashboardSummary.total_exams} />
          <Metric label="Published" value={dashboardSummary.published_exams} />
          <Metric label="Drafts" value={dashboardSummary.draft_exams} />
          <Metric label="Students" value={dashboardSummary.total_students} />
          <Metric label="Admins" value={dashboardSummary.total_admins} />
          <Metric label="Submissions" value={dashboardSummary.total_submissions} />
          <Metric
            label="Average score"
            value={dashboardSummary.average_score === null ? '-' : dashboardSummary.average_score.toFixed(1)}
          />
        </div>
      </section>

      {status.error ? <p className="notice error">{status.error}</p> : null}
      {status.success ? <p className="notice success">{status.success}</p> : null}

      <div className="segmented-control admin-tabs" aria-label="Admin dashboard sections">
        <button className={activeTab === 'exams' ? 'active' : ''} type="button" onClick={() => setActiveTab('exams')}>
          <ClipboardList size={16} aria-hidden="true" />
          Exams
        </button>
        <button className={activeTab === 'users' ? 'active' : ''} type="button" onClick={() => setActiveTab('users')}>
          <Users size={16} aria-hidden="true" />
          Users
        </button>
        <button className={activeTab === 'results' ? 'active' : ''} type="button" onClick={() => setActiveTab('results')}>
          <Flag size={16} aria-hidden="true" />
          Results
        </button>
        <button className={activeTab === 'activity' ? 'active' : ''} type="button" onClick={() => setActiveTab('activity')}>
          <ShieldCheck size={16} aria-hidden="true" />
          Activity Log
        </button>
      </div>

      {activeTab === 'exams' ? (
        <>
          <section className="content-grid admin-grid">
            <div className="main-column">
              <div className="section-title-row">
                <SectionTitle icon={ClipboardList} eyebrow="Catalog" title="Exams" />
                <button
                  className="primary-button"
                  type="button"
                  onClick={createNewExam}
                  disabled={isCreatingExam || status.loading}
                >
                  {isCreatingExam ? (
                    <Loader2 className="spin" size={18} aria-hidden="true" />
                  ) : (
                    <PlusCircle size={18} aria-hidden="true" />
                  )}
                  Add New Exam
                </button>
              </div>
              <div className="segmented-control exam-list-tabs" aria-label="Exam folders">
                <button
                  className={examListTab === 'active' ? 'active' : ''}
                  type="button"
                  onClick={() => setExamListTab('active')}
                >
                  Active Exams ({activeExams.length})
                </button>
                <button
                  className={examListTab === 'archived' ? 'active' : ''}
                  type="button"
                  onClick={() => setExamListTab('archived')}
                >
                  Archived Exams ({archivedExams.length})
                </button>
              </div>
              {status.loading && exams.length === 0 ? <LoadingBlock label="Loading exams" /> : null}
              <div className="exam-list">
                {visibleExamList.map((exam) => {
                  const hasSubmissions = (submissionCountByExamId.get(exam.id) ?? 0) > 0
                  return (
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
                      <span>{exam.is_archived ? 'Archived' : exam.is_published ? 'Published' : 'Draft'}</span>
                      <span>{exam.is_result_published ? 'Results Published' : 'Results Not Published'}</span>
                      <span>{submissionCountByExamId.get(exam.id) ?? 0} submissions</span>
                    </div>
                    <div className="card-actions">
                      {!exam.is_archived ? (
                        <>
                          <button className="secondary-button" type="button" onClick={() => selectExam(exam.id)}>
                            <Edit size={16} aria-hidden="true" />
                            Edit
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => togglePublished(exam)}
                            disabled={status.loading}
                          >
                            {exam.is_published ? 'Unpublish' : 'Publish'}
                          </button>
                        </>
                      ) : null}
                      <button className="secondary-button" type="button" onClick={() => toggleArchived(exam)}>
                        <Archive size={16} aria-hidden="true" />
                        {exam.is_archived ? 'Unarchive' : 'Archive'}
                      </button>
                      {!exam.is_archived ? (
                        <button
                          className="secondary-button"
                          type="button"
                          onClick={() => toggleResultsPublished(exam)}
                          disabled={status.loading}
                        >
                          <CheckCircle2 size={16} aria-hidden="true" />
                          {exam.is_result_published ? 'Unpublish Results' : 'Publish Results'}
                        </button>
                      ) : null}
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => {
                          setActiveTab('results')
                          void selectExam(exam.id)
                        }}
                      >
                        <Eye size={16} aria-hidden="true" />
                        View Submissions
                      </button>
                      {!hasSubmissions ? (
                        <button
                          className="secondary-button danger-button"
                          type="button"
                          onClick={() => setDeleteExamCandidate(exam)}
                        >
                          <Trash2 size={16} aria-hidden="true" />
                          Delete
                        </button>
                      ) : null}
                    </div>
                  </article>
                  )
                })}
                {visibleExamList.length === 0 && !status.loading ? (
                  <p className="empty-state">
                    {examListTab === 'archived' ? 'No archived exams yet.' : 'No active exams exist yet.'}
                  </p>
                ) : null}
              </div>
            </div>

            <aside className="side-column forms-column">
              <ExamBuilder
                selectedExam={selectedExam}
                isSaving={status.loading}
                onSaveDraft={(draft) => persistBuilderDraft(draft, false)}
                onPublish={(draft) => persistBuilderDraft(draft, true)}
                onDeleteQuestion={deleteBuilderQuestion}
                onImportWord={importWordQuestions}
              />
            </aside>
          </section>

          {selectedExam ? <AdminExamDetails exam={selectedExam} /> : null}
        </>
      ) : null}

      {activeTab === 'users' ? (
        <section className="content-grid user-management-grid">
          <div className="main-column">
            <div className="section-title-row">
              <SectionTitle icon={Users} eyebrow="Directory" title="Users" />
              <div className="user-tools">
                <label className="search-box">
                  <Search size={16} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Search users"
                    value={userSearch}
                    onChange={(event) => setUserSearch(event.target.value)}
                  />
                </label>
                <select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
                  <option value="all">All roles</option>
                  <option value="admin">Admins</option>
                  <option value="student">Students</option>
                </select>
              </div>
            </div>
            <div className="user-list">
              {filteredUsers.map((user) => (
                <article className="user-card" key={user.id}>
                  <div>
                    <div className="panel-title-row">
                      <h3>{user.full_name}</h3>
                      <div className="exam-meta">
                        <span>{user.role}</span>
                        <span>{user.is_active ? 'Active' : 'Inactive'}</span>
                        {user.is_superuser ? <span>Superuser</span> : null}
                      </div>
                    </div>
                    <p className="empty-state">{user.email}</p>
                    <p className="empty-state">
                      {[user.register_number, user.department, user.class_name || user.batch].filter(Boolean).join(' - ') || 'No academic metadata'}
                    </p>
                  </div>
                  <div className="card-actions">
                    <button className="secondary-button" type="button" onClick={() => toggleUserActive(user)}>
                      {user.is_active ? <UserX size={16} aria-hidden="true" /> : <UserCheck size={16} aria-hidden="true" />}
                      {user.is_active ? 'Deactivate' : 'Reactivate'}
                    </button>
                    <button
                      className="secondary-button"
                      type="button"
                      onClick={() => setResetState({ userId: user.id, password: '' })}
                    >
                      <KeyRound size={16} aria-hidden="true" />
                      Reset Password
                    </button>
                  </div>
                  {resetState.userId === user.id ? (
                    <form className="inline-reset-form" onSubmit={resetPassword}>
                      <label>
                        New password
                        <input
                          type="password"
                          value={resetState.password}
                          onChange={(event) =>
                            setResetState((current) => ({ ...current, password: event.target.value }))
                          }
                          minLength={8}
                          required
                        />
                      </label>
                      <button className="primary-button" type="submit">Save</button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => setResetState({ userId: null, password: '' })}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : null}
                </article>
              ))}
              {filteredUsers.length === 0 ? <p className="empty-state">No users match the current filters.</p> : null}
            </div>
          </div>

          <aside className="side-column">
            <form className="tool-panel form-grid" onSubmit={handleCreateUser}>
              <SectionTitle icon={UserPlus} eyebrow="Create" title="New user" />
              <label>
                Full Name
                <input
                  value={userForm.full_name}
                  onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))}
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={userForm.email}
                  onChange={(event) => setUserForm((current) => ({ ...current, email: event.target.value }))}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))}
                  minLength={8}
                  required
                />
              </label>
              <label>
                Role
                <select
                  value={userForm.role}
                  onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}
                >
                  <option value="student">Student</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <label>
                Department
                <select
                  value={userForm.department}
                  onChange={(event) => setUserForm((current) => ({ ...current, department: event.target.value }))}
                  required={userForm.role === 'student'}
                >
                  <option value="">Select department</option>
                  {DEPARTMENT_OPTIONS.map((department) => (
                    <option value={department} key={department}>
                      {department}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Year
                <select
                  value={userForm.class_name}
                  onChange={(event) => setUserForm((current) => ({ ...current, class_name: event.target.value }))}
                  required={userForm.role === 'student'}
                >
                  <option value="">Select year</option>
                  {YEAR_OPTIONS.map((year) => (
                    <option value={year} key={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Register Number
                <input
                  value={userForm.register_number}
                  onChange={(event) => setUserForm((current) => ({ ...current, register_number: event.target.value }))}
                  required={userForm.role === 'student'}
                />
              </label>
              <button className="primary-button" type="submit" disabled={status.loading}>
                <UserPlus size={16} aria-hidden="true" />
                Create User
              </button>
            </form>
          </aside>
        </section>
      ) : null}

      {activeTab === 'results' ? (
        <section className="details-band results-workspace">
          <div className="panel-title-row">
            <SectionTitle icon={Flag} eyebrow="Results" title="Submission results" />
            <div className="table-actions">
              <select
                value={resultExportExamId}
                onChange={(event) => setResultExportExamId(event.target.value)}
                aria-label="Exam for marks CSV"
              >
                <option value="">Select exam for marks CSV</option>
                {exams.map((exam) => (
                  <option value={exam.id} key={exam.id}>
                    {exam.title}
                  </option>
                ))}
              </select>
              <button
                className="primary-button"
                type="button"
                onClick={exportExamMarksCsv}
                disabled={!resultExportExamId}
              >
                <Download size={16} aria-hidden="true" />
                Download Exam Marks CSV
              </button>
            </div>
          </div>

          <div className="results-filter-bar">
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search exam by title or subject..."
                value={resultExamSearch}
                onChange={(event) => setResultExamSearch(event.target.value)}
              />
            </label>
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search student by name, email, or register number..."
                value={resultStudentSearch}
                onChange={(event) => setResultStudentSearch(event.target.value)}
              />
            </label>
            <select
              value={resultStatusFilter}
              onChange={(event) => setResultStatusFilter(event.target.value)}
              aria-label="Submission status"
            >
              <option value="all">All</option>
              <option value="submitted">Submitted</option>
              <option value="in_progress">In Progress</option>
            </select>
            <select
              value={resultPublishFilter}
              onChange={(event) => setResultPublishFilter(event.target.value)}
              aria-label="Result publication status"
            >
              <option value="all">All</option>
              <option value="published">Results Published</option>
              <option value="not-published">Results Not Published</option>
            </select>
          </div>

          <div className="results-table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Exam title</th>
                  <th>Student name</th>
                  <th>Register number</th>
                  <th>Department</th>
                  <th>Year</th>
                  <th>Score</th>
                  <th>Submission status</th>
                  <th>Submitted time</th>
                  <th>Result status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredResultSubmissions.map((submission) => {
                  const exam = examById.get(submission.exam_id)
                  return (
                    <tr key={submission.id}>
                      <td>{exam?.title ?? `Exam ${submission.exam_id}`}</td>
                      <td>
                        <strong>{submission.student_full_name}</strong>
                        <span>{submission.student_email}</span>
                      </td>
                      <td>{submission.student_register_number ?? '-'}</td>
                      <td>{submission.student_department ?? '-'}</td>
                      <td>{getStudentYear(submission) || '-'}</td>
                      <td>{submission.score ?? '-'}</td>
                      <td>{submission.status === 'submitted' ? 'Submitted' : 'In Progress'}</td>
                      <td>{formatDateTime(submission.submitted_at)}</td>
                      <td>{exam?.is_result_published ? 'Results Published' : 'Results Not Published'}</td>
                      <td>
                        <div className="table-actions">
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => openSubmissionDetail(submission.id)}
                          >
                            <Eye size={16} aria-hidden="true" />
                            View
                          </button>
                          <button
                            className="secondary-button"
                            type="button"
                            onClick={() => exportStudentPerformanceCsv(submission)}
                          >
                            <Download size={16} aria-hidden="true" />
                            Performance
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {filteredResultSubmissions.length === 0 ? (
            <p className="empty-state">No submissions match your search.</p>
          ) : null}

          <SubmissionReviewPanel submissions={filteredResultSubmissions} />
        </section>
      ) : null}

      {activeTab === 'activity' ? (
        <section className="details-band results-workspace">
          <div className="panel-title-row">
            <SectionTitle icon={ShieldCheck} eyebrow="Audit" title="Activity Log" />
            <div className="exam-meta">
              <span>{activityLogs.length} recorded</span>
            </div>
          </div>

          <div className="activity-filter-bar">
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search activity"
                value={activitySearch}
                onChange={(event) => setActivitySearch(event.target.value)}
              />
            </label>
            <select
              value={activityActionFilter}
              onChange={(event) => setActivityActionFilter(event.target.value)}
              aria-label="Activity action"
            >
              <option value="all">All actions</option>
              {activityActionOptions.map((action) => (
                <option value={action} key={action}>
                  {formatActivityAction(action)}
                </option>
              ))}
            </select>
          </div>

          {filteredActivityLogs.length > 0 ? (
            <div className="results-table-wrap">
              <table className="results-table activity-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Admin</th>
                    <th>Entity</th>
                    <th>Details</th>
                    <th>Time</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredActivityLogs.map((log) => (
                    <tr key={log.id}>
                      <td>{formatActivityAction(log.action)}</td>
                      <td>{log.admin_email ?? 'System'}</td>
                      <td>
                        <strong>{log.entity_type ?? '-'}</strong>
                        <span>{log.entity_id ?? '-'}</span>
                      </td>
                      <td>{formatActivityDetails(log.details)}</td>
                      <td>{formatDateTime(log.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty-state">
              {activityLogs.length === 0 ? 'No activity recorded yet.' : 'No activity matches your filters.'}
            </p>
          )}
        </section>
      ) : null}

      {submissionDetailState.isOpen ? (
        <SubmissionDetailModal
          detailState={submissionDetailState}
          exam={submissionDetailState.submission ? examById.get(submissionDetailState.submission.exam_id) : null}
          getAnswerMaxMarks={getAnswerMaxMarks}
          getStudentYear={getStudentYear}
          onClose={closeSubmissionDetail}
          onDownload={exportStudentPerformanceCsv}
        />
      ) : null}

      {deleteExamCandidate ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-exam-title">
            <button
              className="icon-button modal-close"
              type="button"
              onClick={() => setDeleteExamCandidate(null)}
              aria-label="Close delete exam confirmation"
            >
              <X size={18} aria-hidden="true" />
            </button>
            <SectionTitle icon={Trash2} eyebrow="Confirm delete" title="Delete exam" />
            <p id="delete-exam-title" className="empty-state">
              Are you sure you want to delete this exam? This action cannot be undone.
            </p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setDeleteExamCandidate(null)}>
                Cancel
              </button>
              <button className="primary-button danger-fill-button" type="button" onClick={confirmDeleteExam}>
                Delete Exam
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  )
}

function AdminExamDetails({ exam }) {
  return (
    <section className="details-band">
      <SectionTitle icon={BookOpenCheck} eyebrow="Selected exam" title={exam.title} />
      <div className="exam-meta details-status-row">
        <span>{exam.is_archived ? 'Archived' : exam.is_published ? 'Published' : 'Draft'}</span>
        <span>{exam.is_result_published ? 'Results Published' : 'Results Not Published'}</span>
      </div>
      {exam.instructions ? (
        <div className="exam-instructions details-instructions">
          <strong>Exam Instructions</strong>
          <p>{exam.instructions}</p>
        </div>
      ) : null}
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

function SubmissionDetailModal({
  detailState,
  exam,
  getAnswerMaxMarks,
  getStudentYear,
  onClose,
  onDownload,
}) {
  const submission = detailState.submission
  const totalMarks = exam?.questions?.reduce((total, question) => total + Number(question.marks || 0), 0) ?? 0

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-panel submission-detail-modal" role="dialog" aria-modal="true" aria-labelledby="submission-detail-title">
        <button
          className="icon-button modal-close"
          type="button"
          onClick={onClose}
          aria-label="Close submission details"
        >
          <X size={18} aria-hidden="true" />
        </button>

        <SectionTitle icon={Eye} eyebrow="Submission" title="Student performance" />

        {detailState.loading ? <LoadingBlock label="Loading submission details" /> : null}
        {detailState.error ? <p className="notice error">{detailState.error}</p> : null}

        {!detailState.loading && !detailState.error && submission ? (
          <>
            <div className="submission-detail-grid">
              <div>
                <span>Student name</span>
                <strong>{submission.student_full_name}</strong>
              </div>
              <div>
                <span>Email</span>
                <strong>{submission.student_email}</strong>
              </div>
              <div>
                <span>Register number</span>
                <strong>{submission.student_register_number ?? '-'}</strong>
              </div>
              <div>
                <span>Department</span>
                <strong>{submission.student_department ?? '-'}</strong>
              </div>
              <div>
                <span>Year</span>
                <strong>{getStudentYear(submission) || '-'}</strong>
              </div>
              <div>
                <span>Exam title</span>
                <strong>{exam?.title ?? `Exam ${submission.exam_id}`}</strong>
              </div>
              <div>
                <span>Submission status</span>
                <strong>{submission.status === 'submitted' ? 'Submitted' : 'In Progress'}</strong>
              </div>
              <div>
                <span>Submitted time</span>
                <strong>{formatDateTime(submission.submitted_at)}</strong>
              </div>
              <div>
                <span>Total score</span>
                <strong>{submission.score ?? '-'} / {totalMarks}</strong>
              </div>
            </div>

            <div className="panel-title-row">
              <h3 id="submission-detail-title">Question-wise answers</h3>
              <button className="secondary-button" type="button" onClick={() => onDownload(submission)}>
                <Download size={16} aria-hidden="true" />
                Download Student Performance
              </button>
            </div>

            <div className="answer-review-grid">
              {(submission.answers ?? []).map((answer, index) => {
                const statusLabel = getSubmissionAnswerStatus(answer)
                return (
                  <div
                    className={`answer-review-item ${statusLabel === 'Correct' ? 'correct' : 'wrong'}`}
                    key={answer.id}
                  >
                    <strong>{index + 1}. {answer.question_prompt}</strong>
                    <span>Student answer: {answer.selected_option_text ?? 'Unanswered'}</span>
                    <span>Correct answer: {answer.correct_option_text ?? 'Not set'}</span>
                    <span>Marks awarded: {answer.marks_awarded} / {getAnswerMaxMarks(submission, answer)}</span>
                    <span>Status: {statusLabel}</span>
                    {answer.is_marked_for_review ? <span className="review-note">Marked for review</span> : null}
                  </div>
                )
              })}
              {(submission.answers ?? []).length === 0 ? (
                <p className="empty-state">No question-wise answers were saved for this submission.</p>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}

function SubmissionReviewPanel({ submissions }) {
  function getStudentDetails(submission) {
    const year = submission.student_class_name ?? submission.student_batch
    return [
      submission.student_register_number,
      submission.student_department,
      year,
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
