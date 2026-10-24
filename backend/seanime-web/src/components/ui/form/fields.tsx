import { mergeRefs } from "@/components/ui/core/utils"
import React, { forwardRef, useMemo } from "react"
import { Controller, FormState, get, useFormContext } from "react-hook-form"
import { BasicFieldOptions } from "../basic-field"
import { DatePicker, DatePickerProps } from "../date-picker"
import { NumberInput, NumberInputProps } from "../number-input"
import { Select, SelectProps } from "../select"
import { Switch, SwitchProps } from "../switch"
import { TextInput, TextInputProps } from "../text-input"
import { Textarea, TextareaProps } from "../textarea"
import { createPolymorphicComponent } from "./polymorphic-component"
import { SubmitField } from "./submit-field"

/**
 * Add the BasicField types to any Field
 */
export type FieldBaseProps = Omit<BasicFieldOptions, "name"> & {
    name: string
    onChange?: any
    onBlur?: any
    required?: boolean
}

export type FieldComponent<T> = T & FieldBaseProps

export type FieldProps = React.ComponentPropsWithRef<"div">

/**
 * @description This wrapper makes it easier to work with custom form components by controlling their state.
 * @example
 * // Props order
 * <Controller>
 *    <InputComponent
 *       defaultValue={}   // Can be overridden
 *       onChange={}       // Can be overridden
 *       onBlur={}         // Can be overridden
 *       {...props}        // <FieldComponent {...} /> -> <Field.Component {...} />
 *       error={}          // Cannot be overridden
 *    />
 * </Controller>
 * @param InputComponent
 */
function withControlledInput<T extends FieldBaseProps>(InputComponent: React.FC<T>) {
    return forwardRef<FieldProps, T>(
        (inputProps, ref) => {
            const { control, formState } = useFormContext()

            return (
                <Controller
                    name={inputProps.name}
                    control={control}
                    rules={{ required: inputProps.required }}
                    render={({ field: { ref: _ref, ...field } }) => (
                        /**
                         * We pass "value, onChange, onBlur, error, required" to all components that will be defined using the wrapper.
                         * For other components like "Switch" and "Checkbox" which do not use the "value" prop, you need to deconstruct it to avoid it
                         * being passed.
                         */
                        <InputComponent
                            value={field.value} // Default prop, can be overridden in Field component definition
                            onChange={callAllHandlers(inputProps.onChange, field.onChange)} // Default prop, can be overridden in Field component
                            onBlur={callAllHandlers(inputProps.onBlur, field.onBlur)} // Default prop, can be overridden in Field component
                            {...inputProps as any} // Props passed in <FieldComponent /> then props passed in <Field.Component />
                            // The props below will not be overridden.
                            // e.g: <Field.ComponentField error="Error" /> will not work
                            error={getFormError(field.name, formState)?.message}
                            ref={useMergeRefs(ref, _ref)}
                        />
                    )}
                />
            )
        },
    )
}

const TextInputField = React.memo(withControlledInput(forwardRef<HTMLInputElement, FieldComponent<TextInputProps>>(
    (props, ref) => {
        return <TextInput
            {...props}
            value={props.value ?? ""}
            ref={ref}
        />
    },
)))

const TextareaField = React.memo(withControlledInput(forwardRef<HTMLTextAreaElement, FieldComponent<TextareaProps>>(
    (props, ref) => {
        return <Textarea
            {...props}
            value={props.value ?? ""}
            ref={ref}
        />
    },
)))

const DatePickerField = React.memo(withControlledInput(forwardRef<HTMLButtonElement, FieldComponent<DatePickerProps>>((
    { onChange, ...props }, ref) => {

    return <DatePicker
        {...props}
        onValueChange={onChange}
        ref={ref}
    />
})))

const SelectField = React.memo(withControlledInput(forwardRef<HTMLButtonElement, FieldComponent<SelectProps>>(
    ({ onChange, ...props }, ref) => {
        return <Select
            {...props}
            onValueChange={onChange}
            ref={ref}
        />
    },
)))

const NumberField = React.memo(withControlledInput(forwardRef<HTMLInputElement, FieldComponent<NumberInputProps>>(
    ({ onChange, ...props }, ref) => {
        return <NumberInput
            {...props}
            onValueChange={(value, valueAsString) => onChange(valueAsString === "" ? undefined : value)}
            ref={ref}
        />
    },
)))

const SwitchField = React.memo(withControlledInput(forwardRef<HTMLButtonElement, FieldComponent<SwitchProps>>(
    ({ onChange, ...props }, ref) => {
        return <Switch
            {...props}
            onValueChange={onChange}
            ref={ref}
        />
    },
)))

export const Field = createPolymorphicComponent<"div", FieldProps, {
    Text: typeof TextInputField,
    Textarea: typeof TextareaField,
    Select: typeof SelectField,
    Switch: typeof SwitchField,
    Number: typeof NumberField,
    DatePicker: typeof DatePickerField
    Submit: typeof SubmitField
}>({
    Text: TextInputField,
    Textarea: TextareaField,
    Select: SelectField,
    Switch: SwitchField,
    Number: NumberField,
    DatePicker: DatePickerField,
    Submit: SubmitField,
})

Field.displayName = "Field"

/* -------------------------------------------------------------------------------------------------
 * Utils
 * -----------------------------------------------------------------------------------------------*/

const getFormError = (name: string, formState: FormState<{ [x: string]: any }>) => {
    return get(formState.errors, name)
}

type ReactRef<T> = React.RefCallback<T> | React.MutableRefObject<T>

function useMergeRefs<T>(...refs: (ReactRef<T> | null | undefined)[]) {
    return useMemo(() => mergeRefs(refs), refs)
}

type Args<T extends Function> = T extends (...args: infer R) => any ? R : never

function callAllHandlers<T extends (event: any) => void>(
    ...fns: (T | undefined)[]
) {
    return function func(event: Args<T>[0]) {
        fns.some((fn) => {
            fn?.(event)
            return event?.defaultPrevented
        })
    }
}
