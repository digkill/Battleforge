import { useCallback, useState } from 'react'
import { usePikabuSDK } from './use-pikabu-sdk'

export type RewardResult =
  | { rewarded: true }
  | { rewarded: false; reason: string }

/** Понятные игроку причины отказа вместо кодов SDK. */
const REASONS: Record<string, string> = {
  NOT_SUPPORTED: 'Реклама здесь недоступна',
  IN_PROGRESS: 'Реклама уже показывается',
  UI_BUSY: 'Платформа занята, попробуйте ещё раз',
  COOLDOWN_ACTIVE: 'Слишком часто — подождите немного',
  INVALID_GAME_STATE: 'Сейчас рекламу показать нельзя',
  UNKNOWN: 'Не удалось показать рекламу',
}

/**
 * Показ рекламы за награду.
 *
 * Вне платформы Pikabu (локальная разработка) SDK принципиально недоступен,
 * поэтому `available` там false, а кнопку показа прятать не нужно — она просто
 * объяснит, почему награда недоступна.
 */
export function useRewardedAd() {
  const sdkState = usePikabuSDK()
  const [showing, setShowing] = useState(false)

  const available = sdkState.status === 'ready' && sdkState.sdk.ads.rewarded.isSupported

  const show = useCallback(async (): Promise<RewardResult> => {
    if (sdkState.status !== 'ready') {
      return { rewarded: false, reason: 'Реклама доступна только внутри Pikabu Games' }
    }
    if (showing) return { rewarded: false, reason: REASONS.IN_PROGRESS }

    setShowing(true)
    try {
      const res = await sdkState.sdk.ads.rewarded.show()
      if (!res.rendered) {
        return { rewarded: false, reason: REASONS[res.reason] ?? REASONS.UNKNOWN }
      }
      // Награду даёт только флаг reward: ролик могли закрыть на середине, и
      // тогда он «показан», но не досмотрен.
      if (!res.reward) {
        return { rewarded: false, reason: 'Ролик не досмотрен до конца' }
      }
      return { rewarded: true }
    } catch {
      return { rewarded: false, reason: REASONS.UNKNOWN }
    } finally {
      setShowing(false)
    }
  }, [sdkState, showing])

  return { available, showing, show }
}
