import { cn } from "@/components/ui/core/styling"
import * as SliderPrimitive from "@rn-primitives/slider"
import React from "react"
import { type LayoutChangeEvent, View } from "react-native"
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler"

/*
 * A slider in the phone kit's colours: a 4dp track on --sm-line-strong, the filled part in the accent, a 20dp white
 * knob; 48dp of touch height. @rn-primitives' Slider gives the accessibility (screen-reader steps) but no touch handling
 * on native, so dragging and tapping on the track come from react-native-gesture-handler.
 */
export type SliderProps = {
    value: number
    onValueChange: (value: number) => void
    /** called once when the finger lets go */
    onValueCommit?: (value: number) => void
    min?: number
    max?: number
    step?: number
    disabled?: boolean
    accessibilityLabel?: string
    className?: string
}

const KNOB = 20

export function Slider({ value, onValueChange, onValueCommit, min = 0, max = 100, step = 1, disabled, accessibilityLabel, className }: SliderProps) {
    const [width, setWidth] = React.useState(0)
    // the last value sent, so a drag reports each step once; it follows the prop after every render (refs are not
    // written while rendering)
    const latest = React.useRef(value)
    React.useLayoutEffect(() => {
        latest.current = value
    }, [value])

    const toValue = (x: number) => {
        const usable = Math.max(1, width - KNOB)
        const ratio = Math.min(1, Math.max(0, (x - KNOB / 2) / usable))
        const raw = min + ratio * (max - min)
        const stepped = Math.round((raw - min) / step) * step + min
        return Math.min(max, Math.max(min, Number(stepped.toFixed(6))))
    }

    const update = (x: number) => {
        const next = toValue(x)
        if (next !== latest.current) {
            latest.current = next
            onValueChange(next)
        }
    }

    const pan = usePanGesture({
        enabled: !disabled,
        runOnJS: true,
        // a slider inside a vertical list: only a sideways drag takes it, a vertical one scrolls the list
        activeOffsetX: [-4, 4],
        failOffsetY: [-12, 12],
        onActivate: event => update(event.x),
        onUpdate: event => update(event.x),
        onFinalize: () => onValueCommit?.(latest.current),
    })
    const tap = useTapGesture({
        enabled: !disabled,
        runOnJS: true,
        onActivate: event => {
            update(event.x)
            onValueCommit?.(latest.current)
        },
    })

    // a drag wins over a tap that started it
    const gesture = useExclusiveGestures(pan, tap)

    const ratio = max > min ? (value - min) / (max - min) : 0
    const knobLeft = ratio * Math.max(0, width - KNOB)

    return (
        <GestureDetector gesture={gesture}>
                <SliderPrimitive.Root
                    value={value}
                    min={min}
                    max={max}
                    step={step}
                    disabled={disabled}
                    onValueChange={values => {
                        const next = values[0]
                        if (typeof next === "number") {
                            onValueChange(next)
                            onValueCommit?.(next)
                        }
                    }}
                    accessibilityLabel={accessibilityLabel}
                    onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
                    className={cn("h-12 justify-center", disabled && "opacity-50", className)}
                >
                    <SliderPrimitive.Track className="mx-[10px] h-1 overflow-hidden rounded-full bg-sm-line-strong">
                        <SliderPrimitive.Range asChild>
                            <View className="h-1 rounded-full bg-sm-accent-strong" style={{ width: `${ratio * 100}%` }} />
                        </SliderPrimitive.Range>
                    </SliderPrimitive.Track>
                    <SliderPrimitive.Thumb asChild>
                        <View
                            pointerEvents="none"
                            className="absolute h-5 w-5 rounded-full bg-white shadow-md"
                            style={{ left: knobLeft, top: 14 }}
                        />
                    </SliderPrimitive.Thumb>
                </SliderPrimitive.Root>
        </GestureDetector>
    )
}
