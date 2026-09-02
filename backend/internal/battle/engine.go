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
	"time"

	"battleforge/backend/internal/units"
)

type Side int

const (
	SideA Side = iota
	SideB
)

// Fighter — юнит внутри конкретного боя: снимок статов + текущее HP.
//
// DefID нужен клиенту, чтобы выбрать 3D-модель: Name локализован («Воин»,
// «Маг»), и опираться на него при выборе ассета — значит сломать арену при
// первом же переводе интерфейса.
type Fighter struct {
	InstanceID string      `json:"instanceId"`
	DefID      string      `json:"defId"`
	Name       string      `json:"name"`
	Side       Side        `json:"side"`
	Stats      units.Stats `json:"stats"`
	CurrentHP  int         `json:"currentHp"`
	Pos        Hex         `json:"pos"`
	// Moves — сколько очков хода юнит тратит за ход, Range — на сколько клеток бьёт.
	Moves int `json:"moves"`
	Range int `json:"range"`
}

func (f Fighter) Alive() bool { return f.CurrentHP > 0 }

// attackRange — дальность удара по типу юнита. Всё, что не перечислено, дерётся
// вплотную: рукопашник обязан подойти, стрелок и маг достают через полполя.
var attackRange = map[string]int{
	"archer": 4,
	"mage":   4,
	"healer": 3,
}

func rangeFor(defID string) int {
	if r, ok := attackRange[defID]; ok {
		return r
	}
	return 1
}

// movesFor выводит очки хода из скорости. Слагаемое 2 — чтобы даже самый
// медленный рыцарь мог сдвинуться с места, а не стоял мишенью для стрелков.
func movesFor(spd int) int {
	return 2 + spd/6
}

// NewFighter создаёт участника боя из юнита коллекции игрока.
func NewFighter(instance units.Instance, side Side) (Fighter, error) {
	def, err := instance.Definition()
	if err != nil {
		return Fighter{}, err
	}
	stats := def.StatsAtLevel(instance.Level)
	return Fighter{
		InstanceID: instance.InstanceID,
		DefID:      def.ID,
		Name:       def.Name,
		Side:       side,
		Stats:      stats,
		CurrentHP:  stats.HP,
		Moves:      movesFor(stats.SPD),
		Range:      rangeFor(def.ID),
	}, nil
}

// LogEntry — одно событие боя для показа игрокам.
type LogEntry struct {
	AttackerID string `json:"attackerId"`
	TargetID   string `json:"targetId"`
	Damage     int    `json:"damage"`
	TargetKO   bool   `json:"targetKo"`
	// MovedTo заполняется, когда юнит сместился: клиенту нужно знать, куда
	// переставить модель, даже если удара не было.
	MovedTo *Hex `json:"movedTo,omitempty"`
}

var (
	ErrEmptySquad    = errors.New("battle: отряд не может быть пустым")
	ErrUnitNotFound  = errors.New("battle: юнит не найден в бою")
	ErrNotUnitsTurn  = errors.New("battle: сейчас не ход этого юнита")
	ErrInvalidTarget = errors.New("battle: цель недоступна (не жива или на своей стороне)")
	ErrBattleOver    = errors.New("battle: бой уже завершён")
	ErrUnreachable   = errors.New("battle: до этой клетки не дойти за один ход")
	ErrOutOfRange    = errors.New("battle: цель слишком далеко")
)

// Battle — состояние одного боя: оба отряда, очередь ходов текущего раунда, лог.
type Battle struct {
	fighters map[string]*Fighter // instanceID -> fighter
	order    []string            // instanceID в порядке ходов текущего раунда
	turnIdx  int
	Map      *Map
	Log      []LogEntry
}

// Размер поля: достаточно широкое, чтобы между отрядами было что обходить, и
// достаточно узкое, чтобы бой не превращался в марш через пустую степь.
const (
	FieldWidth  = 11
	FieldHeight = 9
)

// New строит бой из двух отрядов. Возвращает ошибку, если отряд пуст или
// содержит юнита с неизвестным DefID.
func New(squadA, squadB []units.Instance) (*Battle, error) {
	if len(squadA) == 0 || len(squadB) == 0 {
		return nil, ErrEmptySquad
	}

	b := &Battle{
		fighters: make(map[string]*Fighter),
		// Ландшафт свой на каждый бой: одинаковое поле быстро выучивается наизусть.
		Map: NewMap(FieldWidth, FieldHeight, time.Now().UnixNano()),
	}
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
	b.placeSquads(squadA, squadB)

	b.startRound()
	return b, nil
}

// placeSquads расставляет отряды по краям поля: сторона A слева, B справа,
// оба столбиком по центру рядов.
func (b *Battle) placeSquads(squadA, squadB []units.Instance) {
	place := func(squad []units.Instance, col int) {
		// Отряд центрируется по вертикали, чтобы при разном размере отрядов
		// никто не оказался прижат к краю поля.
		top := (FieldHeight - len(squad)) / 2
		for i, inst := range squad {
			if f, ok := b.fighters[inst.InstanceID]; ok {
				f.Pos = Hex{Col: col, Row: top + i}
			}
		}
	}
	place(squadA, 0)
	place(squadB, FieldWidth-1)
}

