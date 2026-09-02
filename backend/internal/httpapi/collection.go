package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"sort"

	"battleforge/backend/internal/player"
	"battleforge/backend/internal/units"
)

// playerID достаёт идентификатора игрока из заголовка X-Player-Id.
//
// Это упрощение для прототипа: в проде идентификатор должен браться из
// серверной сессии, установленной после проверки sdk.player.getSignedData()
// через POST /api/pikabu/player/verify, а не приходить от клиента напрямую.
func playerID(r *http.Request) (string, bool) {
	id := r.Header.Get("X-Player-Id")
	return id, id != ""
}

func (s *Server) handleGetCollection(w http.ResponseWriter, r *http.Request) {
	id, ok := playerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing_player_id", "заголовок X-Player-Id обязателен")
		return
	}
	p := s.players.GetOrCreate(id)
	writeJSON(w, http.StatusOK, p)
}

// handleTavern отдаёт, кого можно нанять и почём. Цены считает бэкенд —
// клиенту нельзя доверять стоимость, иначе войско набирается бесплатно.
func (s *Server) handleTavern(w http.ResponseWriter, _ *http.Request) {
	type offer struct {
		DefID string      `json:"defId"`
		Name  string      `json:"name"`
		Cost  int         `json:"cost"`
		Stats units.Stats `json:"stats"`
	}
	offers := make([]offer, 0, len(units.Catalog))
	for id, def := range units.Catalog {
		if !units.Hireable(id) {
			continue
		}
		offers = append(offers, offer{
			DefID: id,
			Name:  def.Name,
			Cost:  def.HireCost(),
			Stats: def.StatsAtLevel(1),
		})
	}
	sort.Slice(offers, func(i, j int) bool { return offers[i].Cost < offers[j].Cost })
	writeJSON(w, http.StatusOK, map[string]any{"offers": offers})
}

type hireRequest struct {
	DefID string `json:"defId"`
}

func (s *Server) handleHireUnit(w http.ResponseWriter, r *http.Request) {
	id, ok := playerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing_player_id", "заголовок X-Player-Id обязателен")
		return
	}

	var req hireRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	p, inst, err := s.players.Hire(id, req.DefID)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, map[string]any{"player": p, "unit": inst})
	case errors.Is(err, player.ErrUnitNotFound):
		writeError(w, http.StatusNotFound, "not_found", "такого юнита нанять нельзя")
	case errors.Is(err, player.ErrNotEnoughGold):
		writeError(w, http.StatusPaymentRequired, "not_enough_gold", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
	}
}

type upgradeRequest struct {
	InstanceID string `json:"instanceId"`
}

func (s *Server) handleUpgradeUnit(w http.ResponseWriter, r *http.Request) {
	id, ok := playerID(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "missing_player_id", "заголовок X-Player-Id обязателен")
		return
	}

	var req upgradeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	p, err := s.players.Upgrade(id, req.InstanceID)
	switch {
	case err == nil:
		writeJSON(w, http.StatusOK, p)
	case errors.Is(err, player.ErrNotFound), errors.Is(err, player.ErrUnitNotFound):
		writeError(w, http.StatusNotFound, "not_found", err.Error())
	case errors.Is(err, player.ErrNotEnoughGold):
		writeError(w, http.StatusPaymentRequired, "not_enough_gold", err.Error())
	case errors.Is(err, player.ErrMaxLevel):
		writeError(w, http.StatusConflict, "max_level", err.Error())
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
	}
}
