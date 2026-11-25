import { hsvToRgb, toHex } from "@/lib/theme/palette"
import React from "react"
import { View } from "react-native"
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from "react-native-gesture-handler"
import Svg, { Circle, Defs, Path, RadialGradient, Stop } from "react-native-svg"

/*
 * A colour wheel: the hue runs around the edge, the centre is white. The angle of a point is its hue, its distance from
 * the centre its saturation (HSV at full value). Drawn as hue wedges under a white disc that fades out towards the edge.
 */
const WEDGES = 90
/** Room around the wheel so the thumb is whole at the edge */
const EDGE = 14

function spot(centre: number, radius: number, degrees: number) {
    const a = degrees * Math.PI / 180
    return `${(centre + radius * Math.cos(a)).toFixed(2)} ${(centre + radius * Math.sin(a)).toFixed(2)}`
}

/** The hue circle as wedges; each overlaps the next a little so no seam shows */
function wedges(centre: number, radius: number) {
    const step = 360 / WEDGES
    return Array.from({ length: WEDGES }, (_, i) => ({
        d: `M${centre} ${centre} L${spot(centre, radius, i * step - 0.4)} A${radius} ${radius} 0 0 1 ${spot(centre, radius, (i + 1) * step + 0.4)} Z`,
        fill: toHex(hsvToRgb((i + 0.5) * step, 1, 1)),
    }))
}

export function ColorWheel({ hue, saturation, onChange, size = 248, accessibilityLabel }: {
    /** degrees */
    hue: number
    /** 0 (white, the centre) to 1 (the edge) */
    saturation: number
    onChange: (hue: number, saturation: number) => void
    size?: number
    accessibilityLabel: string
}) {
    const centre = size / 2
    const radius = centre - EDGE
    const pick = (x: number, y: number) => {
        const dx = x - centre, dy = y - centre
        onChange((Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360, Math.min(1, Math.hypot(dx, dy) / radius))
    }
    const pan = usePanGesture({
        runOnJS: true,
        minDistance: 0,
        onActivate: event => pick(event.x, event.y),
        onUpdate: event => pick(event.x, event.y),
    })
    const tap = useTapGesture({ runOnJS: true, onActivate: event => pick(event.x, event.y) })
    const gesture = useExclusiveGestures(pan, tap)
    const angle = hue * Math.PI / 180
    const x = centre + saturation * radius * Math.cos(angle)
    const y = centre + saturation * radius * Math.sin(angle)
    return (
        <GestureDetector gesture={gesture}>
            <View accessible accessibilityLabel={accessibilityLabel} style={{ width: size, height: size }}>
                <Svg width={size} height={size}>
                    <Defs>
                        <RadialGradient id="color-wheel-white" cx="50%" cy="50%" r="50%">
                            <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
                            <Stop offset="1" stopColor="#ffffff" stopOpacity={0} />
                        </RadialGradient>
                    </Defs>
                    {wedges(centre, radius).map(wedge => <Path key={wedge.d} d={wedge.d} fill={wedge.fill} />)}
                    <Circle cx={centre} cy={centre} r={radius} fill="url(#color-wheel-white)" />
                    <Circle cx={x} cy={y} r={13} fill="none" stroke="#0e0e10" strokeOpacity={0.5} strokeWidth={2} />
                    <Circle cx={x} cy={y} r={10.5} fill={toHex(hsvToRgb(hue, saturation, 1))} stroke="#ffffff" strokeWidth={3} />
                </Svg>
            </View>
        </GestureDetector>
    )
}

/** The hue circle as a ring around a disc of `inner`: the mark of "any colour" */
export function HueRing({ size, thickness = 5, inner }: { size: number, thickness?: number, inner: string }) {
    const centre = size / 2
    return (
        <Svg width={size} height={size}>
            {wedges(centre, centre).map(wedge => <Path key={wedge.d} d={wedge.d} fill={wedge.fill} />)}
            <Circle cx={centre} cy={centre} r={centre - thickness} fill={inner} />
        </Svg>
    )
}
