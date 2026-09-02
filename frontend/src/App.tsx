import { useCallback, useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BattleView } from '@/game/BattleView'
import { CollectionView } from '@/game/CollectionView'
import { WorldView, ResetWorldButton } from '@/game/WorldView'
import { getCollection, type PlayerState } from '@/game/api'
import type { Lair } from '@/game/worldmap'
import { usePlayerId } from '@/sdk/use-player-id'
import { usePikabuSDK } from '@/sdk/use-pikabu-sdk'

type Screen = 'map' | 'army'

function App() {
  const sdkState = usePikabuSDK()
  const { playerId, isDevFallback } = usePlayerId()
  const [player, setPlayer] = useState<PlayerState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [screen, setScreen] = useState<Screen>('map')
  // Логово, в которое герой вошёл на карте: пока оно задано, показывается бой.
  const [lair, setLair] = useState<Lair | null>(null)

  useEffect(() => {
    if (sdkState.status === 'ready') sdkState.sdk.gameStarted()
    // gameStarted можно безопасно вызывать при каждой смене статуса — сам SDK
    // защищён от повторных сайд-эффектов внутри одной игровой сессии.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkState.status])

  useEffect(() => {
    getCollection(playerId)
      .then(setPlayer)
      .catch((e: Error) => setError(e.message))
  }, [playerId])

  const refreshPlayer = useCallback(() => {
    getCollection(playerId).then(setPlayer).catch(() => undefined)
  }, [playerId])

  // Бой закончился: обновляем отряд и, если логово разбито, убираем его с карты.
  const leaveBattle = useCallback(
    (cleared: boolean) => {
      if (cleared && lair) {
        const clear = (window as unknown as { __battleforgeClearLair?: (id: string) => void })
          .__battleforgeClearLair
        clear?.(lair.id)
      }
      setLair(null)
      refreshPlayer()
    },
    [lair, refreshPlayer],
  )

  return (
    <div className="min-h-svh bg-background text-foreground flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-primary/25 bg-gradient-to-b from-primary/10 to-transparent px-6 py-4">
        <h1 className="text-2xl text-primary drop-shadow-[0_1px_6px_oklch(0.78_0.135_78_/_35%)]">
          Battleforge
        </h1>

        {player && !lair && (
          <nav className="flex items-center gap-1">
            <Button
              type="button"
              variant={screen === 'map' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setScreen('map')}
            >
              Карта
            </Button>
            <Button
              type="button"
              variant={screen === 'army' ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setScreen('army')}
            >
              Войско
            </Button>
            <ResetWorldButton />
          </nav>
        )}

        <div className="flex items-center gap-2">
          {isDevFallback && <Badge variant="outline">Dev-режим (вне платформы Pikabu)</Badge>}
          {player && (
            <Badge variant="secondary" className="border-primary/40 text-primary">
              ⚜ {player.gold} золота
            </Badge>
          )}
        </div>
      </header>

      <main className="flex-1 p-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!player && !error && <p className="text-sm text-muted-foreground">Загрузка…</p>}

        {player && lair && (
          <BattleView
            playerId={playerId}
            player={player}
            lair={lair}
            onLeave={leaveBattle}
          />
        )}

        {player && !lair && screen === 'map' && (
          <WorldView player={player} onEnterLair={setLair} />
        )}

        {player && !lair && screen === 'army' && (
          <CollectionView playerId={playerId} player={player} onPlayerChange={setPlayer} />
        )}
      </main>
    </div>
  )
}

export default App
