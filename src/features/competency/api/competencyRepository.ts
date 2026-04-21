import { getSupabaseClient } from '../../../lib/supabase/client'
import type {
  CompetencyCourse,
  CompetencyDepartment,
  CompetencyGroup,
  CompetencyMember,
  CompetencyPermission,
  CompetencyPermissionEntry,
  CompetencyProfileOption,
  CompetencyTrainingEvent,
} from '../types'

function requireClient() {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error('Supabase är inte konfigurerat.')
  }

  return client
}

function pickOne<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null
  }

  return value ?? null
}

function mapPermission(row: {
  user_id: string
  module_access: boolean
  manage_catalog: boolean
  view_reports: boolean
  manage_permissions: boolean
}): CompetencyPermission {
  return {
    userId: row.user_id,
    moduleAccess: row.module_access,
    manageCatalog: row.manage_catalog,
    viewReports: row.view_reports,
    managePermissions: row.manage_permissions,
  }
}

export async function getCurrentCompetencyPermission() {
  const supabase = requireClient()
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError) {
    throw userError
  }

  if (!user) {
    return null
  }

  const { data, error } = await supabase
    .from('competency_user_permissions')
    .select('user_id, module_access, manage_catalog, view_reports, manage_permissions')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) {
    throw error
  }

  return data ? mapPermission(data) : null
}

export async function listCompetencyDepartments() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('competency_departments')
    .select(`
      id,
      name,
      competency_department_leaders(
        user_id,
        profiles:user_id(email, display_name)
      )
    `)
    .order('name')

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<{
    id: string
    name: string
    competency_department_leaders:
      | Array<{
          user_id: string
          profiles: { email: string; display_name: string | null }[] | { email: string; display_name: string | null } | null
        }>
      | null
  }>).map((row) => ({
    id: row.id,
    name: row.name,
    leaders: (row.competency_department_leaders ?? []).map((leader) => ({
      userId: leader.user_id,
      email: pickOne(leader.profiles)?.email ?? '',
      displayName: pickOne(leader.profiles)?.display_name ?? null,
    })),
  })) satisfies CompetencyDepartment[]
}

type GroupRow = {
  id: string
  department_id: string
  name: string
  competency_departments: { name: string }[] | { name: string } | null
  competency_group_managers:
    | Array<{
        user_id: string
        profiles: {
          email: string
          display_name: string | null
        }[] | {
          email: string
          display_name: string | null
        } | null
      }>
    | null
}

export async function listCompetencyGroups() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('competency_groups')
    .select(`
      id,
      department_id,
      name,
      competency_departments(name),
      competency_group_managers(
        user_id,
        profiles:user_id(email, display_name)
      )
    `)
    .order('name')

  if (error) {
    throw error
  }

  return ((data ?? []) as GroupRow[]).map((row) => ({
    id: row.id,
    departmentId: row.department_id,
    departmentName: pickOne(row.competency_departments)?.name ?? 'Okänd avdelning',
    name: row.name,
    managers: (row.competency_group_managers ?? []).map((manager) => ({
      userId: manager.user_id,
      email: pickOne(manager.profiles)?.email ?? '',
      displayName: pickOne(manager.profiles)?.display_name ?? null,
    })),
  })) satisfies CompetencyGroup[]
}

export async function createCompetencyDepartment(name: string) {
  const supabase = requireClient()
  const { error } = await supabase.from('competency_departments').insert({ name })

  if (error) {
    throw error
  }
}

export async function replaceCompetencyDepartmentLeaders(departmentId: string, userIds: string[]) {
  const supabase = requireClient()
  const { error: deleteError } = await supabase
    .from('competency_department_leaders')
    .delete()
    .eq('department_id', departmentId)

  if (deleteError) {
    throw deleteError
  }

  if (userIds.length === 0) {
    return
  }

  const { error: insertError } = await supabase.from('competency_department_leaders').insert(
    userIds.map((userId) => ({
      department_id: departmentId,
      user_id: userId,
    })),
  )

  if (insertError) {
    throw insertError
  }
}

