import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { upgradeUnit, type PlayerState } from './api'
import { CATALOG, MAX_LEVEL, statsAtLevel, upgradeCost } from './catalog'

export function CollectionView({
  playerId,
  player,
  onPlayerChange,
}: {
  playerId: string
  player: PlayerState
  onPlayerChange: (p: PlayerState) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [pendingId, setPendingId] = useState<string | null>(null)

  async function handleUpgrade(instanceId: string) {
    setPendingId(instanceId)
    setError(null)
    try {
      onPlayerChange(await upgradeUnit(playerId, instanceId))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Ваш отряд</h2>
        <Badge variant="secondary">Золото: {player.gold}</Badge>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {player.units.map((unit) => {
          const def = CATALOG[unit.defId]
          const stats = statsAtLevel(unit.defId, unit.level)
          const cost = upgradeCost(unit.level)
          const maxed = unit.level >= MAX_LEVEL

          return (
            <Card key={unit.instanceId}>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  <span>{def?.name ?? unit.defId}</span>
                  <Badge>ур. {unit.level}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <div className="flex justify-between">
                    <dt>HP</dt>
                    <dd>{stats.hp}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Атака</dt>
                    <dd>{stats.atk}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Защита</dt>
                    <dd>{stats.def}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Скорость</dt>
                    <dd>{stats.spd}</dd>
                  </div>
                </dl>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={maxed || pendingId === unit.instanceId || player.gold < cost}
                  onClick={() => handleUpgrade(unit.instanceId)}
                >
                  {maxed ? 'Макс. уровень' : `Прокачать за ${cost} золота`}
                </Button>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
