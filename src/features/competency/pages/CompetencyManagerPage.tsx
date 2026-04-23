import { useEffect, useMemo, useState, type ChangeEvent, type FormEvent } from 'react'
import { read, utils } from 'xlsx'
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

type ImportRow = {
  memberNumber: string
  fullName: string
  email: string
  phone: string
  sourceGroupCode: string
  notes: string
}

type SpreadsheetRow = Record<string, string | number | null | undefined>

function normalizeCellValue(value: string | number | null | undefined) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

function buildImportNotes(row: SpreadsheetRow) {
  return [
    ['Befattning', normalizeCellValue(row['Befattning'])],
    ['Info status FFK', normalizeCellValue(row['Info status FFK'])],
    ['Info OM-A utbildning', normalizeCellValue(row['Info OM-A utbildning'])],
    [
      'Adress',
      [normalizeCellValue(row['Utdelningsadress']), normalizeCellValue(row['Postadress'])]
        .filter(Boolean)
        .join(', '),
    ],
    ['Kontaktnr', normalizeCellValue(row['Kontaktnr'])],
    ['Besökspostadress', normalizeCellValue(row['Besökspostadress'])],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `${label}: ${value}`)
    .join('\n')
}

function mapSpreadsheetRows(rows: SpreadsheetRow[]) {
  const dedupedRows = new Map<string, ImportRow>()

  for (const row of rows) {
    const memberNumber = normalizeCellValue(row['Medlemsnummer'])
    const lastName = normalizeCellValue(row['Efternamn'])
    const firstName = normalizeCellValue(row['Förnamn'])
    const fullName = [firstName, lastName].filter(Boolean).join(' ').trim()

    if (!memberNumber || !fullName) {
      continue
    }

    dedupedRows.set(memberNumber, {
      memberNumber,
      fullName,
      email: normalizeCellValue(row['E-postadress']),
      phone: normalizeCellValue(row['Mobiltelefon']),
      sourceGroupCode: normalizeCellValue(row['Huvudflyggrupp']),
      notes: buildImportNotes(row),
    })
  }

  return [...dedupedRows.values()]
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
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [importSourceGroupCode, setImportSourceGroupCode] = useState('')
  const [importTargetGroupId, setImportTargetGroupId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [importMessage, setImportMessage] = useState('')

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

  useEffect(() => {
    setImportTargetGroupId((current) => current || manageableGroups[0]?.id || '')
    setMemberDraft((current) => (current.groupId ? current : emptyMemberDraft(manageableGroups)))
  }, [manageableGroups])

  const selectedMember = workspace.members.find((member) => member.id === selectedMemberId) ?? null
  const selectedMemberEvents = workspace.trainingEvents.filter((event) => event.memberId === selectedMemberId)
  const selectedMemberStatuses = computeStatusRows(workspace.members, workspace.courses, workspace.trainingEvents).filter(
    (row) => row.memberId === selectedMemberId,
  )
  const importGroupOptions = [...new Set(importRows.map((row) => row.sourceGroupCode).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right, 'sv'),
  )
  const previewRows = importRows.filter((row) => !importSourceGroupCode || row.sourceGroupCode === importSourceGroupCode)

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

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) {
      return
    }

    setError('')
    setImportMessage('')

    try {
      const buffer = await file.arrayBuffer()
      const workbook = read(buffer, { type: 'array' })
      const firstSheetName = workbook.SheetNames[0]

      if (!firstSheetName) {
        throw new Error('Filen saknar blad.')
      }

      const sheet = workbook.Sheets[firstSheetName]
      const rows = utils.sheet_to_json<SpreadsheetRow>(sheet, {
        defval: '',
      })
      const mappedRows = mapSpreadsheetRows(rows)

      if (mappedRows.length === 0) {
        throw new Error('Filen innehöll inga importerbara medlemmar.')
      }

      setImportRows(mappedRows)
      setImportSourceGroupCode((current) => current || mappedRows[0]?.sourceGroupCode || '')
      setImportMessage(`Läste in ${mappedRows.length} medlemmar från ${file.name}.`)
      event.target.value = ''
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte läsa importfilen.'))
    }
  }

  async function handleRunImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const targetGroup = manageableGroups.find((group) => group.id === importTargetGroupId)
    if (!targetGroup) {
      setError('Välj en målgrupp för importen.')
      return
    }

    if (previewRows.length === 0) {
      setError('Det finns inga rader att importera.')
      return
    }

    setSaving('import')
    setError('')
    setImportMessage('')

    try {
      let createdCount = 0
      let updatedCount = 0

      for (const row of previewRows) {
        const existingMember = workspace.members.find((member) => member.memberNumber === row.memberNumber)

        await saveCompetencyMember({
          id: existingMember?.id,
          memberNumber: row.memberNumber,
          fullName: row.fullName,
          email: row.email || null,
          phone: row.phone || null,
          departmentId: targetGroup.departmentId,
          groupId: targetGroup.id,
          notes: row.notes || null,
        })

        if (existingMember) {
          updatedCount += 1
        } else {
          createdCount += 1
        }
      }

      setImportRows([])
      setImportSourceGroupCode('')
      setImportMessage(`Import klar. ${createdCount} skapade, ${updatedCount} uppdaterade.`)
      await loadData()
    } catch (nextError) {
      setError(getErrorMessage(nextError, 'Kunde inte importera medlemmarna.'))
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
        <h2>Importera besättning</h2>
        <form className="competency-form" onSubmit={handleRunImport}>
          <div className="competency-form-grid">
            <label className="competency-form-grid__wide">
              <span>Importfil</span>
              <input type="file" accept=".xlsx,.xls,.csv" onChange={handleImportFile} />
            </label>
            <label>
              <span>Målgrupp</span>
              <select value={importTargetGroupId} onChange={(event) => setImportTargetGroupId(event.target.value)}>
                {manageableGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.departmentName} · {group.name}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Källgrupp i fil</span>
              <select value={importSourceGroupCode} onChange={(event) => setImportSourceGroupCode(event.target.value)}>
                <option value="">Alla</option>
                {importGroupOptions.map((groupCode) => (
                  <option key={groupCode} value={groupCode}>{groupCode}</option>
                ))}
              </select>
            </label>
          </div>

          {importMessage ? <p>{importMessage}</p> : null}

          {previewRows.length > 0 ? (
            <div className="competency-table-wrapper">
              <table className="competency-table">
                <thead>
                  <tr>
                    <th>Medlemsnummer</th>
                    <th>Namn</th>
                    <th>Email</th>
                    <th>Telefon</th>
                    <th>Gruppkod</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((row) => (
                    <tr key={row.memberNumber}>
                      <td>{row.memberNumber}</td>
                      <td>{row.fullName}</td>
                      <td>{row.email || 'Saknas'}</td>
                      <td>{row.phone || 'Saknas'}</td>
                      <td>{row.sourceGroupCode || 'Saknas'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p>Ladda upp en Excel- eller CSV-fil med kolumner som `Medlemsnummer`, `Efternamn`, `Förnamn`, `Mobiltelefon`, `E-postadress` och gärna `Huvudflyggrupp`.</p>
          )}

          <button type="submit" disabled={saving === 'import' || previewRows.length === 0}>
            {saving === 'import' ? 'Importerar...' : 'Importera medlemmar'}
          </button>
        </form>
      </article>

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
