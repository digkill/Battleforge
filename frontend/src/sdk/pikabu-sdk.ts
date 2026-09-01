// Типы и обёртка над Pikabu Games SDK (https://games.pikabu.ru/sdk/docs)
// SDK грузится тегом <script> и работает только внутри платформы Pikabu Games
// или тестового окружения Студии — вне этого контекста PkbSDK.init() недоступен.

export type PikabuPlayer = {
  id: string
  name: string
  avatar: string
  isAuthorized: boolean
  getSignedData(): Promise<string>
}

type PikabuAuthApi = {
  openAuthDialog(): Promise<void>
}

export type PikabuAdError =
  | 'NOT_SUPPORTED'
  | 'IN_PROGRESS'
  | 'UI_BUSY'
  | 'COOLDOWN_ACTIVE'
  | 'INVALID_GAME_STATE'
  | 'UNKNOWN'

export type PikabuAdResult = { rendered: true } | { rendered: false; reason: PikabuAdError }
export type PikabuRewardedAdResult = PikabuAdResult & { reward?: boolean }

type PikabuAdUnit = {
  isSupported: boolean
  canShow(): Promise<boolean>
  show(): Promise<PikabuAdResult>
}

type PikabuRewardedAdUnit = Omit<PikabuAdUnit, 'show'> & {
  show(): Promise<PikabuRewardedAdResult>
}

type PikabuAdsApi = {
  preloader: PikabuAdUnit
  fullscreen: PikabuAdUnit
  rewarded: PikabuRewardedAdUnit
}

export type PikabuProduct = {
  id: string
  name: string
  price: number // в копейках
  currencyCode: string
  formattedPrice: string
}

export type PikabuPurchaseError =
  | 'USER_CANCELLED'
  | 'USER_UNAUTHORIZED'
  | 'UI_BUSY'
  | 'IN_PROGRESS'
  | 'INVALID_PRODUCT_ID'
  | 'NON_CONSUMABLE_ALREADY_OWNED'
  | 'UNKNOWN'

export type PikabuPurchase = {
  purchaseId: string
  productId: string
  developerPayload?: string
  getSignedData(): Promise<string>
}

type PikabuStoreApi = {
  getProducts(): Promise<PikabuProduct[]>
  purchase(params: { productId: string; developerPayload?: string }): Promise<PikabuPurchase>
  consumePurchase(purchaseId: string): Promise<void>
  getPurchases(): Promise<PikabuPurchase[]>
}

type PikabuEvents = {
  userAuthorized: [player: Pick<PikabuPlayer, 'id' | 'name' | 'avatar'>]
}

type PikabuEventApi = {
  on<K extends keyof PikabuEvents>(
    event: K,
    listener: (...args: PikabuEvents[K]) => void,
  ): () => void
  once<K extends keyof PikabuEvents>(
    event: K,
    listener: (...args: PikabuEvents[K]) => void,
  ): () => void
  off<K extends keyof PikabuEvents>(
    event: K,
    listener: (...args: PikabuEvents[K]) => void,
  ): void
}

export type PikabuSDK = {
  player: PikabuPlayer
  auth: PikabuAuthApi
  ads: PikabuAdsApi
  store: PikabuStoreApi
  on: PikabuEventApi['on']
  once: PikabuEventApi['once']
  off: PikabuEventApi['off']
  gameStarted(): void
}

declare global {
  interface Window {
    PkbSDK?: {
      init(): Promise<PikabuSDK>
    }
  }
}

const SDK_SCRIPT_URL = 'https://games.pikabu.ru/sdk/sdk.js'

let sdkPromise: Promise<PikabuSDK> | null = null

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.PkbSDK) {
      resolve()
      return
    }
    const script = document.createElement('script')
    script.src = SDK_SCRIPT_URL
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Не удалось загрузить Pikabu SDK'))
    document.body.append(script)
  })
}

/**
 * Инициализирует Pikabu SDK. Безопасно вызывать несколько раз из разных
 * компонентов — реальный PkbSDK.init() выполнится только один раз.
 */
export function initPikabuSDK(): Promise<PikabuSDK> {
  if (!sdkPromise) {
    sdkPromise = loadScript().then(() => {
      if (!window.PkbSDK) {
        throw new Error('PkbSDK недоступен — игра открыта вне платформы Pikabu Games или тестового окружения Студии')
      }
      return window.PkbSDK.init()
    })
  }
  return sdkPromise
}
