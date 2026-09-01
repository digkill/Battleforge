import { useMemo } from 'react'
import { usePikabuSDK } from './use-pikabu-sdk'

const DEV_PLAYER_ID_KEY = 'pikabu-dev-player-id'

function getOrCreateDevPlayerId(): string {
  let id = localStorage.getItem(DEV_PLAYER_ID_KEY)
  if (!id) {
    id = `dev-${crypto.randomUUID()}`
    localStorage.setItem(DEV_PLAYER_ID_KEY, id)
  }
  return id
}

/**
 * ID игрока для запросов к бэкенду игры. Внутри платформы Pikabu Games или
 * тестовой ссылки Студии берёт sdk.player.id (доступен сразу после запуска,
 * даже без авторизации). Вне платформы (локальная разработка) использует
 * случайный ID, сохранённый в localStorage — только для тестирования.
 */
export function usePlayerId(): { playerId: string; isDevFallback: boolean } {
  const sdkState = usePikabuSDK()
  const devId = useMemo(() => getOrCreateDevPlayerId(), [])

  if (sdkState.status === 'ready') {
    return { playerId: sdkState.sdk.player.id, isDevFallback: false }
  }
  return { playerId: devId, isDevFallback: true }
}
