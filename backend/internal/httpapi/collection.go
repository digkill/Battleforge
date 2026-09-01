package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"battleforge/backend/internal/player"
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
