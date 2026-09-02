import { lazy, Suspense, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { PlayerState } from './api'
import { CATALOG } from './catalog'

import { useBattleSocket, type BattleFighter } from './use-battle-socket'

// three.js + drei весят больше всего остального приложения вместе взятого, а
// нужны только в бою. Отдельным чанком вкладка «Коллекция» за них не платит.
const BattleScene = lazy(() => import('./Scene').then((m) => ({ default: m.BattleScene })))

const SQUAD_SIZE = 3

export function BattleView({ playerId, player }: { playerId: string; player: PlayerState }) {
  const [selected, setSelected] = useState<string[]>([])
  const { state, findMatch, act, reset } = useBattleSocket(playerId)

  function toggleUnit(instanceId: string) {
    setSelected((s) =>
      s.includes(instanceId)
        ? s.filter((id) => id !== instanceId)
        : s.length < SQUAD_SIZE
          ? [...s, instanceId]
          : s,
    )
  }

  if (state.phase === 'idle') {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">
          Соберите отряд ({selected.length}/{SQUAD_SIZE})
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {player.units.map((unit) => {
            const def = CATALOG[unit.defId]
            const isSelected = selected.includes(unit.instanceId)
            return (
              <button
                key={unit.instanceId}
                type="button"
                onClick={() => toggleUnit(unit.instanceId)}
                className={`rounded-lg border p-3 text-left text-sm transition-colors ${
                  isSelected ? 'border-primary bg-accent' : 'border-border'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{def?.name ?? unit.defId}</span>
                  <Badge variant="secondary">ур. {unit.level}</Badge>
                </div>
              </button>
            )
          })}
        </div>
        {state.error && <p className="text-sm text-destructive">{state.error}</p>}
        <Button
          type="button"
          disabled={selected.length === 0}
          onClick={() => findMatch(selected)}
        >
          Найти бой
        </Button>
      </div>
    )
  }

  if (state.phase === 'queued') {
    return (
      <div className="flex flex-col items-center gap-4 py-12">
        <p className="text-muted-foreground">Ищем соперника…</p>
        <Button type="button" variant="secondary" onClick={reset}>
          Отменить
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
            {state.endReason === 'opponent_disconnected' && (
              <p className="text-sm text-muted-foreground">Соперник отключился от боя.</p>
            )}
            <Button type="button" onClick={reset}>
              Вернуться к выбору отряда
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
