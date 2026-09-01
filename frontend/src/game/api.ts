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

const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'

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
  const httpUrl = new URL(API_URL)
  const wsProtocol = httpUrl.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${wsProtocol}//${httpUrl.host}/api/battle/ws?playerId=${encodeURIComponent(playerId)}`
}