export async function createCompetencyGroup(input: { departmentId: string; name: string }) {
  const supabase = requireClient()
  const { error } = await supabase.from('competency_groups').insert({
    department_id: input.departmentId,
    name: input.name,
  })

  if (error) {
    throw error
  }
}

export async function replaceCompetencyGroupManagers(groupId: string, userIds: string[]) {
  const supabase = requireClient()
  const { error: deleteError } = await supabase.from('competency_group_managers').delete().eq('group_id', groupId)

  if (deleteError) {
    throw deleteError
  }

  if (userIds.length === 0) {
    return
  }

  const { error: insertError } = await supabase.from('competency_group_managers').insert(
    userIds.map((userId) => ({
      group_id: groupId,
      user_id: userId,
    })),
  )

  if (insertError) {
    throw insertError
  }
}

export async function listCompetencyProfiles() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, display_name')
    .order('email')

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<{ id: string; email: string; display_name: string | null }>).map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
  })) satisfies CompetencyProfileOption[]
}

export async function listCompetencyPermissionEntries() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('competency_user_permissions')
    .select(`
      user_id,
      module_access,
      manage_catalog,
      view_reports,
      manage_permissions,
      profiles:user_id(email, display_name)
    `)
    .order('user_id')

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<{
    user_id: string
    module_access: boolean
    manage_catalog: boolean
    view_reports: boolean
    manage_permissions: boolean
    profiles: { email: string; display_name: string | null }[] | { email: string; display_name: string | null } | null
  }>).map((row) => ({
    ...mapPermission(row),
    email: pickOne(row.profiles)?.email ?? '',
    displayName: pickOne(row.profiles)?.display_name ?? null,
  })) satisfies CompetencyPermissionEntry[]
}

export async function upsertCompetencyPermission(input: CompetencyPermission) {
  const supabase = requireClient()
  const { error } = await supabase.from('competency_user_permissions').upsert({
    user_id: input.userId,
    module_access: input.moduleAccess,
    manage_catalog: input.manageCatalog,
    view_reports: input.viewReports,
    manage_permissions: input.managePermissions,
  })

  if (error) {
    throw error
  }
}

export async function listCompetencyCourses() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('competency_courses')
    .select('id, course_code, title, category, description, gu_validity_months, ru_validity_months, notification_lead_days, active')
    .order('category')
    .order('title')

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<{
    id: string
    course_code: string
    title: string
    category: string
    description: string | null
    gu_validity_months: number | null
    ru_validity_months: number | null
    notification_lead_days: number
    active: boolean
  }>).map((row) => ({
    id: row.id,
    courseCode: row.course_code,
    title: row.title,
    category: row.category,
    description: row.description,
    guValidityMonths: row.gu_validity_months,
    ruValidityMonths: row.ru_validity_months,
    notificationLeadDays: row.notification_lead_days,
    active: row.active,
  })) satisfies CompetencyCourse[]
}

export async function saveCompetencyCourse(input: Omit<CompetencyCourse, 'id'> & { id?: string }) {
  const supabase = requireClient()
  const payload = {
    course_code: input.courseCode,
    title: input.title,
    category: input.category,
    description: input.description,
    gu_validity_months: input.guValidityMonths,
    ru_validity_months: input.ruValidityMonths,
    notification_lead_days: input.notificationLeadDays,
    active: input.active,
  }

  if (input.id) {
    const { error } = await supabase.from('competency_courses').update(payload).eq('id', input.id)
    if (error) {
      throw error
    }
    return
  }

  const { error } = await supabase.from('competency_courses').insert(payload)
  if (error) {
    throw error
  }
}

export async function listCompetencyMembers() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('competency_members')
    .select(`
      id,
      member_number,
      full_name,
      email,
      phone,
      notes,
      department_id,
      group_id,
      competency_departments(name),
      competency_groups(name)
    `)
    .is('archived_at', null)
    .order('full_name')

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<{
    id: string
    member_number: string | null
    full_name: string
    email: string | null
    phone: string | null
    notes: string | null
    department_id: string
    group_id: string
    competency_departments: { name: string }[] | { name: string } | null
    competency_groups: { name: string }[] | { name: string } | null
  }>).map((row) => ({
    id: row.id,
    memberNumber: row.member_number,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    departmentId: row.department_id,
    departmentName: pickOne(row.competency_departments)?.name ?? 'Okänd avdelning',
    groupId: row.group_id,
    groupName: pickOne(row.competency_groups)?.name ?? 'Okänd grupp',
    notes: row.notes,
  })) satisfies CompetencyMember[]
}

