package httpapi

import (
	"encoding/json"
	"net/http"
	"sync"

	"battleforge/backend/internal/battle"
	"battleforge/backend/internal/pikabu"
	"battleforge/backend/internal/player"
)

type Server struct {
	verifier   *pikabu.Verifier
	players    *player.Store
	matchmaker *battle.Matchmaker

	processedMu sync.Mutex
	processed   map[string]bool // purchaseId -> уже начислено

	roomsMu sync.Mutex
	rooms   map[*battle.Battle]*room
}

func NewServer(verifier *pikabu.Verifier) *Server {
	return &Server{
		verifier:   verifier,
		players:    player.NewStore(),
		matchmaker: battle.NewMatchmaker(),
		processed:  make(map[string]bool),
		rooms:      make(map[*battle.Battle]*room),
	}
}

func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/pikabu/player/verify", s.handleVerifyPlayer)
	mux.HandleFunc("POST /api/pikabu/purchases/confirm", s.handleConfirmPurchase)
	mux.HandleFunc("GET /api/collection", s.handleGetCollection)
	mux.HandleFunc("POST /api/collection/upgrade", s.handleUpgradeUnit)
	mux.HandleFunc("GET /api/battle/ws", s.handleBattleWS)
	mux.HandleFunc("GET /healthz", s.handleHealth)
	return withCORS(mux)
}

type verifyRequest struct {
	SignedData string `json:"signedData"`
}

func (s *Server) handleVerifyPlayer(w http.ResponseWriter, r *http.Request) {
	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	payloadRaw, err := s.verifier.Verify(req.SignedData)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_signature", err.Error())
		return
	}

	var player pikabu.PlayerPayload
	if err := json.Unmarshal(payloadRaw, &player); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_payload", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, player)
}

func (s *Server) handleConfirmPurchase(w http.ResponseWriter, r *http.Request) {
	var req verifyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", err.Error())
		return
	}

	payloadRaw, err := s.verifier.Verify(req.SignedData)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_signature", err.Error())
		return
	}

	var purchase pikabu.PurchasePayload
	if err := json.Unmarshal(payloadRaw, &purchase); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_payload", err.Error())
		return
	}

	// Валидная подпись подтверждает подлинность данных, но не гарантирует,
	// что покупка ещё не была начислена — дедуплицируем по purchaseId.
	// В проде processed должен быть таблицей в БД, а не картой в памяти.
	s.processedMu.Lock()
	alreadyProcessed := s.processed[purchase.PurchaseID]
	if !alreadyProcessed {
		s.processed[purchase.PurchaseID] = true
	}
	s.processedMu.Unlock()

	if alreadyProcessed {
		writeJSON(w, http.StatusOK, map[string]any{
			"status":     "already_processed",
			"purchaseId": purchase.PurchaseID,
		})
		return
	}

	// Здесь начисляется товар игроку (запись в БД игры).

	writeJSON(w, http.StatusOK, map[string]any{
		"status":     "confirmed",
		"purchaseId": purchase.PurchaseID,
		"productId":  purchase.ProductID,
	})
}

func (s *Server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]string{"error": code, "message": message})
}
