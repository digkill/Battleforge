package pikabu

// PlayerPayload — payload из sdk.player.getSignedData().
type PlayerPayload struct {
	Avatar       string `json:"avatar"`
	ID           string `json:"id"`
	IsAuthorized bool   `json:"isAuthorized"`
	Name         string `json:"name"`
}

// PurchasePayload — payload из purchase.getSignedData().
type PurchasePayload struct {
	DeveloperPayload string `json:"developerPayload,omitempty"`
	ProductID        string `json:"productId"`
	PurchaseID       string `json:"purchaseId"`
}
