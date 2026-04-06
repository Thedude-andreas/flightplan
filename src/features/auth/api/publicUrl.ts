const publicAuthRoutePaths = ['/forgot-password', '/reset-password', '/verify-email', '/signup', '/login']

function normalizeBasePath(value: string | undefined) {
  if (!value) {
    return '/'
  }

  const withLeadingSlash = value.startsWith('/') ? value : `/${value}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

function normalizeRoutePath(value: string) {
  return value.startsWith('/') ? value.slice(1) : value
}

function inferBasePath(pathname: string) {
  for (const routePath of publicAuthRoutePaths) {
    if (pathname === routePath) {
      return '/'
    }

    if (pathname.endsWith(routePath)) {
      const basePath = pathname.slice(0, -routePath.length)
      return normalizeBasePath(basePath || '/')
    }
  }

  return normalizeBasePath(import.meta.env.BASE_URL)
}

function getPublicAppBaseUrl() {
  const configuredPublicUrl = import.meta.env.VITE_PUBLIC_APP_URL?.trim()

  if (configuredPublicUrl) {
    return configuredPublicUrl.endsWith('/') ? configuredPublicUrl : `${configuredPublicUrl}/`
  }

  if (typeof window === 'undefined') {
    return normalizeBasePath(import.meta.env.BASE_URL)
  }

  const configuredBasePath = normalizeBasePath(import.meta.env.BASE_URL)

  if (configuredBasePath !== '/') {
    return `${window.location.origin}${configuredBasePath}`
  }

  return `${window.location.origin}${inferBasePath(window.location.pathname)}`
}

export function getPublicAppUrl(routePath: string) {
  return new URL(normalizeRoutePath(routePath), getPublicAppBaseUrl()).toString()
}
