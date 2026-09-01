// Package pikabu проверяет подписанные данные, которые отдаёт Pikabu Games SDK
// (sdk.player.getSignedData(), purchase.getSignedData()).
//
// Формат — JWT header.payload.signature, подписанный HS256 секретным ключом
// игры из Студии. Секретный ключ никогда не должен попадать в клиентский код —
// проверка подписи выполняется только здесь, на бэкенде.
package pikabu

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

var (
	ErrMalformedToken   = errors.New("pikabu: некорректный формат подписанных данных")
	ErrInvalidSignature = errors.New("pikabu: подпись не прошла проверку")
)

type jwtHeader struct {
	Typ string `json:"typ"`
	Alg string `json:"alg"`
}

// Verifier проверяет подписанные данные секретным ключом конкретной игры,
// выданным в Студии Pikabu.
type Verifier struct {
	secret []byte
}

func NewVerifier(secret string) *Verifier {
	return &Verifier{secret: []byte(secret)}
}

// Verify проверяет подпись токена и возвращает сырой JSON payload.
// Валидная подпись подтверждает подлинность данных, но не гарантирует, что
// покупка ещё не была начислена — дедупликацию по purchaseId должен делать вызывающий код.
func (v *Verifier) Verify(token string) (json.RawMessage, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, ErrMalformedToken
	}
	headerPart, payloadPart, signaturePart := parts[0], parts[1], parts[2]

	headerBytes, err := base64.RawURLEncoding.DecodeString(headerPart)
	if err != nil {
		return nil, fmt.Errorf("%w: заголовок не base64url: %v", ErrMalformedToken, err)
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return nil, fmt.Errorf("%w: заголовок не JSON: %v", ErrMalformedToken, err)
	}
	if header.Alg != "HS256" {
		return nil, fmt.Errorf("%w: неподдерживаемый алгоритм %q", ErrMalformedToken, header.Alg)
	}

	expectedSig := v.sign(headerPart + "." + payloadPart)
	actualSig, err := base64.RawURLEncoding.DecodeString(signaturePart)
	if err != nil {
		return nil, fmt.Errorf("%w: подпись не base64url: %v", ErrMalformedToken, err)
	}
	if !hmac.Equal(expectedSig, actualSig) {
		return nil, ErrInvalidSignature
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(payloadPart)
	if err != nil {
		return nil, fmt.Errorf("%w: payload не base64url: %v", ErrMalformedToken, err)
	}
	return json.RawMessage(payloadBytes), nil
}

func (v *Verifier) sign(signingInput string) []byte {
	mac := hmac.New(sha256.New, v.secret)
	mac.Write([]byte(signingInput))
	return mac.Sum(nil)
}
