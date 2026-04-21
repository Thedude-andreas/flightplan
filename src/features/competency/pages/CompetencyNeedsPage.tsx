import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../../../lib/supabase/errors'
import { loadCompetencyWorkspace } from '../api/competencyRepository'
import type {
  CompetencyCourse,
  CompetencyDepartment,
  CompetencyGroup,
  CompetencyMember,
  CompetencyPermission,
  CompetencyTrainingEvent,
} from '../types'
import { addDays, computeStatusRows, formatDate } from '../utils'

type Workspace = {
  permission: CompetencyPermission | null
  departments: CompetencyDepartment[]
  groups: CompetencyGroup[]
  courses: CompetencyCourse[]
  members: CompetencyMember[]
  trainingEvents: CompetencyTrainingEvent[]
}

export function CompetencyNeedsPage() {
  const [workspace, setWorkspace] = useState<Workspace>({
    permission: null,
    departments: [],
    groups: [],
    courses: [],
    members: [],
    trainingEvents: [],
  })
  const [filters, setFilters] = useState({
    memberId: '',
    groupId: '',
    departmentId: '',
    courseId: '',
    from: new Date().toISOString().slice(0, 10),
    to: addDays(new Date(), 90).toISOString().slice(0, 10),
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError('')
      try {
        const nextWorkspace = await loadCompetencyWorkspace()
        setWorkspace({
          permission: nextWorkspace.permission,
          departments: nextWorkspace.departments,
          groups: nextWorkspace.groups,
          courses: nextWorkspace.courses,
          members: nextWorkspace.members,
          trainingEvents: nextWorkspace.trainingEvents,
        })
      } catch (nextError) {
        setError(getErrorMessage(nextError, 'Kunde inte läsa utbildningsbehov.'))
      } finally {
        setLoading(false)
      }
    }

    void loadData()
  }, [])

  const statusRows = useMemo(
    () => computeStatusRows(workspace.members, workspace.courses, workspace.trainingEvents),
    [workspace.courses, workspace.members, workspace.trainingEvents],
  )

  const filteredRows = statusRows.filter((row) => {
    if (row.status === 'valid') {
      return false
    }
    if (filters.memberId && row.memberId !== filters.memberId) {
      return false
    }
    if (filters.groupId && row.groupId !== filters.groupId) {
      return false
    }
    if (filters.departmentId && row.departmentId !== filters.departmentId) {
      return false
    }
    if (filters.courseId && row.courseId !== filters.courseId) {
      return false
    }
    if (row.status === 'missing_gu') {
      return true
    }
    if (!row.effectiveValidUntil) {
      return false
    }
    return row.effectiveValidUntil >= filters.from && row.effectiveValidUntil <= filters.to
  })

  if (loading) {
    return <div className="app-card">Laddar utbildningsbehov...</div>
  }

  if (!workspace.permission?.moduleAccess || filteredRows.length === 0 && workspace.members.length === 0) {
    return <div className="app-card"><h2>Saknar behörighet</h2><p>Den här sidan visas för administratörer, länsledning, gruppchefer och användare med rapportbehörighet.</p></div>
  }

  return (
    <article className="app-card competency-report-card">
      {error ? <p className="account-error">{error}</p> : null}

      <div className="competency-kpis">
        <article className="app-card">
          <h2>{workspace.members.length}</h2>
          <p>Synliga besättningsmedlemmar</p>
        </article>
        <article className="app-card">
          <h2>{statusRows.filter((row) => row.status === 'expired').length}</h2>
          <p>Förfallna utbildningar</p>
        </article>
        <article className="app-card">
          <h2>{statusRows.filter((row) => row.status === 'due_soon').length}</h2>
          <p>RU snart förfaller</p>
        </article>
        <article className="app-card">
          <h2>{statusRows.filter((row) => row.status === 'missing_gu').length}</h2>
          <p>GU saknas</p>
        </article>
      </div>

      <div className="competency-form-grid">
        <label>
          <span>Från</span>
          <input type="date" value={filters.from} onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))} />
        </label>
        <label>
          <span>Till</span>
          <input type="date" value={filters.to} onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))} />
        </label>
        <label>
          <span>Person</span>
          <select value={filters.memberId} onChange={(event) => setFilters((current) => ({ ...current, memberId: event.target.value }))}>
            <option value="">Alla</option>
            {workspace.members.map((member) => (
              <option key={member.id} value={member.id}>{member.fullName}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Grupp</span>
          <select value={filters.groupId} onChange={(event) => setFilters((current) => ({ ...current, groupId: event.target.value }))}>
            <option value="">Alla</option>
            {workspace.groups.map((group) => (
              <option key={group.id} value={group.id}>{group.departmentName} · {group.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Länsavdelning</span>
          <select value={filters.departmentId} onChange={(event) => setFilters((current) => ({ ...current, departmentId: event.target.value }))}>
            <option value="">Alla</option>
            {workspace.departments.map((department) => (
              <option key={department.id} value={department.id}>{department.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Utbildning</span>
          <select value={filters.courseId} onChange={(event) => setFilters((current) => ({ ...current, courseId: event.target.value }))}>
            <option value="">Alla</option>
            {workspace.courses.map((course) => (
              <option key={course.id} value={course.id}>{course.category} · {course.title}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="competency-table-wrapper">
        <table className="competency-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Län / grupp</th>
              <th>Kurs</th>
              <th>Status</th>
              <th>Senast GU</th>
              <th>Senast RU</th>
              <th>Giltig t.o.m.</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7}>Inga utbildningsbehov matchar filtreringen.</td>
              </tr>
            ) : filteredRows.map((row) => (
              <tr key={`${row.memberId}:${row.courseId}`}>
                <td>{row.fullName}</td>
                <td>{row.departmentName} · {row.groupName}</td>
                <td>{row.category} · {row.courseTitle}</td>
                <td>
                  <span className={`resource-pill resource-pill--${row.status === 'expired' ? 'error' : row.status === 'due_soon' ? 'warning' : 'dirty'}`}>
                    {row.status === 'missing_gu' ? 'GU saknas' : row.status === 'expired' ? 'Förfallen' : 'Snart RU'}
                  </span>
                </td>
                <td>{formatDate(row.latestGuCompletedOn)}</td>
                <td>{formatDate(row.latestRuCompletedOn)}</td>
                <td>{formatDate(row.effectiveValidUntil)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  )
}
