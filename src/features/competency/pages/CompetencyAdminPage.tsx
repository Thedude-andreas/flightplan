import { useEffect, useState, type FormEvent } from 'react'
import { getErrorMessage } from '../../../lib/supabase/errors'
import {
  createCompetencyDepartment,
  createCompetencyGroup,
  loadCompetencyWorkspace,
  replaceCompetencyDepartmentLeaders,
  replaceCompetencyGroupManagers,
  saveCompetencyCourse,
  upsertCompetencyPermission,
} from '../api/competencyRepository'
import type {
  CompetencyCourse,
  CompetencyDepartment,
  CompetencyGroup,
  CompetencyPermission,
  CompetencyPermissionEntry,
  CompetencyProfileOption,
} from '../types'
import { formatDisplayName, emptyCourseDraft } from '../utils'

type Workspace = {
  permission: CompetencyPermission | null
  departments: CompetencyDepartment[]
  groups: CompetencyGroup[]
  profiles: CompetencyProfileOption[]
  permissionEntries: CompetencyPermissionEntry[]
  courses: CompetencyCourse[]
}

export function CompetencyAdminPage() {
  const [workspace, setWorkspace] = useState<Workspace>({
    permission: null,
    departments: [],
    groups: [],
    profiles: [],
    permissionEntries: [],
    courses: [],
  })
  const [departmentName, setDepartmentName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [groupDepartmentId, setGroupDepartmentId] = useState('')
  const [selectedDepartmentId, setSelectedDepartmentId] = useState('')
  const [departmentLeaderUserIds, setDepartmentLeaderUserIds] = useState<string[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState('')
  const [groupManagerUserIds, setGroupManagerUserIds] = useState<string[]>([])
  const [courseDraft, setCourseDraft] = useState(emptyCourseDraft())
  const [permissionDraft, setPermissionDraft] = useState({
    userId: '',
    moduleAccess: true,
    manageCatalog: false,
    managePermissions: false,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState('')

  async function loadData() {
    setLoading(true)
    setError('')

    try {
      const nextWorkspace = await loadCompetencyWorkspace()
      setWorkspace({
        permission: nextWorkspace.permission,
        departments: nextWorkspace.departments,
        groups: nextWorkspace.groups,
        profiles: nextWorkspace.profiles,
        permissionEntries: nextWorkspace.permissionEntries,
        courses: nextWorkspace.courses,
      })
      setGroupDepartmentId((current) => current || nextWorkspace.departments[0]?.id || '')
      setSelectedDepartmentId((current) => current || nextWorkspace.departments[0]?.id || '')
      setSelectedGroupId((current) => current || nextWorkspace.groups[0]?.id || '')
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte läsa adminsidan.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  useEffect(() => {
    const department = workspace.departments.find((item) => item.id === selectedDepartmentId)
    setDepartmentLeaderUserIds(department?.leaders.map((leader) => leader.userId) ?? [])
  }, [selectedDepartmentId, workspace.departments])

  useEffect(() => {
    const group = workspace.groups.find((item) => item.id === selectedGroupId)
    setGroupManagerUserIds(group?.managers.map((manager) => manager.userId) ?? [])
  }, [selectedGroupId, workspace.groups])

  async function handleCreateDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving('department')
    setError('')
    try {
      await createCompetencyDepartment(departmentName.trim())
      setDepartmentName('')
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte skapa länsavdelningen.'))
    } finally {
      setSaving('')
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving('group')
    setError('')
    try {
      await createCompetencyGroup({ departmentId: groupDepartmentId, name: groupName.trim() })
      setGroupName('')
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte skapa gruppen.'))
    } finally {
      setSaving('')
    }
  }

  async function handleSaveDepartmentLeaders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving('department-leaders')
    setError('')
    try {
      await replaceCompetencyDepartmentLeaders(selectedDepartmentId, departmentLeaderUserIds)
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte spara länsledning.'))
    } finally {
      setSaving('')
    }
  }

  async function handleSaveGroupManagers(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving('group-managers')
    setError('')
    try {
      await replaceCompetencyGroupManagers(selectedGroupId, groupManagerUserIds)
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte spara gruppchefer.'))
    } finally {
      setSaving('')
    }
  }

  async function handleSavePermission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving('permission')
    setError('')
    try {
      await upsertCompetencyPermission({
        ...permissionDraft,
        viewReports: false,
      })
      setPermissionDraft((current) => ({ ...current, userId: '' }))
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte spara behörigheten.'))
    } finally {
      setSaving('')
    }
  }

  async function handleSaveCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving('course')
    setError('')
    try {
      await saveCompetencyCourse({
        id: courseDraft.id || undefined,
        courseCode: courseDraft.courseCode.trim(),
        title: courseDraft.title.trim(),
        category: courseDraft.category.trim(),
        description: courseDraft.description.trim() || null,
        guValidityMonths: courseDraft.guValidityMonths ? Number(courseDraft.guValidityMonths) : null,
        ruValidityMonths: courseDraft.ruValidityMonths ? Number(courseDraft.ruValidityMonths) : null,
        notificationLeadDays: Number(courseDraft.notificationLeadDays || '30'),
        active: courseDraft.active,
      })
      setCourseDraft(emptyCourseDraft())
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte spara kursen.'))
    } finally {
      setSaving('')
    }
  }

  if (loading) {
    return <div className="app-card">Laddar adminsida...</div>
  }

  if (!workspace.permission?.managePermissions && !workspace.permission?.manageCatalog) {
    return <div className="app-card"><h2>Saknar adminbehörighet</h2><p>Den här sidan kräver administrativ kompetensbehörighet.</p></div>
  }

  return (
    <div className="competency-two-column">
      {error ? <p className="account-error competency-form-grid__wide">{error}</p> : null}

      <article className="app-card">
        <h2>Organisation</h2>
        {workspace.permission.managePermissions ? (
          <>
            <form className="competency-form" onSubmit={handleCreateDepartment}>
              <div className="competency-form-grid">
                <label>
                  <span>Ny länsavdelning</span>
                  <input required value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} />
                </label>
              </div>
              <button type="submit" disabled={saving === 'department'}>{saving === 'department' ? 'Sparar...' : 'Skapa länsavdelning'}</button>
            </form>

            <form className="competency-form" onSubmit={handleCreateGroup}>
              <div className="competency-form-grid">
                <label>
                  <span>Länsavdelning</span>
                  <select value={groupDepartmentId} onChange={(event) => setGroupDepartmentId(event.target.value)}>
                    {workspace.departments.map((department) => (
                      <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Ny grupp</span>
                  <input required value={groupName} onChange={(event) => setGroupName(event.target.value)} />
                </label>
              </div>
              <button type="submit" disabled={saving === 'group'}>{saving === 'group' ? 'Sparar...' : 'Skapa grupp'}</button>
            </form>

            <form className="competency-form" onSubmit={handleSaveDepartmentLeaders}>
              <div className="competency-form-grid">
                <label>
                  <span>Länsavdelning</span>
                  <select value={selectedDepartmentId} onChange={(event) => setSelectedDepartmentId(event.target.value)}>
                    {workspace.departments.map((department) => (
                      <option key={department.id} value={department.id}>{department.name}</option>
                    ))}
                  </select>
                </label>
                <label className="competency-form-grid__wide">
                  <span>Länsledning</span>
                  <select
                    multiple
                    className="competency-multi-select"
                    value={departmentLeaderUserIds}
                    onChange={(event) => setDepartmentLeaderUserIds(Array.from(event.target.selectedOptions, (option) => option.value))}
                  >
                    {workspace.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{formatDisplayName(profile.displayName, profile.email)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" disabled={saving === 'department-leaders'}>{saving === 'department-leaders' ? 'Sparar...' : 'Spara länsledning'}</button>
            </form>

            <form className="competency-form" onSubmit={handleSaveGroupManagers}>
              <div className="competency-form-grid">
                <label>
                  <span>Grupp</span>
                  <select value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value)}>
                    {workspace.groups.map((group) => (
                      <option key={group.id} value={group.id}>{group.departmentName} · {group.name}</option>
                    ))}
                  </select>
                </label>
                <label className="competency-form-grid__wide">
                  <span>Gruppchefer</span>
                  <select
                    multiple
                    className="competency-multi-select"
                    value={groupManagerUserIds}
                    onChange={(event) => setGroupManagerUserIds(Array.from(event.target.selectedOptions, (option) => option.value))}
                  >
                    {workspace.profiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>{formatDisplayName(profile.displayName, profile.email)}</option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" disabled={saving === 'group-managers'}>{saving === 'group-managers' ? 'Sparar...' : 'Spara gruppchefer'}</button>
            </form>
          </>
        ) : (
          <p>Den här delen kräver behörigheten att hantera kompetensadministration.</p>
        )}
      </article>

      <article className="app-card">
        <h2>Behörigheter och kursregister</h2>
        {workspace.permission.managePermissions ? (
          <form className="competency-form" onSubmit={handleSavePermission}>
            <div className="competency-form-grid">
              <label className="competency-form-grid__wide">
                <span>Användare</span>
                <select required value={permissionDraft.userId} onChange={(event) => setPermissionDraft((current) => ({ ...current, userId: event.target.value }))}>
                  <option value="">Välj användare</option>
                  {workspace.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>{formatDisplayName(profile.displayName, profile.email)}</option>
                  ))}
                </select>
              </label>
              <label className="competency-checkbox">
                <input type="checkbox" checked={permissionDraft.moduleAccess} onChange={(event) => setPermissionDraft((current) => ({ ...current, moduleAccess: event.target.checked }))} />
                <span>Modulåtkomst</span>
              </label>
              <label className="competency-checkbox">
                <input type="checkbox" checked={permissionDraft.manageCatalog} onChange={(event) => setPermissionDraft((current) => ({ ...current, manageCatalog: event.target.checked }))} />
                <span>Hantera kursregister</span>
              </label>
              <label className="competency-checkbox">
                <input type="checkbox" checked={permissionDraft.managePermissions} onChange={(event) => setPermissionDraft((current) => ({ ...current, managePermissions: event.target.checked }))} />
                <span>Hantera behörigheter</span>
              </label>
            </div>
            <button type="submit" disabled={saving === 'permission'}>{saving === 'permission' ? 'Sparar...' : 'Spara behörighet'}</button>
          </form>
        ) : null}

        <form className="competency-form" onSubmit={handleSaveCourse}>
          <div className="competency-form-grid">
            <label>
              <span>Befintlig kurs</span>
              <select value={courseDraft.id} onChange={(event) => {
                const selectedCourse = workspace.courses.find((course) => course.id === event.target.value)
                if (!selectedCourse) {
                  setCourseDraft(emptyCourseDraft())
                  return
                }

                setCourseDraft({
                  id: selectedCourse.id,
                  courseCode: selectedCourse.courseCode,
                  title: selectedCourse.title,
                  category: selectedCourse.category,
                  description: selectedCourse.description ?? '',
                  guValidityMonths: selectedCourse.guValidityMonths?.toString() ?? '',
                  ruValidityMonths: selectedCourse.ruValidityMonths?.toString() ?? '',
                  notificationLeadDays: selectedCourse.notificationLeadDays.toString(),
                  active: selectedCourse.active,
                })
              }}>
                <option value="">Ny kurs</option>
                {workspace.courses.map((course) => (
                  <option key={course.id} value={course.id}>{course.category} · {course.title}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Kurskod</span>
              <input required value={courseDraft.courseCode} onChange={(event) => setCourseDraft((current) => ({ ...current, courseCode: event.target.value }))} />
            </label>
            <label>
              <span>Namn</span>
              <input required value={courseDraft.title} onChange={(event) => setCourseDraft((current) => ({ ...current, title: event.target.value }))} />
            </label>
            <label>
              <span>Kategori</span>
              <input required value={courseDraft.category} onChange={(event) => setCourseDraft((current) => ({ ...current, category: event.target.value }))} />
            </label>
            <label>
              <span>GU giltighet (mån)</span>
              <input type="number" min="0" value={courseDraft.guValidityMonths} onChange={(event) => setCourseDraft((current) => ({ ...current, guValidityMonths: event.target.value }))} />
            </label>
            <label>
              <span>RU giltighet (mån)</span>
              <input type="number" min="0" value={courseDraft.ruValidityMonths} onChange={(event) => setCourseDraft((current) => ({ ...current, ruValidityMonths: event.target.value }))} />
            </label>
            <label>
              <span>Notis före förfall</span>
              <input type="number" min="0" value={courseDraft.notificationLeadDays} onChange={(event) => setCourseDraft((current) => ({ ...current, notificationLeadDays: event.target.value }))} />
            </label>
            <label className="competency-checkbox">
              <input type="checkbox" checked={courseDraft.active} onChange={(event) => setCourseDraft((current) => ({ ...current, active: event.target.checked }))} />
              <span>Aktiv kurs</span>
            </label>
            <label className="competency-form-grid__wide">
              <span>Beskrivning</span>
              <textarea rows={4} value={courseDraft.description} onChange={(event) => setCourseDraft((current) => ({ ...current, description: event.target.value }))} />
            </label>
          </div>
          <button type="submit" disabled={saving === 'course'}>{saving === 'course' ? 'Sparar...' : 'Spara kurs'}</button>
        </form>

        {workspace.permission.managePermissions ? (
          <div className="competency-table-wrapper">
            <table className="competency-table">
              <thead>
                <tr>
                  <th>Användare</th>
                  <th>Modul</th>
                  <th>Kursregister</th>
                  <th>Behörigheter</th>
                </tr>
              </thead>
              <tbody>
                {workspace.permissionEntries.map((entry) => (
                  <tr key={entry.userId}>
                    <td>{formatDisplayName(entry.displayName, entry.email)}</td>
                    <td>{entry.moduleAccess ? 'Ja' : 'Nej'}</td>
                    <td>{entry.manageCatalog ? 'Ja' : 'Nej'}</td>
                    <td>{entry.managePermissions ? 'Ja' : 'Nej'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </article>
    </div>
  )
}