// occupiedHexes — клетки, занятые живыми юнитами; ignore исключается (сам
// ходящий не мешает себе искать путь).
func (b *Battle) occupiedHexes(ignore string) map[Hex]bool {
	out := make(map[Hex]bool, len(b.fighters))
	for id, f := range b.fighters {
		if id == ignore || !f.Alive() {
			continue
		}
		out[f.Pos] = true
	}
	return out
}

// ReachableFor — куда юнит может дойти за этот ход и почём.
func (b *Battle) ReachableFor(actorID string) map[Hex]int {
	actor, ok := b.fighters[actorID]
	if !ok || !actor.Alive() {
		return nil
	}
	return b.Map.Reachable(actor.Pos, actor.Moves, b.occupiedHexes(actorID))
}

// SkipTurn передаёт ход дальше без действия. Нужен для юнита, которого заперли
// местностью и телами: он не дойдёт никуда и никого не достанет, а ждать от
// клиента действия, которого тот не может совершить, — это вечный бой.
func (b *Battle) SkipTurn(actorID string) error {
	current, ok := b.CurrentTurn()
	if !ok {
		return ErrBattleOver
	}
	if current != actorID {
		return ErrNotUnitsTurn
	}
	b.turnIdx++
	return nil
}

// AttackOption — цель и самая дешёвая клетка, с которой до неё достаёт.
type AttackOption struct {
	TargetID string `json:"targetId"`
	From     Hex    `json:"from"`
	Cost     int    `json:"cost"`
}

// AttackPlan — по одной записи на каждого врага, которого юнит может ударить в
// этот ход, с самой дешёвой позицией для удара.
//
// Считается на сервере, потому что клиент не знает ни дальности юнитов, ни
// стоимости местности: иначе он мог бы предлагать игроку заведомо невозможные
// удары, а отказ приходил бы только после клика.
func (b *Battle) AttackPlan(actorID string) []AttackOption {
	actor, ok := b.fighters[actorID]
	if !ok || !actor.Alive() {
		return nil
	}
	// Текущая клетка входит в перебор с нулевой ценой — удар с места всегда
	// предпочтительнее прогулки.
	spots := map[Hex]int{actor.Pos: 0}
	for h, c := range b.ReachableFor(actorID) {
		spots[h] = c
	}

	best := map[string]AttackOption{}
	for _, targetID := range b.AliveTargets(actorID) {
		for hex, cost := range spots {
			if !b.InAttackRange(actorID, targetID, hex) {
				continue
			}
			cur, seen := best[targetID]
			if !seen || cost < cur.Cost {
				best[targetID] = AttackOption{TargetID: targetID, From: hex, Cost: cost}
			}
		}
	}

	out := make([]AttackOption, 0, len(best))
	for _, opt := range best {
		out = append(out, opt)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].TargetID < out[j].TargetID })
	return out
}

// InAttackRange проверяет, достаёт ли юнит до цели из клетки from.
func (b *Battle) InAttackRange(actorID, targetID string, from Hex) bool {
	actor, ok := b.fighters[actorID]
	if !ok {
		return false
	}
	target, ok := b.fighters[targetID]
	if !ok || !target.Alive() || target.Side == actor.Side {
		return false
	}
	return Distance(from, target.Pos) <= actor.Range
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
//
// Очередь строится один раз на раунд, а юнит может погибнуть до своего хода внутри
// того же раунда — такие пропускаются. Без этого Act() вернул бы ErrUnitNotFound,
// не сдвинув turnIdx, и бой завис бы на мёртвом юните навсегда.
func (b *Battle) CurrentTurn() (string, bool) {
	if b.Winner() != nil {
		return "", false
	}
	for {
		for b.turnIdx < len(b.order) && !b.fighters[b.order[b.turnIdx]].Alive() {
			b.turnIdx++
		}
		if b.turnIdx < len(b.order) {
			return b.order[b.turnIdx], true
		}
		// Раунд исчерпан — строим очередь заново уже только из живых.
		b.startRound()
		if len(b.order) == 0 {
			return "", false
		}
	}
}

// Act выполняет ход текущего юнита: перемещение в moveTo (если задано) и/или
// атаку по targetID. Как в «Героях», за один ход можно и подойти, и ударить;
// пустой targetID означает «только передвинуться».
func (b *Battle) Act(actorID string, moveTo *Hex, targetID string) (LogEntry, error) {
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

	// Перемещение проверяется до атаки: цель может быть недостижима из текущей
	// клетки, но достижима из той, куда юнит собирается встать.
	from := actor.Pos
	if moveTo != nil && *moveTo != actor.Pos {
		if _, ok := b.ReachableFor(actorID)[*moveTo]; !ok {
			return LogEntry{}, ErrUnreachable
		}
		from = *moveTo
	}

	if targetID == "" {
		if moveTo == nil || *moveTo == actor.Pos {
			return LogEntry{}, ErrInvalidTarget
		}
		actor.Pos = from
		entry := LogEntry{AttackerID: actorID, MovedTo: &from}
		b.Log = append(b.Log, entry)
		b.turnIdx++
		return entry, nil
	}

	target, ok := b.fighters[targetID]
	if !ok || !target.Alive() || target.Side == actor.Side {
		return LogEntry{}, ErrInvalidTarget
	}
	if Distance(from, target.Pos) > actor.Range {
		return LogEntry{}, ErrOutOfRange
	}
	actor.Pos = from

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
