// Package units описывает фэнтезийных юнитов: базовые характеристики,
// рост при повышении уровня и стоимость прокачки.
package units

// Stats — характеристики юнита на конкретном уровне.
type Stats struct {
	HP  int `json:"hp"`
	ATK int `json:"atk"`
	DEF int `json:"def"`
	SPD int `json:"spd"`
}

// Definition — статическое описание типа юнита из каталога.
type Definition struct {
	ID     string  `json:"id"`
	Name   string  `json:"name"`
	Base   Stats   `json:"baseStats"`
	Growth float64 `json:"-"` // доля прироста статов за уровень, напр. 0.08 = +8%
}

const MaxLevel = 20

// Catalog — фиксированный ростер фэнтезийных юнитов игры.
var Catalog = map[string]Definition{
	"warrior": {
		ID: "warrior", Name: "Воин",
		Base:   Stats{HP: 120, ATK: 18, DEF: 12, SPD: 8},
		Growth: 0.08,
	},
	"mage": {
		ID: "mage", Name: "Маг",
		Base:   Stats{HP: 70, ATK: 26, DEF: 4, SPD: 10},
		Growth: 0.08,
	},
	"archer": {
		ID: "archer", Name: "Лучник",
		Base:   Stats{HP: 85, ATK: 20, DEF: 6, SPD: 14},
		Growth: 0.08,
	},
	"healer": {
		ID: "healer", Name: "Целитель",
		Base:   Stats{HP: 90, ATK: 10, DEF: 8, SPD: 9},
		Growth: 0.08,
	},
	"knight": {
		ID: "knight", Name: "Рыцарь",
		Base:   Stats{HP: 150, ATK: 15, DEF: 18, SPD: 6},
		Growth: 0.08,
	},
	"assassin": {
		ID: "assassin", Name: "Убийца",
		Base:   Stats{HP: 75, ATK: 24, DEF: 5, SPD: 18},
		Growth: 0.08,
	},
}

// StatsAtLevel возвращает характеристики юнита на заданном уровне (1..MaxLevel).
// Рост линейный: base + base*growth*(level-1).
func (d Definition) StatsAtLevel(level int) Stats {
	if level < 1 {
		level = 1
	}
	if level > MaxLevel {
		level = MaxLevel
	}
	mult := 1 + d.Growth*float64(level-1)
	return Stats{
		HP:  int(float64(d.Base.HP) * mult),
		ATK: int(float64(d.Base.ATK) * mult),
		DEF: int(float64(d.Base.DEF) * mult),
		SPD: int(float64(d.Base.SPD) * mult),
	}
}

// UpgradeCost — стоимость золота для повышения юнита с level до level+1.
func UpgradeCost(level int) int {
	return 50 * level
}
