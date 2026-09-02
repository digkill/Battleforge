import { lazy, Suspense, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { PlayerState } from './api'
import type { Lair } from './worldmap'

import { useBattleSocket, type BattleFighter } from './use-battle-socket'

// three.js + drei весят больше всего остального приложения вместе взятого, а
// нужны только в бою. Отдельным чанком вкладка «Коллекция» за них не платит.
const BattleScene = lazy(() => import('./Scene').then((m) => ({ default: m.BattleScene })))

const SQUAD_SIZE = 3

export function BattleView({
  playerId,
  player,
  lair,
  onLeave,
}: {
  playerId: string
  player: PlayerState
  /** Логово с карты: бой начинается сразу, отряд собирать не нужно. */
  lair: Lair
  onLeave: (cleared: boolean) => void
}) {
  const { state, findMatch, act, reset } = useBattleSocket(playerId)

  // В логово герой входит всем войском — выбирать отряд посреди карты незачем.
  useEffect(() => {
    findMatch(player.units.map((u) => u.instanceId).slice(0, SQUAD_SIZE), 'creep')
    return () => reset()
    // Бой на логово заводится ровно один раз при входе.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lair.id])


  if (state.phase === 'idle') {
    return <p className="text-sm text-muted-foreground">Готовим сражение…</p>
  }

  if (state.phase === 'queued') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <p className="text-muted-foreground">
          {state.creep ? `${lair.name}: ${state.creep.count} шт., ур. ${state.creep.level}` : 'Готовим сражение…'}
        </p>
        <Button type="button" variant="secondary" onClick={() => onLeave(false)}>
          Отступить
        </Button>
      </div>
    )
  }

  const mine = state.units.filter((u) =>
    state.playerA === playerId ? u.side === 0 : u.side === 1,
  )
  const theirs = state.units.filter((u) =>
    state.playerA === playerId ? u.side === 1 : u.side === 0,
  )

  return (
    <div className="flex flex-col gap-4">
      <Suspense
        fallback={<div className="h-80 w-full rounded-lg border bg-[#120e18] sm:h-[26rem]" />}
      >
        <BattleScene
          field={state.field}
          units={state.units}
          activeUnitId={state.yourTurnUnitId ?? state.opponentUnitId}
          reachable={state.reachable}
          attackable={state.attackable}
          onMove={(hex) => act({ moveTo: hex })}
          onAttack={(opt) => act({ targetId: opt.targetId, moveTo: opt.from })}
        />
      </Suspense>

      <div className="grid gap-4 md:grid-cols-2">
        <Squad title="Ваш отряд" units={mine} yourTurnUnitId={state.yourTurnUnitId} />
        <Squad title="Отряд соперника" units={theirs} yourTurnUnitId={null} />
      </div>

      {state.yourTurnUnitId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Ход юнита: {unitLabel(state.units, state.yourTurnUnitId)}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              {state.attackable.length > 0
                ? 'Кликните подсвеченного красным врага, чтобы атаковать, или золотую клетку, чтобы перейти.'
                : 'Достать некого — кликните золотую клетку, чтобы подойти ближе.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {state.attackable.map((opt) => (
                <Button
                  key={opt.targetId}
                  type="button"
                  variant="secondary"
                  onClick={() => act({ targetId: opt.targetId, moveTo: opt.from })}
                >
                  Атаковать: {unitLabel(state.units, opt.targetId)}
                  {opt.cost > 0 && ` (подойти на ${opt.cost})`}
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Журнал боя</CardTitle>
        </CardHeader>
        <CardContent className="flex max-h-40 flex-col-reverse gap-1 overflow-y-auto text-sm text-muted-foreground">
          {[...state.log].reverse().map((entry, i) => (
            <p key={i}>
              {entry.targetId ? (
                <>
                  {unitLabel(state.units, entry.attackerId)} →{' '}
                  {unitLabel(state.units, entry.targetId)}: {entry.damage} урона
                  {entry.targetKo ? ' (повержен)' : ''}
                </>
              ) : (
                <>
                  {unitLabel(state.units, entry.attackerId)} перешёл на клетку{' '}
                  {entry.movedTo ? `${entry.movedTo.col}:${entry.movedTo.row}` : '—'}
                </>
              )}
            </p>
          ))}
        </CardContent>
      </Card>

      {state.phase === 'finished' && (
        <Card>
          <CardHeader>
            <CardTitle>{state.winner === playerId ? 'Победа!' : 'Поражение'}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {state.recruited && (
              <p className="text-sm text-primary">
                {state.recruited.name} присоединяется к вашему войску.
              </p>
            )}
            {state.winner !== playerId && (
              <p className="text-sm text-muted-foreground">
                Логово выстояло — оно останется на карте.
              </p>
            )}
            <Button type="button" onClick={() => onLeave(state.winner === playerId)}>
              Вернуться на карту
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function unitLabel(units: BattleFighter[], instanceId: string): string {
  // Fighter.name с бэкенда уже локализован (напр. "Воин") — CATALOG тут не нужен.
  return units.find((u) => u.instanceId === instanceId)?.name ?? instanceId
}

function Squad({
  title,
  units,
  yourTurnUnitId,
}: {
  title: string
  units: BattleFighter[]
  yourTurnUnitId: string | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {units.map((unit) => (
          <div
            key={unit.instanceId}
            className={`rounded-md border p-2 ${
              unit.instanceId === yourTurnUnitId ? 'border-primary' : 'border-border'
            } ${unit.currentHp <= 0 ? 'opacity-40' : ''}`}
          >
            <div className="mb-1 flex items-center justify-between text-sm">
              <span>{unit.name}</span>
              <span className="text-muted-foreground">
                {unit.currentHp}/{unit.stats.hp}
              </span>
            </div>
            <Progress value={(unit.currentHp / unit.stats.hp) * 100} />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
