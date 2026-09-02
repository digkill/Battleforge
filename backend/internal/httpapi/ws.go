package httpapi

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

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
	if rm.attached == rm.needAttached() {
		delete(s.rooms, b)
		close(rm.ready)
		return true
	}
	return false
}

// needAttached — сколько соединений ждать до старта боя. У виртуального
// соперника соединения нет, поэтому бой с ботом стартует по первому же.
func (rm *room) needAttached() int {
	n := 2
	if battle.IsBot(rm.playerA) {
		n--
	}
	if battle.IsBot(rm.playerB) {
		n--
	}
	return n
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
	// У виртуального соперника соединения нет — его «сторона» просто молчит.
	if conn == nil {
		return
	}
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

		// За бота ходит сервер: ждать действия по сокету, которого нет, значило бы
		// повесить бой навсегда.
		if battle.IsBot(owner) {
			targetID, ok := rm.b.BotChooseTarget(actorID)
			if !ok {
				break
			}
			time.Sleep(botThinkTime)
			entry, err := rm.b.Act(actorID, targetID)
			if err != nil {
				log.Printf("battle ws: bot move failed: %v", err)
				break
			}
			rm.broadcast(map[string]any{
				"type":  "battle_update",
				"log":   entry,
				"units": rm.b.Snapshot(),
			})
			continue
		}

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

// botThinkTime — пауза перед ходом бота. Без неё бой против виртуального
// соперника пролетает мгновенно и выглядит как один рывок полосок HP.
const botThinkTime = 900 * time.Millisecond

// botQueueTimeout: сколько ждать живого соперника, прежде чем подставить бота.
// Ноль (значение по умолчанию) выключает ботов совсем — иначе на проде игроки
// фармили бы золото о заведомо предсказуемого противника.
func botQueueTimeout() time.Duration {
	sec, err := strconv.Atoi(os.Getenv("BOT_OPPONENT_AFTER_SEC"))
	if err != nil || sec <= 0 {
		return 0
	}
	return time.Duration(sec) * time.Second
}

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

	// С этого момента и до конца соединения читает сокет только readPump —
	// два конкурирующих ReadJSON (ожидание в очереди и бой) недопустимы.
	done := make(chan struct{})
	defer close(done)
	msgs, closed := readPump(conn, done)

	// Ждать бота бесконечно нельзя: при выключенной опции таймер просто не
	// заводится, и поведение остаётся прежним — ждём живого соперника.
	var botTimer <-chan time.Time
	if d := botQueueTimeout(); d > 0 {
		t := time.NewTimer(d)
		defer t.Stop()
		botTimer = t.C
	}

	var match *battle.Match
	select {
	case <-botTimer:
		// Живой соперник мог забрать нас ровно в этот момент — тогда MatchBot
		// вернёт nil, и матч придёт по своему каналу как обычно.
		if match = s.matchmaker.MatchBot(playerID); match == nil {
			select {
			case match = <-waiting.Matched:
			case <-closed:
				s.matchmaker.Cancel(playerID)
				return
			}
		} else {
			<-waiting.Matched // MatchBot кладёт матч в канал, вычитываем свою же запись
		}

	case match = <-waiting.Matched:
	case <-closed:
		// Игрок закрыл вкладку или нажал «Отменить», не дождавшись соперника.
		// Без снятия с очереди протухший Waiting остался бы в матчмейкере, и
		// следующий вошедший сматчился бы с призраком, навсегда зависнув на ready.
		s.matchmaker.Cancel(playerID)
		// Матч мог сформироваться ровно между разрывом и Cancel — тогда соперник
		// уже получил Match и ждёт нас в комнате, бросать его нельзя.
		select {
		case match = <-waiting.Matched:
		default:
			return
		}
	}

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
			// За бота золото начислять некому: AddGold завёл бы фантомного игрока.
			if battle.IsBot(winner) {
				return
			}
			s.players.AddGold(winner, battleWinReward)
		})
	} else {
		<-rm.ready
	}

	// Пересылаем действия игрока в комнату до разрыва соединения.
	for {
		select {
		case <-closed:
			rm.reportDisconnect(playerID)
			return

		case m := <-msgs:
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
}

// readPump — единственный читатель соединения: складывает сообщения клиента в
// msgs и закрывает closed при первой ошибке чтения (в том числе при разрыве).
// Завершается по done, чтобы не зависнуть на отправке в msgs, когда бой уже окончен.
func readPump(conn *websocket.Conn, done <-chan struct{}) (<-chan incoming, <-chan struct{}) {
	msgs := make(chan incoming)
	closed := make(chan struct{})
	go func() {
		defer close(closed)
		for {
			var m incoming
			if err := conn.ReadJSON(&m); err != nil {
				return
			}
			select {
			case msgs <- m:
			case <-done:
				return
			}
		}
	}()
	return msgs, closed
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
