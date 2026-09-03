import { useCallback, useRef, useState } from 'react'
import { usePikabuSDK } from './use-pikabu-sdk'

export type RewardResult = { rewarded: true } | { rewarded: false; reason: string }

/** Понятные игроку причины отказа вместо кодов SDK. */
const REASONS: Record<string, string> = {
  NOT_SUPPORTED: 'Реклама здесь недоступна',
  IN_PROGRESS: 'Реклама уже показывается',
  UI_BUSY: 'Платформа занята, попробуйте ещё раз',
  COOLDOWN_ACTIVE: 'Слишком часто — подождите немного',
  INVALID_GAME_STATE: 'Сейчас рекламу показать нельзя',
  UNKNOWN: 'Не удалось показать рекламу',
}

/** Сколько «крутится» подставной ролик вне платформы. */
const STUB_SECONDS = 5

/**
 * Показ рекламы за награду.
 *
 * Вне платформы Pikabu SDK принципиально недоступен, но отказывать нельзя: без
 * пропуска привал не проверить и не поиграть при локальной разработке. Поэтому
 * там крутится собственная заглушка — отсчёт на несколько секунд, после
 * которого награда выдаётся так же, как за настоящий ролик.
 */
export function useRewardedAd() {
  const sdkState = usePikabuSDK()
  const [showing, setShowing] = useState(false)
  const [stubLeft, setStubLeft] = useState(0)
  const busy = useRef(false)

  const isStub = sdkState.status !== 'ready'
  const available = !isStub && sdkState.sdk.ads.rewarded.isSupported

  const show = useCallback(async (): Promise<RewardResult> => {
    if (busy.current) return { rewarded: false, reason: REASONS.IN_PROGRESS }
    busy.current = true
    setShowing(true)
    try {
      if (sdkState.status !== 'ready') {
        // Заглушка: тикаем секунды, чтобы пропуск не был мгновенным и вёл себя
        // как настоящий ролик — иначе на нём не проверить ни таймер, ни UI.
        for (let left = STUB_SECONDS; left > 0; left--) {
          setStubLeft(left)
          await new Promise((r) => setTimeout(r, 1000))
        }
        setStubLeft(0)
        return { rewarded: true }
      }

      const res = await sdkState.sdk.ads.rewarded.show()
      if (!res.rendered) {
        return { rewarded: false, reason: REASONS[res.reason] ?? REASONS.UNKNOWN }
      }
      // Награду даёт только флаг reward: ролик могли закрыть на середине, и
      // тогда он «показан», но не досмотрен.
      if (!res.reward) return { rewarded: false, reason: 'Ролик не досмотрен до конца' }
      return { rewarded: true }
    } catch {
      return { rewarded: false, reason: REASONS.UNKNOWN }
    } finally {
      busy.current = false
      setShowing(false)
      setStubLeft(0)
    }
  }, [sdkState])

  return { available, isStub, showing, stubLeft, show }
}
