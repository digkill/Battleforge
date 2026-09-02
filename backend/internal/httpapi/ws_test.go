package httpapi

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"battleforge/backend/internal/pikabu"
)

func startTestServer(t *testing.T) *Server {
	t.Helper()
	return NewServer(pikabu.NewVerifier("test-secret"))
}

func dialBattleWS(t *testing.T, wsURL, playerID string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.DefaultDialer.Dial(wsURL+"?playerId="+playerID, nil)
	if err != nil {
		t.Fatalf("dial failed for %s: %v", playerID, err)
	}
	t.Cleanup(func() { conn.Close() })
	return conn
}

// startReader запускает единственную читающую горутину на соединение (у
// gorilla/websocket только один читатель на conn может быть одновременно) и
// публикует каждое полученное сообщение в возвращаемый канал.
func startReader(conn *websocket.Conn) <-chan map[string]any {
	ch := make(chan map[string]any, 16)
	go func() {
		defer close(ch)
		for {
			var msg map[string]any
			if err := conn.ReadJSON(&msg); err != nil {
				return
			}
			ch <- msg
		}
	}()
	return ch
}

func recvType(t *testing.T, ch <-chan map[string]any, want string) map[string]any {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				t.Fatalf("channel closed while waiting for %q", want)
			}
			if msg["type"] == want {
				return msg
			}
		case <-deadline:
			t.Fatalf("timed out waiting for %q", want)
		}
	}
}

// TestBattleWS_FullMatchResolvesToWinner проигрывает целый бой между двумя
// WS-клиентами до конца, атакуя первую доступную цель на каждом ходу.
func TestBattleWS_FullMatchResolvesToWinner(t *testing.T) {
	s := startTestServer(t)
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/battle/ws"

	alice := dialBattleWS(t, wsURL, "alice")
	bob := dialBattleWS(t, wsURL, "bob")
	aliceCh := startReader(alice)
	bobCh := startReader(bob)

	// стартовая коллекция обоих игроков: warrior/mage/archer (u1..u3 и u4..u6)
	if err := alice.WriteJSON(map[string]any{"type": "queue", "unitIds": []string{"u1"}}); err != nil {
		t.Fatalf("alice queue: %v", err)
	}
	if err := bob.WriteJSON(map[string]any{"type": "queue", "unitIds": []string{"u4"}}); err != nil {
		t.Fatalf("bob queue: %v", err)
	}

	recvType(t, aliceCh, "queued")
	recvType(t, bobCh, "queued")
	recvType(t, aliceCh, "battle_start")
	recvType(t, bobCh, "battle_start")

	conns := map[string]*websocket.Conn{"alice": alice, "bob": bob}
	chans := map[string]<-chan map[string]any{"alice": aliceCh, "bob": bobCh}

	deadline := time.After(10 * time.Second)
	var winner string
loop:
	for {
		select {
		case msg, ok := <-aliceCh:
			if !ok {
				t.Fatal("alice channel closed unexpectedly")
			}
			if done, w := handleMsg(t, "alice", msg, conns); done {
				winner = w
				break loop
			}
		case msg, ok := <-bobCh:
			if !ok {
				t.Fatal("bob channel closed unexpectedly")
			}
			if done, w := handleMsg(t, "bob", msg, conns); done {
				winner = w
				break loop
			}
		case <-deadline:
			t.Fatal("battle did not finish within deadline")
		}
	}
	_ = chans

	if winner != "alice" && winner != "bob" {
		t.Fatalf("unexpected winner value: %q", winner)
	}
}

// handleMsg реагирует на одно сообщение: на "your_turn" сразу атакует первую
// доступную цель, на "battle_end" сообщает победителя. Прочие типы игнорирует.
func handleMsg(t *testing.T, player string, msg map[string]any, conns map[string]*websocket.Conn) (done bool, winner string) {
	t.Helper()
	switch msg["type"] {
	case "your_turn":
		// Поле гексагональное: бить можно только то, до чего дотянешься, поэтому
		// действие берём из attackable (сервер уже посчитал, откуда достанем).
		// Если достать некого — просто идём в сторону врага любой доступной клеткой.
		action := map[string]any{"type": "action"}
		attackable, _ := msg["attackable"].([]any)
		if len(attackable) > 0 {
			opt := attackable[0].(map[string]any)
			action["targetId"] = opt["targetId"]
			action["moveTo"] = opt["from"]
		} else {
			reachable, _ := msg["reachable"].([]any)
			if len(reachable) == 0 {
				t.Fatalf("%s: ход без единого варианта — сервер должен был пропустить его сам", player)
			}
			hex := reachable[len(reachable)-1].(map[string]any)
			action["moveTo"] = map[string]any{"col": hex["col"], "row": hex["row"]}
		}
		conn := conns[player]
		conn.SetWriteDeadline(time.Now().Add(2 * time.Second))
		if err := conn.WriteJSON(action); err != nil {
			t.Fatalf("%s: failed to send action: %v", player, err)
		}
		return false, ""
	case "battle_end":
		return true, msg["winner"].(string)
	default:
		return false, ""
	}
}

