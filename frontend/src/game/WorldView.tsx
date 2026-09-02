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
  moveCost,
  type Lair,
  type World,
  type WorldHex,
} from './worldmap'

const WorldScene = lazy(() => import('./WorldScene').then((m) => ({ default: m.WorldScene })))

const SEED_KEY = 'battleforge-world-seed'
const HERO_KEY = 'battleforge-world-hero'
const CLEARED_KEY = 'battleforge-world-cleared'

/** Шаг героя по карте — пауза между клетками, чтобы движение было видно. */
const STEP_MS = 260

/**
 * Карта приключений. Мир целиком выводится из seed, поэтому в localStorage
 * хранятся только seed, клетка героя и список разбитых логов — этого хватает,
 * чтобы восстановить карту после перезагрузки, не заводя её на сервере.
 */
export function WorldView({
  player,
  onEnterLair,
}: {
  player: PlayerState
  onEnterLair: (lair: Lair) => void
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
  // Идентификатор текущего перехода: если игрок кликнул новую цель, старый
  // маршрут обязан прекратиться, иначе герой пойдёт по двум путям сразу.
  const walkId = useRef(0)

  useEffect(() => {
    localStorage.setItem(HERO_KEY, hexKey(hero))
  }, [hero])

  const blocked = useMemo(
    () => new Set(world.lairs.filter((l) => !l.cleared).map((l) => hexKey(l.at))),
    [world.lairs],
  )

  // Подсвечиваем клетки, докуда герой дойдёт за один «день» — иначе карта не
  // подсказывает, что вообще доступно.
  const reachable = useMemo(() => {
    const out = new Set<string>()
    const budget = 12
    for (let row = 0; row < world.height; row++) {
      for (let col = 0; col < world.width; col++) {
        const to = { col, row }
        if (hexKey(to) === hexKey(hero)) continue
        const path = findPath(world, hero, to, blocked)
        if (!path) continue
        const cost = path.reduce((sum, h) => sum + moveCost(world.rows[h.row][h.col]), 0)
        if (cost <= budget) out.add(hexKey(to))
      }
    }
    return out
  }, [world, hero, blocked])

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
      void walk(path)
    },
    [world, hero, blocked, walk],
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
      void walk(approach, () => onEnterLair(lair))
    },
    [world, hero, blocked, walk, onEnterLair],
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

  const remaining = world.lairs.filter((l) => !l.cleared).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl">Карта земель</h2>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">Логов осталось: {remaining}</Badge>
          <Badge variant="outline">Отряд: {player.units.length}</Badge>
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
        />
      </Suspense>

      {notice && <p className="text-sm text-destructive">{notice}</p>}

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
