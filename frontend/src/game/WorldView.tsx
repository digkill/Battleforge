import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PlayerState } from './api'
import { CATALOG } from './catalog'
import {
  findPath,
  generateWorld,
  hexKey,
  MOVES_PER_DAY,
  pathCost,
  reachableFrom,
  type Lair,
  type World,
  type WorldHex,
} from './worldmap'
import { getTavern, hireUnit, type TavernOffer } from './api'
import { useRewardedAd } from '@/sdk/use-rewarded-ad'

const WorldScene = lazy(() => import('./WorldScene').then((m) => ({ default: m.WorldScene })))

const SEED_KEY = 'battleforge-world-seed'
const HERO_KEY = 'battleforge-world-hero'
const CLEARED_KEY = 'battleforge-world-cleared'
const DAY_KEY = 'battleforge-world-day'
const MOVES_KEY = 'battleforge-world-moves'
const REST_UNTIL_KEY = 'battleforge-world-rest-until'

/**
 * Сколько герой отдыхает, когда переходы кончились.
 *
 * Момент окончания хранится как абсолютное время, а не как остаток: иначе
 * ожидание сбрасывалось бы перезагрузкой страницы, и платить за пропуск было
 * бы незачем.
 */
const REST_MS = 90_000

/** Шаг героя по карте — пауза между клетками, чтобы движение было видно. */
const STEP_MS = 260

/**
 * Карта приключений. Мир целиком выводится из seed, поэтому в localStorage
 * хранятся только seed, клетка героя и список разбитых логов — этого хватает,
 * чтобы восстановить карту после перезагрузки, не заводя её на сервере.
 */
