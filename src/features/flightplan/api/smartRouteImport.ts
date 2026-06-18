import { getSupabaseClient } from '../../../lib/supabase/client'

export type SmartRouteImportSourceType = 'text' | 'spreadsheet' | 'pdf' | 'image' | 'file'

export type SmartRouteImportRequest = {
  text?: string
  sourceType: SmartRouteImportSourceType
  fileName?: string
  fileType?: string
  fileSizeBytes?: number
  fileBase64?: string
}

export type SmartRouteImportWaypoint = {
  raw: string
  name?: string | null
  lat?: number | null
  lon?: number | null
  notes?: string | null
  confidence?: number | null
}

export type SmartRouteImportResult = {
  routeName: string
  waypoints: SmartRouteImportWaypoint[]
  warnings: string[]
  confidence: number
  diagnostics?: {
    model: string | null
    usedFallback: boolean
    usage: {
      input_tokens?: number
      output_tokens?: number
      input_token_details?: {
        cached_tokens?: number
      }
    }
    estimatedCostUsd: number
  }
}

function requireClient() {
  const client = getSupabaseClient()
  if (!client) {
    throw new Error('Supabase är inte konfigurerat.')
  }

  return client
}

export async function importSmartRoute(input: SmartRouteImportRequest) {
  const supabase = requireClient()
  const { data, error } = await supabase.functions.invoke<SmartRouteImportResult>('smart-route-import', {
    body: input,
  })

  if (error) {
    throw error
  }

  if (!data) {
    throw new Error('Smart ruttimport gav inget svar.')
  }

  return data
}