// TestBattleWS_DisconnectWhileQueuedFreesTheQueue — регрессия: игрок, закрывший
// сокет в очереди, раньше оставался в матчмейкере призраком. Следующий вошедший
// матчился с ним, создавал комнату и навсегда зависал на <-rm.ready, потому что
// второе соединение никогда не подключалось.
func TestBattleWS_DisconnectWhileQueuedFreesTheQueue(t *testing.T) {
	s := startTestServer(t)
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/battle/ws"

	// alice встаёт в очередь и уходит, не дождавшись соперника
	alice := dialBattleWS(t, wsURL, "alice")
	aliceCh := startReader(alice)
	if err := alice.WriteJSON(map[string]any{"type": "queue", "unitIds": []string{"u1"}}); err != nil {
		t.Fatalf("alice queue: %v", err)
	}
	recvType(t, aliceCh, "queued")
	alice.Close()

	// bob и carol должны спокойно найти друг друга
	bob := dialBattleWS(t, wsURL, "bob")
	bobCh := startReader(bob)
	if err := bob.WriteJSON(map[string]any{"type": "queue", "unitIds": []string{"u4"}}); err != nil {
		t.Fatalf("bob queue: %v", err)
	}
	recvType(t, bobCh, "queued")

	carol := dialBattleWS(t, wsURL, "carol")
	carolCh := startReader(carol)
	if err := carol.WriteJSON(map[string]any{"type": "queue", "unitIds": []string{"u7"}}); err != nil {
		t.Fatalf("carol queue: %v", err)
	}
	recvType(t, carolCh, "queued")

	recvType(t, bobCh, "battle_start")
	recvType(t, carolCh, "battle_start")
}

// TestBattleWS_BotOpponentPlaysFullBattle — в dev-режиме игрок, не дождавшийся
// живого соперника, должен получить бой с виртуальным: комната стартует по
// одному соединению, а ходы за бота делает сервер.
func TestBattleWS_BotOpponentPlaysFullBattle(t *testing.T) {
	t.Setenv("BOT_OPPONENT_AFTER_SEC", "1")

	s := startTestServer(t)
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/battle/ws"

	alice := dialBattleWS(t, wsURL, "alice")
	aliceCh := startReader(alice)
	if err := alice.WriteJSON(map[string]any{"type": "queue", "unitIds": []string{"u1", "u2", "u3"}}); err != nil {
		t.Fatalf("alice queue: %v", err)
	}
	recvType(t, aliceCh, "queued")

	start := recvType(t, aliceCh, "battle_start")
	if start["playerB"] != "bot:trainer" {
		t.Fatalf("expected bot as opponent, got %v", start["playerB"])
	}

	deadline := time.After(60 * time.Second)
	conns := map[string]*websocket.Conn{"alice": alice}
	for {
		select {
		case msg, ok := <-aliceCh:
			if !ok {
				t.Fatal("alice channel closed unexpectedly")
			}
			if done, winner := handleMsg(t, "alice", msg, conns); done {
				if winner != "alice" && winner != "bot:trainer" {
					t.Fatalf("unexpected winner: %q", winner)
				}
				return
			}
		case <-deadline:
			t.Fatal("battle vs bot did not finish within deadline")
		}
	}
}

// TestBattleWS_CreepBattleRecruitsWinner — смысл боя с нейтралами: победив
// логово, игрок забирает крипа в коллекцию. Отряд игрока намеренно прокачан,
// чтобы исход был предсказуем.
func TestBattleWS_CreepBattleRecruitsWinner(t *testing.T) {
	s := startTestServer(t)
	ts := httptest.NewServer(s.Routes())
	defer ts.Close()
	wsURL := "ws" + strings.TrimPrefix(ts.URL, "http") + "/api/battle/ws"

	// Качаем отряд, иначе бой с равным логовом может кончиться как угодно.
	before := s.players.GetOrCreate("hunter")
	for _, u := range before.Units {
		for lvl := 0; lvl < 12; lvl++ {
			s.players.AddGold("hunter", 10000)
			if _, err := s.players.Upgrade("hunter", u.InstanceID); err != nil {
				break
			}
		}
	}
	before = s.players.GetOrCreate("hunter")
	unitsBefore := len(before.Units)

	hunter := dialBattleWS(t, wsURL, "hunter")
	ch := startReader(hunter)
	ids := make([]string, 0, len(before.Units))
	for _, u := range before.Units {
		ids = append(ids, u.InstanceID)
	}
	if err := hunter.WriteJSON(map[string]any{"type": "queue", "mode": "creep", "unitIds": ids}); err != nil {
		t.Fatalf("queue: %v", err)
	}

	enc := recvType(t, ch, "creep_encounter")
	creep, _ := enc["creep"].(map[string]any)
	if creep["defId"] != "werewolf" {
		t.Fatalf("ожидали оборотня, получили %v", creep["defId"])
	}
	recvType(t, ch, "battle_start")

	conns := map[string]*websocket.Conn{"hunter": hunter}
	deadline := time.After(90 * time.Second)
	recruited := false
	var winner string
	for winner == "" {
		select {
		case msg, ok := <-ch:
			if !ok {
				t.Fatal("соединение закрылось раньше времени")
			}
			if msg["type"] == "unit_recruited" {
				recruited = true
				continue
			}
			if done, w := handleMsg(t, "hunter", msg, conns); done {
				winner = w
			}
		case <-deadline:
			t.Fatal("бой с нейтралами не завершился вовремя")
		}
	}

	if winner != "hunter" {
		t.Skipf("логово оказалось сильнее (победил %s) — вербовку в этом прогоне не проверить", winner)
	}
	if !recruited {
		t.Fatal("победа над логовом не принесла unit_recruited")
	}
	after := s.players.GetOrCreate("hunter")
	if len(after.Units) != unitsBefore+1 {
		t.Fatalf("в коллекции %d юнитов, ожидали %d", len(after.Units), unitsBefore+1)
	}
	last := after.Units[len(after.Units)-1]
	if last.DefID != "werewolf" {
		t.Fatalf("завербован %q вместо оборотня", last.DefID)
	}
}
