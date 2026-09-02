package battle

import (
	"sync"

	"battleforge/backend/internal/units"
)

// Waiting — игрок, ожидающий соперника в очереди матчмейкинга.
type Waiting struct {
	PlayerID string
	Squad    []units.Instance
	Matched  chan *Match
}

// Match — пара сматченных игроков и общий Battle между ними.
type Match struct {
	Battle  *Battle
	PlayerA string
	PlayerB string
}

// Matchmaker — простая FIFO-очередь: первый ожидающий игрок сматчивается со
// следующим вошедшим. Подходит для прототипа с низким трафиком одной комнаты;
// для продакшна нужны рейтинг/регион/анти-повтор соперника.
type Matchmaker struct {
	mu      sync.Mutex
	waiting *Waiting
}

func NewMatchmaker() *Matchmaker {
	return &Matchmaker{}
}

// Enqueue ищет партнёра для playerID. Если кто-то уже ждёт — тут же формирует
// матч и уведомляет обоих через каналы Matched. Иначе становится в очередь сам.
func (m *Matchmaker) Enqueue(playerID string, squad []units.Instance) *Waiting {
	self := &Waiting{PlayerID: playerID, Squad: squad, Matched: make(chan *Match, 1)}

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.waiting == nil || m.waiting.PlayerID == playerID {
		m.waiting = self
		return self
	}

	opponent := m.waiting
	m.waiting = nil

	b, err := New(opponent.Squad, squad)
	if err != nil {
		// Некорректный отряд — возвращаем обоих игроков в исходное состояние без матча.
		m.waiting = opponent
		return self
	}

	match := &Match{Battle: b, PlayerA: opponent.PlayerID, PlayerB: playerID}
	opponent.Matched <- match
	self.Matched <- match
	return self
}

// MatchBot снимает игрока с очереди и ставит против виртуального соперника.
//
// Возвращает nil, если игрока в очереди уже нет: пока шло ожидание, его мог
// забрать живой соперник — подсунуть боту уже занятого игрока нельзя.
func (m *Matchmaker) MatchBot(playerID string) *Match {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.waiting == nil || m.waiting.PlayerID != playerID {
		return nil
	}
	self := m.waiting
	m.waiting = nil

	b, err := New(self.Squad, NewBotSquad(self.Squad))
	if err != nil {
		return nil
	}
	match := &Match{Battle: b, PlayerA: playerID, PlayerB: BotPlayerID}
	self.Matched <- match
	return match
}

// Cancel убирает игрока из очереди ожидания, если он там ещё стоит.
func (m *Matchmaker) Cancel(playerID string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.waiting != nil && m.waiting.PlayerID == playerID {
		m.waiting = nil
	}
}
