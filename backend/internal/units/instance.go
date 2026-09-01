package units

import "fmt"

// Instance — конкретный юнит, принадлежащий игроку: тип из каталога + уровень.
type Instance struct {
	InstanceID string `json:"instanceId"`
	DefID      string `json:"defId"`
	Level      int    `json:"level"`
}

// Definition возвращает статическое описание типа этого юнита.
func (i Instance) Definition() (Definition, error) {
	def, ok := Catalog[i.DefID]
	if !ok {
		return Definition{}, fmt.Errorf("units: неизвестный тип юнита %q", i.DefID)
	}
	return def, nil
}

// Stats — текущие характеристики юнита с учётом уровня.
func (i Instance) Stats() Stats {
	def, err := i.Definition()
	if err != nil {
		return Stats{}
	}
	return def.StatsAtLevel(i.Level)
}

// CanUpgrade сообщает, не достиг ли юнит максимального уровня.
func (i Instance) CanUpgrade() bool {
	return i.Level < MaxLevel
}
