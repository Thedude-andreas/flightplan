import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { getErrorMessage } from '../../../lib/supabase/errors'
import { useAuth } from '../../auth/hooks/useAuth'
import {
  archiveCompetencyMember,
  createCompetencyTrainingEvent,
  loadCompetencyWorkspace,
  saveCompetencyMember,
} from '../api/competencyRepository'
import type {
  CompetencyCourse,
  CompetencyGroup,
  CompetencyMember,
  CompetencyPermission,
  CompetencyTrainingEvent,
} from '../types'
import { computeStatusRows, emptyMemberDraft, formatDate } from '../utils'

type Workspace = {
  permission: CompetencyPermission | null
  groups: CompetencyGroup[]
  courses: CompetencyCourse[]
  members: CompetencyMember[]
  trainingEvents: CompetencyTrainingEvent[]
}

export function CompetencyManagerPage() {
  const { user } = useAuth()
  const [workspace, setWorkspace] = useState<Workspace>({
    permission: null,
    groups: [],
    courses: [],
    members: [],
    trainingEvents: [],
  })
  const [selectedMemberId, setSelectedMemberId] = useState('')
  const [memberDraft, setMemberDraft] = useState(emptyMemberDraft([]))
  const [trainingDraft, setTrainingDraft] = useState({
    courseId: '',
    trainingKind: 'gu' as 'gu' | 'ru',
    completedOn: new Date().toISOString().slice(0, 10),
    note: '',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')

  async function loadData() {
    setLoading(true)
    setError('')
    try {
      const nextWorkspace = await loadCompetencyWorkspace()
      setWorkspace({
        permission: nextWorkspace.permission,
        groups: nextWorkspace.groups,
        courses: nextWorkspace.courses,
        members: nextWorkspace.members,
        trainingEvents: nextWorkspace.trainingEvents,
      })
      setSelectedMemberId((current) => current || nextWorkspace.members[0]?.id || '')
      setTrainingDraft((current) => ({
        ...current,
        courseId: current.courseId || nextWorkspace.courses[0]?.id || '',
      }))
      setMemberDraft((current) => (current.groupId ? current : emptyMemberDraft(nextWorkspace.groups)))
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte läsa gruppchefssidan.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const manageableGroups = useMemo(
    () =>
      workspace.groups.filter(
        (group) =>
          workspace.permission?.managePermissions ||
          workspace.permission?.manageCatalog ||
          group.managers.some((manager) => manager.userId === user?.id),
      ),
    [user?.id, workspace.groups, workspace.permission?.manageCatalog, workspace.permission?.managePermissions],
  )

  const selectedMember = workspace.members.find((member) => member.id === selectedMemberId) ?? null
  const selectedMemberEvents = workspace.trainingEvents.filter((event) => event.memberId === selectedMemberId)
  const selectedMemberStatuses = computeStatusRows(workspace.members, workspace.courses, workspace.trainingEvents).filter(
    (row) => row.memberId === selectedMemberId,
  )

  async function handleSaveMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving('member')
    setError('')
    try {
      const nextGroup = manageableGroups.find((group) => group.id === memberDraft.groupId)
      await saveCompetencyMember({
        id: memberDraft.id || undefined,
        memberNumber: memberDraft.memberNumber.trim() || null,
        fullName: memberDraft.fullName.trim(),
        email: memberDraft.email.trim() || null,
        phone: memberDraft.phone.trim() || null,
        departmentId: nextGroup?.departmentId ?? memberDraft.departmentId,
        groupId: memberDraft.groupId,
        notes: memberDraft.notes.trim() || null,
      })
      setMemberDraft(emptyMemberDraft(manageableGroups))
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte spara medlemmen.'))
    } finally {
      setSaving('')
    }
  }

  async function handleSaveTrainingEvent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedMember) {
      return
    }

    setSaving('training')
    setError('')
    try {
      await createCompetencyTrainingEvent({
        memberId: selectedMember.id,
        courseId: trainingDraft.courseId,
        trainingKind: trainingDraft.trainingKind,
        completedOn: trainingDraft.completedOn,
        note: trainingDraft.note.trim() || null,
      })
      setTrainingDraft((current) => ({ ...current, note: '' }))
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte registrera utbildningen.'))
    } finally {
      setSaving('')
    }
  }

  async function handleArchiveMember() {
    if (!selectedMember) {
      return
    }

    setSaving('archive')
    setError('')
    try {
      await archiveCompetencyMember(selectedMember.id)
      setSelectedMemberId('')
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte arkivera medlemmen.'))
    } finally {
      setSaving('')
    }
  }

  function openMemberEditor(member: CompetencyMember) {
    setSelectedMemberId(member.id)
    setMemberDraft({
      id: member.id,
      memberNumber: member.memberNumber ?? '',
      fullName: member.fullName,
      email: member.email ?? '',
      phone: member.phone ?? '',
      departmentId: member.departmentId,
      groupId: member.groupId,
      notes: member.notes ?? '',
    })
  }

  if (loading) {
    return <div className="app-card">Laddar gruppchefssida...</div>
  }

  if (!workspace.permission?.moduleAccess || manageableGroups.length === 0) {
    return <div className="app-card"><h2>Saknar gruppchefsbehörighet</h2><p>Den här sidan visas för administratörer och gruppchefer med minst en tilldelad grupp.</p></div>
  }

  return (
    <div className="competency-two-column">
      {error ? <p className="account-error competency-form-grid__wide">{error}</p> : null}

      <article className="app-card">
        <h2>{memberDraft.id ? 'Redigera besättningsmedlem' : 'Ny besättningsmedlem'}</h2>
        <form className="competency-form" onSubmit={handleSaveMember}>
          <div className="competency-form-grid">
            <label>
              <span>Medlemsnummer</span>
              <input value={memberDraft.memberNumber} onChange={(event) => setMemberDraft((current) => ({ ...current, memberNumber: event.target.value }))} />
            </label>
            <label>
              <span>Namn</span>
              <input required value={memberDraft.fullName} onChange={(event) => setMemberDraft((current) => ({ ...current, fullName: event.target.value }))} />
            </label>
            <label>
              <span>Email</span>
              <input type="email" value={memberDraft.email} onChange={(event) => setMemberDraft((current) => ({ ...current, email: event.target.value }))} />
            </label>
            <label>
              <span>Telefon</span>
              <input value={memberDraft.phone} onChange={(event) => setMemberDraft((current) => ({ ...current, phone: event.target.value }))} />
            </label>
            <label>
              <span>Grupp</span>
              <select value={memberDraft.groupId} onChange={(event) => {
                const nextGroup = manageableGroups.find((group) => group.id === event.target.value)
                setMemberDraft((current) => ({
                  ...current,
                  groupId: event.target.value,
                  departmentId: nextGroup?.departmentId ?? current.departmentId,
                }))
              }}>
                {manageableGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.departmentName} · {group.name}</option>
                ))}
              </select>
            </label>
            <label className="competency-form-grid__wide">
              <span>Notering</span>
              <textarea rows={4} value={memberDraft.notes} onChange={(event) => setMemberDraft((current) => ({ ...current, notes: event.target.value }))} />
            </label>
          </div>
          <div className="resource-list__actions">
            <button type="submit" disabled={saving === 'member'}>{saving === 'member' ? 'Sparar...' : 'Spara medlem'}</button>
            <button type="button" onClick={() => setMemberDraft(emptyMemberDraft(manageableGroups))}>Ny tom post</button>
          </div>
        </form>
      </article>

      <article className="app-card competency-detail-card">
        <div className="resource-list__header">
          <div>
            <h2>Besättningsmedlemmar</h2>
            <p>Välj en person för att registrera GU/RU och se historik inom dina grupper.</p>
          </div>
        </div>

        <div className="competency-member-list">
          {workspace.members.map((member) => (
            <button
              key={member.id}
              type="button"
              className={`competency-member-list__item ${selectedMemberId === member.id ? 'competency-member-list__item--active' : ''}`}
              onClick={() => setSelectedMemberId(member.id)}
            >
              <strong>{member.fullName}</strong>
              <span>{member.departmentName} · {member.groupName}</span>
              <span>{member.memberNumber || 'Saknar medlemsnummer'}</span>
            </button>
          ))}
        </div>

        {selectedMember ? (
          <>
            <div className="resource-list__header">
              <div>
                <h2>{selectedMember.fullName}</h2>
                <p>{selectedMember.departmentName} · {selectedMember.groupName}</p>
              </div>
              <div className="resource-list__actions">
                <button type="button" onClick={() => openMemberEditor(selectedMember)}>Redigera</button>
                <button type="button" className="button-link--danger" onClick={handleArchiveMember} disabled={saving === 'archive'}>Arkivera</button>
              </div>
            </div>

            <div className="competency-status-grid">
              {selectedMemberStatuses.map((row) => (
                <article key={row.courseId} className="competency-status-card">
                  <div className="competency-status-card__header">
                    <div>
                      <strong>{row.courseTitle}</strong>
                      <span>{row.category}</span>
                    </div>
                    <span className={`resource-pill resource-pill--${row.status === 'expired' ? 'error' : row.status === 'due_soon' ? 'warning' : row.status === 'missing_gu' ? 'dirty' : 'saved'}`}>
                      {row.status === 'missing_gu' ? 'GU saknas' : row.status === 'expired' ? 'Förfallen' : row.status === 'due_soon' ? 'Snart RU' : 'Giltig'}
                    </span>
                  </div>
                  <p>GU: {formatDate(row.latestGuCompletedOn)}</p>
                  <p>RU: {formatDate(row.latestRuCompletedOn)}</p>
                  <p>Giltig t.o.m.: {formatDate(row.effectiveValidUntil)}</p>
                </article>
              ))}
            </div>

            <form className="competency-form competency-inline-form" onSubmit={handleSaveTrainingEvent}>
              <h3>Registrera kurs</h3>
              <div className="competency-form-grid">
                <label>
                  <span>Kurs</span>
                  <select value={trainingDraft.courseId} onChange={(event) => setTrainingDraft((current) => ({ ...current, courseId: event.target.value }))}>
                    {workspace.courses.filter((course) => course.active).map((course) => (
                      <option key={course.id} value={course.id}>{course.category} · {course.title}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Typ</span>
                  <select value={trainingDraft.trainingKind} onChange={(event) => setTrainingDraft((current) => ({ ...current, trainingKind: event.target.value as 'gu' | 'ru' }))}>
                    <option value="gu">GU</option>
                    <option value="ru">RU</option>
                  </select>
                </label>
                <label>
                  <span>Datum</span>
                  <input type="date" value={trainingDraft.completedOn} onChange={(event) => setTrainingDraft((current) => ({ ...current, completedOn: event.target.value }))} />
                </label>
                <label className="competency-form-grid__wide">
                  <span>Notering</span>
                  <input value={trainingDraft.note} onChange={(event) => setTrainingDraft((current) => ({ ...current, note: event.target.value }))} />
                </label>
              </div>
              <button type="submit" disabled={saving === 'training'}>{saving === 'training' ? 'Sparar...' : 'Lägg till kursrad'}</button>
            </form>

            <div className="competency-table-wrapper">
              <table className="competency-table">
                <thead>
                  <tr>
                    <th>Kurs</th>
                    <th>Typ</th>
                    <th>Genomförd</th>
                    <th>Giltig t.o.m.</th>
                    <th>Notering</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedMemberEvents.length === 0 ? (
                    <tr>
                      <td colSpan={5}>Ingen historik registrerad ännu.</td>
                    </tr>
                  ) : selectedMemberEvents.map((event) => (
                    <tr key={event.id}>
                      <td>{event.courseTitle}</td>
                      <td>{event.trainingKind.toUpperCase()}</td>
                      <td>{formatDate(event.completedOn)}</td>
                      <td>{formatDate(event.validUntil)}</td>
                      <td>{event.note || 'Ingen notering'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </article>
    </div>
  )
}
