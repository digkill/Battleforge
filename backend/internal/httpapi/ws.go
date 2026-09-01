package httpapi

import (
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"

	"battleforge/backend/internal/battle"
	"battleforge/backend/internal/player"
	"battleforge/backend/internal/units"
)

var upgrader = websocket.Upgrader{
	// Игра встраивается в iframe платформы Pikabu Games с другого origin,
	// поэтому проверяем сам факт апгрейда, а не Origin запроса.
	CheckOrigin: func(r *http.Request) bool { return true },
}

// incoming — сообщения от клиента через WebSocket.
type incoming struct {
	Type     string   `json:"type"`
	UnitIDs  []string `json:"unitIds,omitempty"`
	TargetID string   `json:"targetId,omitempty"`
}

// room сводит двух заматченных игроков вокруг общего battle.Battle. Пишут в
// оба соединения только сама горутина run() (через send/broadcast), поэтому
// gorilla/websocket не видит конкурентной записи в один conn.
type room struct {
	b       *battle.Battle
	playerA string
	playerB string
	connA   *websocket.Conn
	connB   *websocket.Conn
	writeMu sync.Mutex

	unitOwner map[string]string // instanceID -> playerID

	actions    chan playerAction
	disconnect chan string // playerID отключившегося игрока, буфер 1

	ready    chan struct{}
	attached int
}

type playerAction struct {
	playerID string
	targetID string
}

func newRoom(b *battle.Battle, playerA, playerB string) *room {
	owner := make(map[string]string)
	for _, f := range b.Snapshot() {
		if f.Side == battle.SideA {
			owner[f.InstanceID] = playerA
		} else {
			owner[f.InstanceID] = playerB
		}
	}
	return &room{
		b:          b,
		playerA:    playerA,
		playerB:    playerB,
		unitOwner:  owner,
		actions:    make(chan playerAction, 1),
		disconnect: make(chan string, 1),
		ready:      make(chan struct{}),
	}
}

// attach регистрирует соединение игрока в комнате. Возвращает true, если это
// было второе (последнее) подключение — вызывающий должен тогда запустить run().
func (s *Server) attachToRoom(rm *room, b *battle.Battle, playerID string, conn *websocket.Conn) bool {
	s.roomsMu.Lock()
	defer s.roomsMu.Unlock()

	if playerID == rm.playerA {
		rm.connA = conn
	} else {
		rm.connB = conn
	}
	rm.attached++
	if rm.attached == 2 {
		delete(s.rooms, b)
		close(rm.ready)
		return true
	}
	return false
}

func (rm *room) connFor(playerID string) *websocket.Conn {
	if playerID == rm.playerA {
		return rm.connA
	}
	return rm.connB
}

func (rm *room) opponentOf(playerID string) string {
	if playerID == rm.playerA {
		return rm.playerB
	}
	return rm.playerA
}

func (rm *room) send(conn *websocket.Conn, msg any) {
	rm.writeMu.Lock()
	defer rm.writeMu.Unlock()
	if err := conn.WriteJSON(msg); err != nil {
		log.Printf("battle ws: write error: %v", err)
	}
}

func (rm *room) broadcast(msg any) {
	rm.send(rm.connA, msg)
	rm.send(rm.connB, msg)
}

// reportDisconnect уведомляет комнату о разрыве соединения игрока. Неблокирующая
// отправка — если сигнал уже кем-то отправлен, второй просто отбрасывается.
func (rm *room) reportDisconnect(playerID string) {
	select {
	case rm.disconnect <- playerID:
	default:
	}
}

