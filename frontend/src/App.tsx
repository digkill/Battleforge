import { useEffect, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BattleView } from '@/game/BattleView'
import { CollectionView } from '@/game/CollectionView'
import { getCollection, type PlayerState } from '@/game/api'
import { usePlayerId } from '@/sdk/use-player-id'
import { usePikabuSDK } from '@/sdk/use-pikabu-sdk'

function App() {
  const sdkState = usePikabuSDK()
  const { playerId, isDevFallback } = usePlayerId()
  const [player, setPlayer] = useState<PlayerState | null>(null)
  const [error, setError] = useState<string | null>(null)

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

  return (
    <div className="min-h-svh bg-background text-foreground flex flex-col">
      <header className="border-b px-6 py-4 flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Battleforge</h1>
        <div className="flex items-center gap-2">
          {isDevFallback && <Badge variant="outline">Dev-режим (вне платформы Pikabu)</Badge>}
          {player && <Badge variant="secondary">Золото: {player.gold}</Badge>}
        </div>
      </header>

      <main className="flex-1 p-6">
        {error && <p className="text-sm text-destructive">{error}</p>}
        {!player && !error && <p className="text-sm text-muted-foreground">Загрузка…</p>}

        {player && (
          <Tabs defaultValue="collection">
            <TabsList>
              <TabsTrigger value="collection">Коллекция</TabsTrigger>
              <TabsTrigger value="battle">Бой</TabsTrigger>
            </TabsList>
            <TabsContent value="collection" className="pt-4">
              <CollectionView playerId={playerId} player={player} onPlayerChange={setPlayer} />
            </TabsContent>
            <TabsContent value="battle" className="pt-4">
              <BattleView playerId={playerId} player={player} />
            </TabsContent>
          </Tabs>
        )}
      </main>
    </div>
  )
}

export default App
