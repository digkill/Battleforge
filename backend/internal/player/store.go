// Package player хранит игровое состояние игрока: золото и коллекцию юнитов.
//
// Хранилище в памяти процесса — годится для прототипа/тестовой ссылки Студии.
// Для продакшна нужно заменить на БД, сохраняя тот же интерфейс Store.
package player

import (
	"errors"
	"fmt"
	"sync"

	"battleforge/backend/internal/units"
)

var (
	ErrNotFound      = errors.New("player: игрок не найден")
	ErrUnitNotFound  = errors.New("player: юнит не найден")
	ErrNotEnoughGold = errors.New("player: недостаточно золота")
	ErrMaxLevel      = errors.New("player: юнит уже максимального уровня")
)

const startingGold = 500

var startingUnits = []string{"warrior", "mage", "archer"}

type Player struct {
	ID    string           `json:"id"`
	Gold  int              `json:"gold"`
	Units []units.Instance `json:"units"`
}

type Store struct {
	mu      sync.Mutex
	players map[string]*Player
	nextUID int
}

func NewStore() *Store {
	return &Store{players: make(map[string]*Player)}
}

// GetOrCreate возвращает игрока, создавая его со стартовым набором при первом обращении.
func (s *Store) GetOrCreate(playerID string) *Player {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.getOrCreateLocked(playerID).clone()
}

// getOrCreateLocked возвращает игрока из карты (не копию!), создавая его со
// стартовым набором при первом обращении. Вызывать только под s.mu.
func (s *Store) getOrCreateLocked(playerID string) *Player {
	if p, ok := s.players[playerID]; ok {
		return p
	}

	p := &Player{ID: playerID, Gold: startingGold}
	for _, defID := range startingUnits {
		s.nextUID++
		p.Units = append(p.Units, units.Instance{
			InstanceID: fmt.Sprintf("u%d", s.nextUID),
			DefID:      defID,
			Level:      1,
		})
	}
	s.players[playerID] = p
	return p
}

// Upgrade поднимает уровень юнита на 1, списывая золото по units.UpgradeCost.
func (s *Store) Upgrade(playerID, instanceID string) (*Player, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	p, ok := s.players[playerID]
	if !ok {
		return nil, ErrNotFound
	}

	idx := -1
	for i, u := range p.Units {
		if u.InstanceID == instanceID {
			idx = i
			break
		}
	}
	if idx == -1 {
		return nil, ErrUnitNotFound
	}

	unit := p.Units[idx]
	if !unit.CanUpgrade() {
		return nil, ErrMaxLevel
	}
	cost := units.UpgradeCost(unit.Level)
	if p.Gold < cost {
		return nil, ErrNotEnoughGold
	}

	p.Gold -= cost
	unit.Level++
	p.Units[idx] = unit

	return p.clone(), nil
}

// AddGold начисляет золото игроку (например, награду за победу в бою).
// Если игрок ещё не существует, он создаётся со стартовым набором.
func (s *Store) AddGold(playerID string, amount int) *Player {
	s.mu.Lock()
	defer s.mu.Unlock()

	p := s.getOrCreateLocked(playerID)
	p.Gold += amount
	return p.clone()
}

// Recruit добавляет игроку юнита указанного типа — например побеждённого крипа.
// Возвращает обновлённого игрока и добавленный юнит.
func (s *Store) Recruit(playerID, defID string, level int) (*Player, units.Instance, error) {
	if _, ok := units.Catalog[defID]; !ok {
		return nil, units.Instance{}, ErrUnitNotFound
	}
	if level < 1 {
		level = 1
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	p := s.getOrCreateLocked(playerID)
	// nextUID общий на весь стор: instanceID обязан быть уникальным не только
	// внутри коллекции, но и между игроками — иначе в бою два юнита схлопнутся.
	s.nextUID++
	inst := units.Instance{
		InstanceID: fmt.Sprintf("u%d", s.nextUID),
		DefID:      defID,
		Level:      level,
	}
	p.Units = append(p.Units, inst)
	return p.clone(), inst, nil
}

func (p *Player) clone() *Player {
	unitsCopy := make([]units.Instance, len(p.Units))
	copy(unitsCopy, p.Units)
	return &Player{ID: p.ID, Gold: p.Gold, Units: unitsCopy}
}
