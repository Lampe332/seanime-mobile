package gojautil

import (
	"fmt"

	"github.com/dop251/goja"
)

// ExpectStringArg ensures the argument exists and is strictly a string.
// It panics with a TypeError if validation fails.
// Example:
//
//	func do(call goja.FunctionCall) goja.Value {
//		url := gojautil.ExpectStringArg(vm, call, 0)
func ExpectStringArg(vm *goja.Runtime, call goja.FunctionCall, index int) string {
	arg := call.Argument(index)

	if goja.IsUndefined(arg) {
		panic(vm.NewTypeError(fmt.Sprintf("Argument %d is missing", index)))
	}

	// Export returns the underlying Go value
	if _, ok := arg.Export().(string); !ok {
		panic(vm.NewTypeError(fmt.Sprintf("Argument %d must be a string", index)))
	}

	return arg.String()
}

// ExpectIntArg ensures the argument exists and is strictly a number (int64 compatible).
func ExpectIntArg(vm *goja.Runtime, call goja.FunctionCall, index int) int64 {
	arg := call.Argument(index)

	if goja.IsUndefined(arg) {
		panic(vm.NewTypeError(fmt.Sprintf("Argument %d is missing", index)))
	}

	// Goja stores numbers as int64 or float64
	val := arg.ToInteger()
	// We check if it was actually a number type originally
	if _, ok := arg.Export().(int64); !ok {
		if _, ok := arg.Export().(float64); !ok {
			panic(vm.NewTypeError(fmt.Sprintf("Argument %d must be a number", index)))
		}
	}

	return val
}

// ExpectFunctionArg ensures the argument is a callable function.
// It returns the goja.Callable which you can invoke directly in Go.
func ExpectFunctionArg(vm *goja.Runtime, call goja.FunctionCall, index int) goja.Callable {
	arg := call.Argument(index)

	if goja.IsUndefined(arg) {
		panic(vm.NewTypeError(fmt.Sprintf("Argument %d is missing", index)))
	}

	fn, ok := goja.AssertFunction(arg)
	if !ok {
		panic(vm.NewTypeError(fmt.Sprintf("Argument %d must be a function", index)))
	}

	return fn
}
