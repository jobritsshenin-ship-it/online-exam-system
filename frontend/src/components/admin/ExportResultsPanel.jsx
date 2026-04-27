import { useMemo, useState } from 'react'
import { Download, FileDown } from 'lucide-react'
import { downloadCsv } from '../../utils/csv'

const summaryHeaders = [
  'student_id',
  'student_name',
  'department',
  'batch',
  'class_name',
  'exam_id',
  'exam_title',
  'exam_date',
  'marks_scored',
  'total_marks',
  'percentage',
  'status',
]

const detailedHeaders = [
  'student_id',
  'student_name',
  'department',
  'batch',
  'class_name',
  'exam_id',
  'exam_title',
  'question_number',
  'question_text',
  'option1',
  'option2',
  'option3',
  'option4',
  'selected_answer',
  'correct_answer',
  'marks_awarded',
]

function getTotalMarks(exam) {
  return exam?.questions?.reduce((total, question) => total + Number(question.marks || 0), 0) ?? 0
}

function getPercentage(score, total) {
  if (!total) return ''
  return ((Number(score || 0) / total) * 100).toFixed(2)
}

function getStatus(score, total) {
  if (!total) return ''
  return Number(score || 0) / total >= 0.5 ? 'pass' : 'fail'
}

function getStudentIdentifier(submission) {
  return submission.student_register_number || submission.student_id
}

function optionTexts(question) {
  const options = [...(question?.options ?? [])].sort((a, b) => a.sort_order - b.sort_order)
  return {
    option1: options[0]?.text ?? '',
    option2: options[1]?.text ?? '',
    option3: options[2]?.text ?? '',
    option4: options[3]?.text ?? '',
  }
}

export function ExportResultsPanel({ exams, selectedExam, submissions, onSelectExam }) {
  const [selectedExamId, setSelectedExamId] = useState(selectedExam?.id ?? '')
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [message, setMessage] = useState('')

  const examForExport = selectedExam
  const submittedRows = submissions.filter((submission) => submission.status === 'submitted')
  const totalMarks = getTotalMarks(examForExport)

  const studentOptions = useMemo(() => {
    const uniqueStudents = new Map()
    submissions.forEach((submission) => {
      if (!uniqueStudents.has(submission.student_id)) {
        uniqueStudents.set(submission.student_id, {
          id: submission.student_id,
          identifier: getStudentIdentifier(submission),
          name: submission.student_full_name,
          email: submission.student_email,
        })
      }
    })
    return Array.from(uniqueStudents.values())
  }, [submissions])

  function handleExamSelect(value) {
    setSelectedExamId(value)
    setSelectedStudentId('')
    setMessage('')
    if (value) {
      onSelectExam(Number(value))
    }
  }

  function exportSummary() {
    const rows = submittedRows.map((submission) => ({
      student_id: getStudentIdentifier(submission),
      student_name: submission.student_full_name,
      department: submission.student_department ?? '',
      batch: submission.student_batch ?? '',
      class_name: submission.student_class_name ?? '',
      exam_id: examForExport?.id ?? submission.exam_id,
      exam_title: examForExport?.title ?? `Exam ${submission.exam_id}`,
      exam_date: submission.submitted_at ?? submission.started_at ?? '',
      marks_scored: submission.score ?? 0,
      total_marks: totalMarks,
      percentage: getPercentage(submission.score, totalMarks),
      status: getStatus(submission.score, totalMarks),
    }))

    if (!downloadCsv('student-performance-summary.csv', summaryHeaders, rows)) {
      setMessage('No submitted results are available for summary export.')
      return
    }
    setMessage('Summary CSV exported.')
  }

  function exportDetailed() {
    const selectedSubmission = submissions.find(
      (submission) => submission.student_id === Number(selectedStudentId),
    )

    if (!selectedExamId || !selectedSubmission) {
      setMessage('Select one exam and one student before exporting detailed responses.')
      return
    }

    if (!selectedSubmission.answers?.length) {
      setMessage('No detailed responses exist for the selected student and exam.')
      return
    }

    const rows = selectedSubmission.answers.map((answer, index) => {
      const question = examForExport?.questions?.find((item) => item.id === answer.question_id)
      const options = optionTexts(question)
      return {
        student_id: getStudentIdentifier(selectedSubmission),
        student_name: selectedSubmission.student_full_name,
        department: selectedSubmission.student_department ?? '',
        batch: selectedSubmission.student_batch ?? '',
        class_name: selectedSubmission.student_class_name ?? '',
        exam_id: examForExport?.id ?? selectedSubmission.exam_id,
        exam_title: examForExport?.title ?? `Exam ${selectedSubmission.exam_id}`,
        question_number: index + 1,
        question_text: answer.question_prompt,
        option1: options.option1,
        option2: options.option2,
        option3: options.option3,
        option4: options.option4,
        selected_answer: answer.selected_option_text ?? '',
        correct_answer: answer.correct_option_text ?? '',
        marks_awarded: answer.marks_awarded,
      }
    })

    if (!downloadCsv('student-detailed-response.csv', detailedHeaders, rows)) {
      setMessage('No detailed response rows are available to export.')
      return
    }
    setMessage('Detailed response CSV exported.')
  }

  return (
    <section className="details-band export-panel">
      <div className="panel-title-row">
        <div className="section-heading compact">
          <FileDown size={20} aria-hidden="true" />
          <div>
            <p className="eyebrow">Exports</p>
            <h2>Results CSV tools</h2>
          </div>
        </div>
        <button className="primary-button" type="button" onClick={exportSummary}>
          <Download size={16} aria-hidden="true" />
          Export Summary CSV
        </button>
      </div>

      <div className="export-controls">
        <label>
          Exam
          <select value={selectedExamId} onChange={(event) => handleExamSelect(event.target.value)}>
            <option value="">Select exam</option>
            {exams.map((exam) => (
              <option value={exam.id} key={exam.id}>
                {exam.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Student
          <select value={selectedStudentId} onChange={(event) => setSelectedStudentId(event.target.value)}>
            <option value="">Select student</option>
            {studentOptions.map((student) => (
              <option value={student.id} key={student.id}>
                {student.name} - {student.identifier} - {student.email}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button" type="button" onClick={exportDetailed}>
          <Download size={16} aria-hidden="true" />
          Export Detailed Response CSV
        </button>
      </div>

      {message ? <p className="notice success">{message}</p> : null}
    </section>
  )
}
