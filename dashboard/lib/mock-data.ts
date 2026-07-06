// lib/mock-data.ts
// Mock data shaped to match backend/app/db/models.py exactly, so wiring
// this dashboard up to the real API later (GET /v1/tenant/keys,
// GET /v1/tenant/sessions, etc. — not yet built) is a drop-in swap rather
// than a reshape. No external state library, per docs/conventions.md.

export type ApiKey = {
  id: string
  keyPrefix: string
  isActive: boolean
  createdAt: string
}

export type UsageLog = {
  id: string
  sessionId: string
  url: string
  command: string | null
  action: 'click' | 'fill' | 'scroll' | 'focus' | null
  elementId: string | null
  timestamp: string
}

export type ErrorLog = {
  id: string
  url: string
  elementId: string | null
  errorType: 'missing_alt' | 'missing_aria' | 'missing_label'
  suggestion: string | null
  flaggedAt: string
}

export const mockTenant = {
  companyName: 'Atlas Demo Corp',
  email: 'demo@atlas-saas.com',
}

export const mockApiKeys: ApiKey[] = [
  {
    id: '00000000-0000-0000-0000-000000000002',
    keyPrefix: 'atlas_a1b2c3d4e5f6',
    isActive: true,
    createdAt: '2026-07-05T09:12:00Z',
  },
  {
    id: '00000000-0000-0000-0000-000000000003',
    keyPrefix: 'atlas_9f8e7d6c5b4a',
    isActive: false,
    createdAt: '2026-06-28T14:03:00Z',
  },
]

export const mockUsageLogs: UsageLog[] = [
  {
    id: 'ul-1',
    sessionId: 'sess-9a21',
    url: 'https://riverbend-market.demo/checkout',
    command: 'click proceed to checkout',
    action: 'click',
    elementId: 'atlas-014',
    timestamp: '2026-07-07T14:32:10Z',
  },
  {
    id: 'ul-2',
    sessionId: 'sess-9a21',
    url: 'https://riverbend-market.demo/',
    command: 'search for tomatoes',
    action: 'fill',
    elementId: 'atlas-002',
    timestamp: '2026-07-07T14:31:44Z',
  },
  {
    id: 'ul-3',
    sessionId: 'sess-7f03',
    url: 'https://riverbend-market.demo/',
    command: 'scroll to newsletter signup',
    action: 'scroll',
    elementId: 'atlas-021',
    timestamp: '2026-07-07T11:02:19Z',
  },
  {
    id: 'ul-4',
    sessionId: 'sess-7f03',
    url: 'https://riverbend-market.demo/',
    command: null,
    action: null,
    elementId: null,
    timestamp: '2026-07-07T11:01:58Z',
  },
]

export const mockErrorLogs: ErrorLog[] = [
  {
    id: 'el-1',
    url: 'https://riverbend-market.demo/',
    elementId: 'atlas-005',
    errorType: 'missing_alt',
    suggestion: 'Add alt text describing the product photo',
    flaggedAt: '2026-07-07T14:30:02Z',
  },
  {
    id: 'el-2',
    url: 'https://riverbend-market.demo/',
    elementId: 'atlas-003',
    errorType: 'missing_aria',
    suggestion: 'Give the search button an accessible name',
    flaggedAt: '2026-07-07T14:30:02Z',
  },
  {
    id: 'el-3',
    url: 'https://riverbend-market.demo/#newsletter',
    elementId: 'atlas-022',
    errorType: 'missing_label',
    suggestion: 'Associate a <label> with the ZIP code input',
    flaggedAt: '2026-07-07T11:02:40Z',
  },
]