export function WorldView({
  player,
  playerId,
  onEnterLair,
  onPlayerChange,
}: {
  player: PlayerState
  playerId: string
  onEnterLair: (lair: Lair) => void
  onPlayerChange: (p: PlayerState) => void
}) {
  const [world, setWorld] = useState<World>(() => {
    let seed = Number(localStorage.getItem(SEED_KEY))
    if (!Number.isFinite(seed) || seed === 0) {
      seed = Math.floor(Math.random() * 1e9)
      localStorage.setItem(SEED_KEY, String(seed))
    }
    const w = generateWorld(seed)

    const savedHero = localStorage.getItem(HERO_KEY)
    if (savedHero) {
      const [col, row] = savedHero.split(':').map(Number)
      if (Number.isFinite(col) && Number.isFinite(row)) w.hero = { col, row }
    }
    const cleared = new Set((localStorage.getItem(CLEARED_KEY) ?? '').split(',').filter(Boolean))
    w.lairs = w.lairs.map((l) => (cleared.has(l.id) ? { ...l, cleared: true } : l))
    return w
  })

  const [hero, setHero] = useState<WorldHex>(world.hero)
  const [moving, setMoving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [day, setDay] = useState(() => Number(localStorage.getItem(DAY_KEY)) || 1)
  const [movesLeft, setMovesLeft] = useState(() => {
    const saved = Number(localStorage.getItem(MOVES_KEY))
    return Number.isFinite(saved) && saved > 0 ? saved : MOVES_PER_DAY
  })
  const [restUntil, setRestUntil] = useState<number>(
    () => Number(localStorage.getItem(REST_UNTIL_KEY)) || 0,
  )
  const [now, setNow] = useState(() => Date.now())
  const [tavernOpen, setTavernOpen] = useState(false)
  const [offers, setOffers] = useState<TavernOffer[]>([])
  const [hiring, setHiring] = useState<string | null>(null)
  const { available: adAvailable, showing: adShowing, show: showAd } = useRewardedAd()
  // Идентификатор текущего перехода: если игрок кликнул новую цель, старый
  // маршрут обязан прекратиться, иначе герой пойдёт по двум путям сразу.
  const walkId = useRef(0)

  useEffect(() => {
    localStorage.setItem(HERO_KEY, hexKey(hero))
  }, [hero])

  useEffect(() => {
    localStorage.setItem(DAY_KEY, String(day))
    localStorage.setItem(MOVES_KEY, String(movesLeft))
  }, [day, movesLeft])

  // Тикаем только пока идёт отсчёт: постоянный таймер держал бы перерисовку зря.
  const resting = restUntil > now
  useEffect(() => {
    if (!resting) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [resting])

  useEffect(() => {
    if (!tavernOpen || offers.length > 0) return
    getTavern(playerId)
      .then((r) => setOffers(r.offers))
      .catch((e: Error) => setNotice(e.message))
  }, [tavernOpen, offers.length, playerId])

  const blocked = useMemo(
    () => new Set(world.lairs.filter((l) => !l.cleared).map((l) => hexKey(l.at))),
    [world.lairs],
  )

  // Подсвечиваем клетки, докуда герой дойдёт на оставшиеся очки, — иначе карта
  // не подсказывает, что вообще доступно.
  const reachable = useMemo(
    () => new Set(reachableFrom(world, hero, movesLeft, blocked).keys()),
    [world, hero, blocked, movesLeft],
  )

  /**
   * Списывает очки перехода и, если они кончились, отправляет героя на привал.
   *
   * Привал начинается здесь, а не в эффекте по movesLeft: эффект запускал бы
   * лишний цикл перерисовки, а событие траты — единственный момент, когда очки
   * реально могут обнулиться.
   */
  const spendMoves = useCallback((cost: number) => {
    setMovesLeft((left) => {
      const rest = left - cost
      if (rest <= 0) {
        const until = Date.now() + REST_MS
        localStorage.setItem(REST_UNTIL_KEY, String(until))
        setRestUntil(until)
        setNow(Date.now())
      }
      return Math.max(0, rest)
    })
  }, [])

  const walk = useCallback(
    async (path: WorldHex[], onArrive?: () => void) => {
      const id = ++walkId.current
      setMoving(true)
      for (const step of path) {
        await new Promise((r) => setTimeout(r, STEP_MS))
        if (walkId.current !== id) return // игрок передумал — этот маршрут отменён
        setHero(step)
      }
      setMoving(false)
      onArrive?.()
    },
    [],
  )

  const goTo = useCallback(
    (to: WorldHex) => {
      setNotice(null)
      const path = findPath(world, hero, to, blocked)
      if (!path) {
        setNotice('Туда не пройти — путь перекрыт горами или водой.')
        return
      }
      if (path.length === 0) return
      const cost = pathCost(world, path)
      if (cost > movesLeft) {
        setNotice('Герой выдохся — очков передвижения не хватит. Начните следующий день.')
        return
      }
      spendMoves(cost)
      void walk(path)
    },
    [world, hero, blocked, walk, movesLeft, spendMoves],
  )

  const attackLair = useCallback(
    (lair: Lair) => {
      setNotice(null)
      const path = findPath(world, hero, lair.at, blocked)
      if (!path) {
        setNotice('До логова не добраться.')
        return
      }
      // Останавливаемся на клетке перед логовом: занимать его герой не должен,
      // туда он войдёт только после победы.
      const approach = path.slice(0, -1)
      const cost = pathCost(world, approach)
      if (cost > movesLeft) {
        setNotice('До логова в этот день не дойти — начните следующий.')
        return
      }
      spendMoves(cost)
      void walk(approach, () => onEnterLair(lair))
    },
    [world, hero, blocked, walk, onEnterLair, movesLeft, spendMoves],
  )

  const clearLair = useCallback((lairId: string) => {
    setWorld((w) => ({ ...w, lairs: w.lairs.map((l) => (l.id === lairId ? { ...l, cleared: true } : l)) }))
    const prev = (localStorage.getItem(CLEARED_KEY) ?? '').split(',').filter(Boolean)
    localStorage.setItem(CLEARED_KEY, [...new Set([...prev, lairId])].join(','))
  }, [])

  // Экспортируем наружу способ пометить логово разбитым — вызывается после победы.
  useEffect(() => {
    ;(window as unknown as { __battleforgeClearLair?: (id: string) => void }).__battleforgeClearLair =
      clearLair
  }, [clearLair])

  const nextDay = useCallback(() => {
    setDay((d) => d + 1)
    setMovesLeft(MOVES_PER_DAY)
    setRestUntil(0)
    localStorage.removeItem(REST_UNTIL_KEY)
    setNotice(null)
  }, [])

  const watchAdForDay = useCallback(async () => {
    const res = await showAd()
    if (!res.rewarded) {
      setNotice(res.reason)
      return
    }
    nextDay()
  }, [showAd, nextDay])

  const hire = useCallback(
    async (offer: TavernOffer) => {
      setHiring(offer.defId)
      setNotice(null)
      try {
        const { player: updated } = await hireUnit(playerId, offer.defId)
        onPlayerChange(updated)
      } catch (e) {
        setNotice((e as Error).message)
      } finally {
        setHiring(null)
      }
    },
    [playerId, onPlayerChange],
  )

  const remaining = world.lairs.filter((l) => !l.cleared).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl">Карта земель</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="border-primary/40 text-primary">
            День {day}
          </Badge>
          <Badge variant={movesLeft > 0 ? 'secondary' : 'outline'}>
            Переходы: {movesLeft}/{MOVES_PER_DAY}
          </Badge>
          <Badge variant="outline">Логов осталось: {remaining}</Badge>
          <Badge variant="outline">Отряд: {player.units.length}</Badge>
          {resting ? (
            <>
              <Badge variant="outline">
                Привал: {Math.ceil((restUntil - now) / 1000)} с
              </Badge>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={adShowing}
                onClick={() => void watchAdForDay()}
                title={
                  adAvailable
                    ? 'Посмотреть ролик и начать день сразу'
                    : 'Реклама доступна только внутри Pikabu Games'
                }
              >
                {adShowing ? 'Реклама…' : 'Пропустить за рекламу'}
              </Button>
            </>
          ) : (
            <Button type="button" size="sm" onClick={nextDay}>
              Следующий день
            </Button>
          )}
        </div>
      </div>

      <Suspense
        fallback={<div className="h-[24rem] w-full rounded-lg border bg-[#0f0c14] sm:h-[32rem]" />}
      >
        <WorldScene
          world={world}
          heroAt={hero}
          moving={moving}
          reachable={reachable}
          onPickHex={goTo}
          onPickLair={attackLair}
          onPickCastle={() => setTavernOpen((v) => !v)}
        />
      </Suspense>

      {notice && <p className="text-sm text-destructive">{notice}</p>}

      {tavernOpen && (
        <Card className="border-primary/40">
          <CardHeader>
            <CardTitle className="text-base">Замок — найм войска</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {offers.length === 0 && (
              <p className="text-sm text-muted-foreground">Загружаем предложения…</p>
            )}
            {offers.map((offer) => (
              <div key={offer.defId} className="rounded-md border border-border p-3">
                <div className="mb-1 flex items-center justify-between">
                  <span className="font-medium">{offer.name}</span>
                  <Badge variant="secondary">{offer.cost} зол.</Badge>
                </div>
                <p className="mb-2 text-xs text-muted-foreground">
                  HP {offer.stats.hp} · Атака {offer.stats.atk} · Защита {offer.stats.def} · Скорость{' '}
                  {offer.stats.spd}
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="w-full"
                  disabled={hiring === offer.defId || player.gold < offer.cost}
                  onClick={() => void hire(offer)}
                >
                  {player.gold < offer.cost ? 'Не хватает золота' : 'Нанять'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Что делать</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p>Кликните по клетке — герой пойдёт туда. Золотым подсвечено, докуда он дойдёт сразу.</p>
          <p>
            Кликните по красному логову — герой подойдёт и вступит в бой. Победите — оборотень
            присоединится к отряду.
          </p>
          <p>Горы и вода непроходимы, лес замедляет, по дороге идти быстрее всего.</p>
          <p>
            Кликните по замку с голубым кольцом — там нанимают войско за золото.
          </p>
          <p>
            Когда переходы кончатся, герой встаёт на привал. Дождитесь конца отсчёта или
            посмотрите рекламный ролик, чтобы выступить сразу.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Ваш отряд</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {player.units.map((u) => (
            <Badge key={u.instanceId} variant="secondary">
              {CATALOG[u.defId]?.name ?? u.defId} · ур. {u.level}
            </Badge>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}

export function ResetWorldButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        localStorage.removeItem(SEED_KEY)
        localStorage.removeItem(HERO_KEY)
        localStorage.removeItem(CLEARED_KEY)
        window.location.reload()
      }}
    >
      Новая карта
    </Button>
  )
}
