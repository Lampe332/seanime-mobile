/*
 * When a phone counts as held upright again after fullscreen (MainActivity.holdUprightAfterFullscreen): the old app read
 * android.view.OrientationEventListener and released the upright hold at 0° ± 30°; a phone lying flat (ORIENTATION_UNKNOWN)
 * decided nothing. These are the same rules on the raw accelerometer values (expo-sensors gives them in g, Android's signs).
 */

/** OrientationEventListener's angle: 0 = upright, 90 = turned left, 270 = turned right; null = lying (nearly) flat. */
export function orientationDegrees(x: number, y: number, z: number): number | null {
    // SensorEventListenerImpl: X/Y/Z are the negated values; flat when the tilt is under ~26.6° (magnitude * 4 < Z²)
    const ax = -x, ay = -y, az = -z
    if ((ax * ax + ay * ay) * 4 < az * az) return null
    let angle = 90 - Math.round(Math.atan2(-ay, ax) * 180 / Math.PI)
    while (angle >= 360) angle -= 360
    while (angle < 0) angle += 360
    return angle
}

/** Upright as the old listener saw it: an angle in 0..30 or 330..359 (`degrees in 31..329` and flat were ignored). */
export function heldUpright(degrees: number | null): boolean {
    return degrees !== null && (degrees <= 30 || degrees >= 330)
}
