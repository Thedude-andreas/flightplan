export type CompetencyPermission = {
  userId: string
  moduleAccess: boolean
  manageCatalog: boolean
  viewReports: boolean
  managePermissions: boolean
}

export type CompetencyDepartment = {
  id: string
  name: string
  leaders: CompetencyDepartmentLeader[]
}

export type CompetencyProfileOption = {
  id: string
  email: string
  displayName: string | null
}

export type CompetencyGroupManager = {
  userId: string
  email: string
  displayName: string | null
}

export type CompetencyDepartmentLeader = {
  userId: string
  email: string
  displayName: string | null
}

export type CompetencyGroup = {
  id: string
  departmentId: string
  departmentName: string
  name: string
  managers: CompetencyGroupManager[]
}

export type CompetencyCourse = {
  id: string
  courseCode: string
  title: string
  category: string
  description: string | null
  guValidityMonths: number | null
  ruValidityMonths: number | null
  notificationLeadDays: number
  active: boolean
}

export type CompetencyMember = {
  id: string
  memberNumber: string | null
  fullName: string
  email: string | null
  phone: string | null
  departmentId: string
  departmentName: string
  groupId: string
  groupName: string
  notes: string | null
}

export type CompetencyTrainingEvent = {
  id: string
  memberId: string
  courseId: string
  courseCode: string
  courseTitle: string
  category: string
  trainingKind: 'gu' | 'ru'
  completedOn: string
  validUntil: string | null
  note: string | null
}

export type CompetencyStatusRow = {
  memberId: string
  memberNumber: string | null
  fullName: string
  departmentId: string
  departmentName: string
  groupId: string
  groupName: string
  courseId: string
  courseCode: string
  courseTitle: string
  category: string
  latestGuCompletedOn: string | null
  latestRuCompletedOn: string | null
  effectiveValidUntil: string | null
  status: 'missing_gu' | 'expired' | 'due_soon' | 'valid'
  daysUntilDue: number | null
  notificationLeadDays: number
}

export type CompetencyPermissionEntry = CompetencyPermission & {
  email: string
  displayName: string | null
}
