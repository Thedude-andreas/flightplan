import type {
  CompetencyCourse,
  CompetencyGroup,
  CompetencyMember,
  CompetencyStatusRow,
  CompetencyTrainingEvent,
} from './types'

export function startOfToday() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return today
}

export function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

export function formatDate(value: string | null) {
  if (!value) {
    return 'Ej registrerad'
  }

  return new Intl.DateTimeFormat('sv-SE', { dateStyle: 'medium' }).format(new Date(value))
}

export function formatDisplayName(displayName: string | null, email: string) {
  return displayName ? `${displayName} · ${email}` : email
}

function daysBetween(from: Date, until: string) {
  const dueDate = new Date(`${until}T00:00:00`)
  return Math.round((dueDate.getTime() - from.getTime()) / 86_400_000)
}

export function computeStatusRows(
  members: CompetencyMember[],
  courses: CompetencyCourse[],
  trainingEvents: CompetencyTrainingEvent[],
) {
  const today = startOfToday()
  const eventMap = new Map<string, CompetencyTrainingEvent[]>()

  for (const event of trainingEvents) {
    const key = `${event.memberId}:${event.courseId}`
    const current = eventMap.get(key) ?? []
    current.push(event)
    eventMap.set(key, current)
  }

  const rows: CompetencyStatusRow[] = []

  for (const member of members) {
    for (const course of courses.filter((item) => item.active)) {
      const events = [...(eventMap.get(`${member.id}:${course.id}`) ?? [])].sort((left, right) =>
        right.completedOn.localeCompare(left.completedOn),
      )
      const latestGu = events.find((event) => event.trainingKind === 'gu') ?? null
      const latestRu = events.find((event) => event.trainingKind === 'ru') ?? null
      const effectiveValidUntil = latestRu?.validUntil ?? latestGu?.validUntil ?? null

      let status: CompetencyStatusRow['status'] = 'valid'
      let daysUntilDue: number | null = null

      if (!latestGu) {
        status = 'missing_gu'
      } else if (effectiveValidUntil) {
        daysUntilDue = daysBetween(today, effectiveValidUntil)
        if (daysUntilDue < 0) {
          status = 'expired'
        } else if (daysUntilDue <= course.notificationLeadDays) {
          status = 'due_soon'
        }
      }

      rows.push({
        memberId: member.id,
        memberNumber: member.memberNumber,
        fullName: member.fullName,
        departmentId: member.departmentId,
        departmentName: member.departmentName,
        groupId: member.groupId,
        groupName: member.groupName,
        courseId: course.id,
        courseCode: course.courseCode,
        courseTitle: course.title,
        category: course.category,
        latestGuCompletedOn: latestGu?.completedOn ?? null,
        latestRuCompletedOn: latestRu?.completedOn ?? null,
        effectiveValidUntil,
        status,
        daysUntilDue,
        notificationLeadDays: course.notificationLeadDays,
      })
    }
  }

  return rows.sort((left, right) =>
    left.fullName.localeCompare(right.fullName, 'sv') ||
    left.category.localeCompare(right.category, 'sv') ||
    left.courseTitle.localeCompare(right.courseTitle, 'sv'),
  )
}

export function emptyMemberDraft(groups: CompetencyGroup[]) {
  const firstGroup = groups[0]
  return {
    id: '',
    memberNumber: '',
    fullName: '',
    email: '',
    phone: '',
    departmentId: firstGroup?.departmentId ?? '',
    groupId: firstGroup?.id ?? '',
    notes: '',
  }
}

export function emptyCourseDraft() {
  return {
    id: '',
    courseCode: '',
    title: '',
    category: '',
    description: '',
    guValidityMonths: '',
    ruValidityMonths: '',
    notificationLeadDays: '30',
    active: true,
  }
}
