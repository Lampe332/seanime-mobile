package extension_repo

import (
	"context"
	"testing"

	"github.com/dop251/goja"
	"github.com/stretchr/testify/require"
)

func TestProviderPromisePreservesErrorMessage(t *testing.T) {
	vm := goja.New()
	value, err := vm.RunString(`Promise.reject(new Error("Failed to fetch episodes: No episodes found"))`)
	require.NoError(t, err)
	provider := &gojaProviderBase{}
	_, err = provider.awaitAndExportValue(context.Background(), value)
	require.ErrorContains(t, err, "Failed to fetch episodes: No episodes found")
}

func TestProviderPromisePreservesStringRejection(t *testing.T) {
	vm := goja.New()
	value, err := vm.RunString(`Promise.reject("Provider unavailable")`)
	require.NoError(t, err)
	provider := &gojaProviderBase{}
	_, err = provider.awaitAndExportValue(context.Background(), value)
	require.ErrorContains(t, err, "Provider unavailable")
}
