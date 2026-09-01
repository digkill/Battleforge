// Package battle реализует пошаговый бой между двумя отрядами юнитов.
//
// Раунд строится так: все живые юниты обеих сторон сортируются по убыванию
// SPD (скорость) — получившийся порядок и есть очередь ходов на раунд.
// Каждый юнит атакует одну цель на стороне противника; урон = max(1, ATK - DEF/2).
// Бой заканчивается, когда все юниты одной из сторон погибли.
package battle

import (
	"errors"
	"sort"

	"battleforge/backend/internal/units"
)

type Side int

const (
	SideA Side = iota
	SideB
)

// Fighter — юнит внутри конкретного боя: снимок статов + текущее HP.
type Fighter struct {
	InstanceID string      `json:"instanceId"`
	Name       string      `json:"name"`
	Side       Side        `json:"side"`
	Stats      units.Stats `json:"stats"`
	CurrentHP  int         `json:"currentHp"`
}

func (f Fighter) Alive() bool { return f.CurrentHP > 0 }

// NewFighter создаёт участника боя из юнита коллекции игрока.
func NewFighter(instance units.Instance, side Side) (Fighter, error) {
	def, err := instance.Definition()
	if err != nil {
		return Fighter{}, err
	}
	stats := def.StatsAtLevel(instance.Level)
	return Fighter{
		InstanceID: instance.InstanceID,
		Name:       def.Name,
		Side:       side,
		Stats:      stats,
		CurrentHP:  stats.HP,
	}, nil
}

// LogEntry — одно событие боя для показа игрокам.
type LogEntry struct {
	AttackerID string `json:"attackerId"`
	TargetID   string `json:"targetId"`
	Damage     int    `json:"damage"`
	TargetKO   bool   `json:"targetKo"`
}

var (
	ErrEmptySquad    = errors.New("battle: отряд не может быть пустым")
	ErrUnitNotFound  = errors.New("battle: юнит не найден в бою")
	ErrNotUnitsTurn  = errors.New("battle: сейчас не ход этого юнита")
	ErrInvalidTarget = errors.New("battle: цель недоступна (не жива или на своей стороне)")
	ErrBattleOver    = errors.New("battle: бой уже завершён")
)

// Battle — состояние одного боя: оба отряда, очередь ходов текущего раунда, лог.
type Battle struct {
	fighters map[string]*Fighter // instanceID -> fighter
	order    []string            // instanceID в порядке ходов текущего раунда
	turnIdx  int
	Log      []LogEntry
}

// New строит бой из двух отрядов. Возвращает ошибку, если отряд пуст или
// содержит юнита с неизвестным DefID.
func New(squadA, squadB []units.Instance) (*Battle, error) {
	if len(squadA) == 0 || len(squadB) == 0 {
		return nil, ErrEmptySquad
	}

	b := &Battle{fighters: make(map[string]*Fighter)}
	for _, inst := range squadA {
		f, err := NewFighter(inst, SideA)
		if err != nil {
			return nil, err
		}
		b.fighters[f.InstanceID] = &f
	}
	for _, inst := range squadB {
		f, err := NewFighter(inst, SideB)
		if err != nil {
			return nil, err
		}
		b.fighters[f.InstanceID] = &f
	}

	b.startRound()
	return b, nil
}

// startRound пересчитывает очередь ходов по SPD среди живых юнитов.
func (b *Battle) startRound() {
	b.order = b.order[:0]
	for id, f := range b.fighters {
		if f.Alive() {
			b.order = append(b.order, id)
		}
	}
	sort.Slice(b.order, func(i, j int) bool {
		si, sj := b.fighters[b.order[i]].Stats.SPD, b.fighters[b.order[j]].Stats.SPD
		if si != sj {
			return si > sj
		}
		return b.order[i] < b.order[j] // детерминированный тай-брейк
	})
	b.turnIdx = 0
}

// CurrentTurn возвращает instanceID юнита, чей сейчас ход, и false, если бой окончен.
func (b *Battle) CurrentTurn() (string, bool) {
	if b.Winner() != nil {
		return "", false
	}
	if b.turnIdx >= len(b.order) {
		b.startRound()
	}
	if len(b.order) == 0 {
		return "", false
	}
	return b.order[b.turnIdx], true
}

// Act выполняет ход текущего юнита: атаку по targetID. Возвращает запись лога.
func (b *Battle) Act(actorID, targetID string) (LogEntry, error) {
	if b.Winner() != nil {
		return LogEntry{}, ErrBattleOver
	}

	current, ok := b.CurrentTurn()
	if !ok {
		return LogEntry{}, ErrBattleOver
	}
	if current != actorID {
		return LogEntry{}, ErrNotUnitsTurn
	}

	actor, ok := b.fighters[actorID]
	if !ok || !actor.Alive() {
		return LogEntry{}, ErrUnitNotFound
	}
	target, ok := b.fighters[targetID]
	if !ok || !target.Alive() || target.Side == actor.Side {
		return LogEntry{}, ErrInvalidTarget
	}

	damage := actor.Stats.ATK - target.Stats.DEF/2
	if damage < 1 {
		damage = 1
	}
	target.CurrentHP -= damage
	if target.CurrentHP < 0 {
		target.CurrentHP = 0
	}

	entry := LogEntry{
		AttackerID: actorID,
		TargetID:   targetID,
		Damage:     damage,
		TargetKO:   !target.Alive(),
	}
	b.Log = append(b.Log, entry)

	b.turnIdx++
	return entry, nil
}

// AliveTargets возвращает instanceID живых юнитов противоположной стороны от actorID.
func (b *Battle) AliveTargets(actorID string) []string {
	actor, ok := b.fighters[actorID]
	if !ok {
		return nil
	}
	var targets []string
	for id, f := range b.fighters {
		if f.Side != actor.Side && f.Alive() {
			targets = append(targets, id)
		}
	}
	sort.Strings(targets)
	return targets
}

// Winner возвращает сторону-победителя, если одна из сторон полностью выбита, иначе nil.
func (b *Battle) Winner() *Side {
	aliveA, aliveB := false, false
	for _, f := range b.fighters {
		if !f.Alive() {
			continue
		}
		if f.Side == SideA {
			aliveA = true
		} else {
			aliveB = true
		}
	}
	switch {
	case !aliveA && !aliveB:
		draw := SideB // отряды не бывают пустыми на старте, до ничьей в реальности не дойдёт
		return &draw
	case !aliveA:
		b := SideB
		return &b
	case !aliveB:
		a := SideA
		return &a
	default:
		return nil
	}
}

// Fighter возвращает участника боя по instanceID.
func (b *Battle) Fighter(instanceID string) (Fighter, bool) {
	f, ok := b.fighters[instanceID]
	if !ok {
		return Fighter{}, false
	}
	return *f, true
}

// Snapshot возвращает копии всех участников боя (для сериализации в WS-сообщение).
func (b *Battle) Snapshot() []Fighter {
	out := make([]Fighter, 0, len(b.fighters))
	for _, f := range b.fighters {
		out = append(out, *f)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].InstanceID < out[j].InstanceID })
	return out
}