export async function saveCompetencyMember(input: {
  id?: string
  memberNumber: string | null
  fullName: string
  email: string | null
  phone: string | null
  departmentId: string
  groupId: string
  notes: string | null
}) {
  const supabase = requireClient()
  const payload = {
    member_number: input.memberNumber,
    full_name: input.fullName,
    email: input.email,
    phone: input.phone,
    department_id: input.departmentId,
    group_id: input.groupId,
    notes: input.notes,
  }

  if (input.id) {
    const { error } = await supabase.from('competency_members').update(payload).eq('id', input.id)
    if (error) {
      throw error
    }
    return
  }

  const { error } = await supabase.from('competency_members').insert(payload)
  if (error) {
    throw error
  }
}

export async function archiveCompetencyMember(id: string) {
  const supabase = requireClient()
  const { error } = await supabase
    .from('competency_members')
    .update({ archived_at: new Date().toISOString() })
    .eq('id', id)

  if (error) {
    throw error
  }
}

export async function listCompetencyTrainingEvents() {
  const supabase = requireClient()
  const { data, error } = await supabase
    .from('competency_training_events')
    .select(`
      id,
      member_id,
      course_id,
      training_kind,
      completed_on,
      valid_until,
      note,
      competency_courses(course_code, title, category)
    `)
    .order('completed_on', { ascending: false })

  if (error) {
    throw error
  }

  return ((data ?? []) as Array<{
    id: string
    member_id: string
    course_id: string
    training_kind: 'gu' | 'ru'
    completed_on: string
    valid_until: string | null
    note: string | null
    competency_courses: { course_code: string; title: string; category: string }[] | { course_code: string; title: string; category: string } | null
  }>).map((row) => ({
    id: row.id,
    memberId: row.member_id,
    courseId: row.course_id,
    courseCode: pickOne(row.competency_courses)?.course_code ?? '',
    courseTitle: pickOne(row.competency_courses)?.title ?? '',
    category: pickOne(row.competency_courses)?.category ?? '',
    trainingKind: row.training_kind,
    completedOn: row.completed_on,
    validUntil: row.valid_until,
    note: row.note,
  })) satisfies CompetencyTrainingEvent[]
}

export async function createCompetencyTrainingEvent(input: {
  memberId: string
  courseId: string
  trainingKind: 'gu' | 'ru'
  completedOn: string
  note: string | null
}) {
  const supabase = requireClient()
  const { error } = await supabase.from('competency_training_events').insert({
    member_id: input.memberId,
    course_id: input.courseId,
    training_kind: input.trainingKind,
    completed_on: input.completedOn,
    note: input.note,
  })

  if (error) {
    throw error
  }
}

export async function loadCompetencyWorkspace() {
  const permission = await getCurrentCompetencyPermission()

  if (!permission?.moduleAccess) {
    return {
      permission,
      departments: [] as CompetencyDepartment[],
      groups: [] as CompetencyGroup[],
      courses: [] as CompetencyCourse[],
      members: [] as CompetencyMember[],
      trainingEvents: [] as CompetencyTrainingEvent[],
      profiles: [] as CompetencyProfileOption[],
      permissionEntries: [] as CompetencyPermissionEntry[],
    }
  }

  const [departments, groups, courses, members, trainingEvents, profiles, permissionEntries] = await Promise.all([
    listCompetencyDepartments(),
    listCompetencyGroups(),
    listCompetencyCourses(),
    listCompetencyMembers(),
    listCompetencyTrainingEvents(),
    permission.managePermissions ? listCompetencyProfiles() : Promise.resolve([]),
    permission.managePermissions ? listCompetencyPermissionEntries() : Promise.resolve([]),
  ])

  return {
    permission,
    departments,
    groups,
    courses,
    members,
    trainingEvents,
    profiles,
    permissionEntries,
  }
}
