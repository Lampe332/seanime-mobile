import { atom, getDefaultStore, useAtomValue } from "jotai"
import type React from "react"
import { nextIndex, prevIndex, type TourStepPlacement } from "./tour-logic"
import { waitForTourTarget } from "./tour-targets"

/*
 * The tour's steps and state (web tour.tsx). A step with a `target` highlights that registered element with a card next
 * to it; without one it shows a centred card. Moving between steps runs `condition`, `prepare` and the wait for the target
 * in order; the state lives in one atom so the overlay and the screens read the same tour.
 */
export type TourStep = {
    id: string
    /** the registered target to highlight (tour-targets.ts); none = a centred card */
    target?: string
    content: React.ReactNode
    title?: React.ReactNode
    /** a badge above the title (its animation comes with E5) */
    hero?: "intro" | "celebrate"
    /** e.g. let a menu's slide-in settle */
    prepare?: () => Promise<void> | void
    placement?: TourStepPlacement
    /** dp around the cutout, default 8 */
    spotlightPadding?: number
    /** a tap on the target moves on */
    advanceOnTargetClick?: boolean
    /** taps inside the cutout reach the element */
    allowTargetInteraction?: boolean
    /** a tap on this other target moves on (e.g. Save inside the highlighted sheet) */
    advanceOnSelectorClick?: string
    disableBack?: boolean
    nextLabel?: string
    prevLabel?: string
    hideControls?: boolean
    /** Back/Next hidden, Skip kept: the user completes the step by tapping the real element */
    hideNextButton?: boolean
    popoverWidth?: number | string
    condition?: () => boolean
    conditionFailBehavior?: "skip" | "modal"
    /** default 3000 */
    waitForTargetMs?: number
    targetNotFoundBehavior?: "skip" | "modal"
    ignoreOutsideClick?: boolean
}

export type TourStatus = "idle" | "preparing" | "seeking"

export type TourState = {
    active: boolean
    tourId: string | null
    steps: TourStep[]
    currentIndex: number
    status: TourStatus
    /** the current step fell back to a centred card (condition false or target never came) */
    asModal: boolean
    onEnd?: () => void
}

const INITIAL_STATE: TourState = { active: false, tourId: null, steps: [], currentIndex: 0, status: "idle", asModal: false }

export const tourAtom = atom<TourState>(INITIAL_STATE)

const store = getDefaultStore()
const get = () => store.get(tourAtom)
const set = (update: Partial<TourState>) => store.set(tourAtom, { ...get(), ...update })

// A new start or the end cancels a step that is still getting ready
let run = 0

function endTour() {
    const { onEnd, active } = get()
    run++
    store.set(tourAtom, INITIAL_STATE)
    if (active) onEnd?.()
}

async function goToStep(index: number) {
    const { steps } = get()
    const step = steps[index]
    if (!step) return
    const mine = ++run
    const cancelled = () => mine !== run
    const skip = () => {
        const next = nextIndex(steps, index)
        if (next === null) endTour()
        else void goToStep(next)
    }
    try {
        let asModal = false
        if (step.condition && !step.condition()) {
            if ((step.conditionFailBehavior ?? "modal") === "skip") return skip()
            asModal = true
        }
        if (step.prepare) {
            set({ status: "preparing" })
            await step.prepare()
            await new Promise(resolve => setTimeout(resolve, 100))
            if (cancelled()) return
        }
        if (step.target && !asModal) {
            set({ status: "seeking" })
            const found = await waitForTourTarget(step.target, step.waitForTargetMs ?? 3000, cancelled)
            if (cancelled()) return
            if (!found) {
                if ((step.targetNotFoundBehavior ?? "modal") === "skip") return skip()
                asModal = true
            }
        }
        set({ currentIndex: index, status: "idle", asModal })
    } catch (error) {
        console.error("[Tour] Step transition failed:", error)
        // a broken step is skipped instead of ending the tour
        if (!cancelled()) skip()
    }
}

export const tour = {
    start(steps: TourStep[], tourId: string, onEnd?: () => void) {
        if (!steps.length) return
        run++
        store.set(tourAtom, { active: true, tourId, steps, currentIndex: 0, status: "idle", asModal: false, onEnd })
        void goToStep(0)
    },
    next() {
        const { currentIndex, steps, active } = get()
        if (!active) return
        const next = nextIndex(steps, currentIndex)
        if (next === null) endTour()
        else void goToStep(next)
    },
    prev() {
        const { currentIndex, steps, active } = get()
        if (!active) return
        const prev = prevIndex(steps, currentIndex)
        if (prev !== null) void goToStep(prev)
    },
    goTo(stepId: string) {
        const index = get().steps.findIndex(step => step.id === stepId)
        if (index !== -1) void goToStep(index)
    },
    stop: endTour,
    state: get,
}

export function useTourState() {
    return useAtomValue(tourAtom)
}
