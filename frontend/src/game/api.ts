export type UnitInstance = {
  instanceId: string
  defId: string
  level: number
}

export type PlayerState = {
  id: string
  gold: number
  units: UnitInstance[]
}

// Пустая строка = тот же origin, что и сама страница: в проде nginx фронтенда
// проксирует /api на бэкенд, поэтому адрес бэкенда не нужно вшивать в бандл на
// этапе сборки. VITE_API_URL остаётся для локальной разработки, где vite отдаёт
// фронтенд на :5173, а бэкенд слушает :8080.
const API_URL = import.meta.env.VITE_API_URL ?? ''

async function request<T>(path: string, playerId: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'X-Player-Id': playerId,
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(body.message ?? `Запрос ${path} завершился ошибкой ${res.status}`)
  }
  return res.json() as Promise<T>
}

export function getCollection(playerId: string): Promise<PlayerState> {
  return request<PlayerState>('/api/collection', playerId)
}

export function upgradeUnit(playerId: string, instanceId: string): Promise<PlayerState> {
  return request<PlayerState>('/api/collection/upgrade', playerId, {
    method: 'POST',
    body: JSON.stringify({ instanceId }),
  })
}

export function battleWsUrl(playerId: string): string {
  // new URL('') бросает исключение, поэтому для same-origin берём адрес страницы.
  const httpUrl = new URL(API_URL || window.location.origin)
  const wsProtocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${httpUrl.host}/api/battle/ws?playerId=${encodeURIComponent(playerId)}`
}

export type TavernOffer = {
  defId: string
  name: string
  cost: number
  stats: { hp: number; atk: number; def: number; spd: number }
}

export function getTavern(playerId: string): Promise<{ offers: TavernOffer[] }> {
  return request<{ offers: TavernOffer[] }>('/api/tavern', playerId)
}

export function hireUnit(playerId: string, defId: string): Promise<{ player: PlayerState }> {
  return request<{ player: PlayerState }>('/api/tavern/hire', playerId, {
    method: 'POST',
    body: JSON.stringify({ defId }),
  })
}