// run — авторитетный игровой цикл боя. Запускается ровно одной из двух
// горутин-обработчиков (той, что видит оба соединения подключёнными).
func (rm *room) run(onFinish func(winner string)) {
	rm.broadcast(map[string]any{
		"type":    "battle_start",
		"units":   rm.b.Snapshot(),
		"playerA": rm.playerA,
		"playerB": rm.playerB,
	})

	for rm.b.Winner() == nil {
		actorID, ok := rm.b.CurrentTurn()
		if !ok {
			break
		}
		owner := rm.unitOwner[actorID]
		targets := rm.b.AliveTargets(actorID)

		rm.send(rm.connFor(owner), map[string]any{
			"type":         "your_turn",
			"unitId":       actorID,
			"validTargets": targets,
		})
		rm.send(rm.connFor(rm.opponentOf(owner)), map[string]any{
			"type":   "opponent_turn",
			"unitId": actorID,
		})

		select {
		case loser := <-rm.disconnect:
			winner := rm.opponentOf(loser)
			rm.broadcast(map[string]any{"type": "battle_end", "winner": winner, "reason": "opponent_disconnected"})
			onFinish(winner)
			return

		case action := <-rm.actions:
			if action.playerID != owner {
				rm.send(rm.connFor(action.playerID), map[string]any{"type": "error", "message": "сейчас не ваш ход"})
				continue
			}
			entry, err := rm.b.Act(actorID, action.targetID)
			if err != nil {
				rm.send(rm.connFor(action.playerID), map[string]any{"type": "error", "message": err.Error()})
				continue
			}
			rm.broadcast(map[string]any{
				"type":  "battle_update",
				"log":   entry,
				"units": rm.b.Snapshot(),
			})
		}
	}

	winnerSide := rm.b.Winner()
	winner := rm.playerA
	if winnerSide != nil && *winnerSide == battle.SideB {
		winner = rm.playerB
	}
	rm.broadcast(map[string]any{"type": "battle_end", "winner": winner})
	onFinish(winner)
}

const battleWinReward = 100

func (s *Server) handleBattleWS(w http.ResponseWriter, r *http.Request) {
	playerID := r.URL.Query().Get("playerId")
	if playerID == "" {
		http.Error(w, "playerId query param required", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("battle ws: upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	p := s.players.GetOrCreate(playerID)

	var msg incoming
	if err := conn.ReadJSON(&msg); err != nil || msg.Type != "queue" {
		_ = conn.WriteJSON(map[string]any{"type": "error", "message": `первым сообщением должен быть {"type":"queue","unitIds":[...]}`})
		return
	}

	squad, err := resolveSquad(p, msg.UnitIDs)
	if err != nil {
		_ = conn.WriteJSON(map[string]any{"type": "error", "message": err.Error()})
		return
	}

	_ = conn.WriteJSON(map[string]any{"type": "queued"})
	waiting := s.matchmaker.Enqueue(playerID, squad)

	match := <-waiting.Matched

	s.roomsMu.Lock()
	rm, exists := s.rooms[match.Battle]
	if !exists {
		rm = newRoom(match.Battle, match.PlayerA, match.PlayerB)
		s.rooms[match.Battle] = rm
	}
	s.roomsMu.Unlock()

	isLast := s.attachToRoom(rm, match.Battle, playerID, conn)
	if isLast {
		go rm.run(func(winner string) {
			s.players.AddGold(winner, battleWinReward)
		})
	} else {
		<-rm.ready
	}

	// read pump: пересылаем действия игрока в комнату до разрыва соединения
	for {
		var m incoming
		if err := conn.ReadJSON(&m); err != nil {
			rm.reportDisconnect(playerID)
			return
		}
		if m.Type != "action" {
			continue
		}
		select {
		case rm.actions <- playerAction{playerID: playerID, targetID: m.TargetID}:
		case <-rm.disconnect:
			return
		}
	}
}

func resolveSquad(p *player.Player, unitIDs []string) ([]units.Instance, error) {
	if len(unitIDs) == 0 {
		return nil, fmt.Errorf("battle: нужно выбрать хотя бы одного юнита для боя")
	}
	byID := make(map[string]units.Instance, len(p.Units))
	for _, u := range p.Units {
		byID[u.InstanceID] = u
	}
	squad := make([]units.Instance, 0, len(unitIDs))
	for _, id := range unitIDs {
		u, ok := byID[id]
		if !ok {
			return nil, fmt.Errorf("battle: юнит %q не найден в коллекции игрока", id)
		}
		squad = append(squad, u)
	}
	return squad, nil
}
