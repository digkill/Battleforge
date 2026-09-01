import { useEffect, useState } from 'react'
import { initPikabuSDK, type PikabuSDK } from './pikabu-sdk'

type SDKState =
  | { status: 'loading' }
  | { status: 'ready'; sdk: PikabuSDK }
  | { status: 'error'; error: Error }

/**
 * Инициализирует Pikabu SDK при монтировании и отдаёт его состояние.
 * Игра вне платформы Pikabu Games / тестового окружения Студии закономерно
 * получит status: 'error' — это не баг, а ограничение самого SDK.
 */
export function usePikabuSDK(): SDKState {
  const [state, setState] = useState<SDKState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    initPikabuSDK()
      .then((sdk) => {
        if (!cancelled) setState({ status: 'ready', sdk })
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ status: 'error', error })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return state
}
