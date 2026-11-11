import { describe, expect, it } from "vitest"
import {
    barGrowDelay, boxTransform, COVER_FLIGHT, coverGroundWaits, coverLayerOpacity, coverLayerScale, coverOnScreen, coverShapesDiffer, coverWaitOver, DISTANCE, GLIDE,
    GLIDE_HANDOFF_MS, glideHandoff, glidePlan, LOAD_MAX_WAIT_MS, MAX_WAIT_MS, mixBox, nextCarouselPlace, pageRiseFrom, PHONE_EASE,
    MOTION_EASE_OUT, scrimAtOnce, SCRIM_HANDOFF_MS, swapTiming, TOUR_FINALE, TOUR_MOTION, tourRingDelayMs, tourSparks, tourTravelMs, WAIT_MS,
} from "./motion"

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height })

describe("swapTiming (swaps and pages coming in)", () => {
    it("phone: 260 ms on the gentle phone curve", () => {
        expect(swapTiming(false)).toEqual({ duration: 260, ease: PHONE_EASE })
        expect(PHONE_EASE).toEqual([0.2, 0.6, 0.35, 1])
    })
    it("tablet: 220 ms on the strong ease-out", () => {
        expect(swapTiming(true)).toEqual({ duration: 220, ease: MOTION_EASE_OUT })
    })
})

describe("coverGroundWaits (the copy's first frame on the way back)", () => {
    it("on the way back the ground waits for the picture or the move, so the header's cover shows through meanwhile", () => {
        expect(coverGroundWaits("out", false, false)).toBe(true)
        expect(coverGroundWaits("out", true, false)).toBe(false)
        expect(coverGroundWaits("out", false, true)).toBe(false)
    })
    it("the way in keeps its ground (a dimmed card's ground colour)", () => {
        expect(coverGroundWaits("in", false, false)).toBe(false)
        expect(coverGroundWaits(undefined, false, false)).toBe(false)
    })
})

describe("pageRiseFrom (a page's rise)", () => {
    it("a hidden page rests where it stands, so the cover's way back measures its card at the card's real place", () => {
        expect(pageRiseFrom(false, false)).toBe(0)
        expect(pageRiseFrom(false, true)).toBe(0)
    })
    it("coming in it rises 6dp, under a cover flight it only fades", () => {
        expect(pageRiseFrom(true, false)).toBe(DISTANCE.swap)
        expect(DISTANCE.swap).toBe(6)
        expect(pageRiseFrom(true, true)).toBe(0)
    })
})

describe("glidePlan (segment-glide)", () => {
    const option = box(4, 4, 100, 40)
    it("jumps on the first layout, with nothing to come from", () => {
        expect(glidePlan(null, option, false)).toBe("jump")
    })
    it("jumps with reduced motion", () => {
        expect(glidePlan(box(120, 4, 100, 40), option, true)).toBe("jump")
    })
    it("jumps to or from an option that is not laid out yet", () => {
        expect(glidePlan(box(0, 0, 0, 40), option, false)).toBe("jump")
        expect(glidePlan(option, box(0, 0, 100, 0), false)).toBe("jump")
    })
    it("glides between options of one size and of a size within 1.33×", () => {
        expect(glidePlan(box(120, 4, 100, 40), option, false)).toBe("glide")
        expect(glidePlan(box(120, 4, 133, 40), option, false)).toBe("glide")
        expect(glidePlan(box(120, 4, 76, 40), option, false)).toBe("glide")
    })
    it("lets the bubble appear at an option much wider or narrower (the round ends would stretch)", () => {
        expect(glidePlan(box(120, 4, 140, 40), option, false)).toBe("appear")
        expect(glidePlan(box(120, 4, 60, 40), option, false)).toBe("appear")
        expect(glidePlan(box(120, 4, 100, 60), option, false)).toBe("appear")
    })
    it("glides 280 ms, appears in 180 ms", () => {
        expect(GLIDE.duration).toBe(280)
        expect(GLIDE.appear).toBe(180)
    })
})

describe("glideHandoff (a switch built anew for its own choice)", () => {
    const left = { key: "anime", box: box(4, 4, 160, 40), at: 1000 }
    it("starts from the old bubble when the choice moved just now", () => {
        expect(glideHandoff(left, "manga", 1050)).toBe(left)
        expect(glideHandoff(left, "manga", 1000 + GLIDE_HANDOFF_MS)).toBe(left)
    })
    it("not for the same option (the stats view), nothing chosen, nothing left or an old one", () => {
        expect(glideHandoff(left, "anime", 1050)).toBeNull()
        expect(glideHandoff(left, null, 1050)).toBeNull()
        expect(glideHandoff(undefined, "manga", 1050)).toBeNull()
        expect(glideHandoff(null, "manga", 1050)).toBeNull()
        expect(glideHandoff(left, "manga", 1001 + GLIDE_HANDOFF_MS)).toBeNull()
    })
})

describe("boxTransform / mixBox (the bubble and the flying cover on transform alone)", () => {
    it("is the identity on its own box", () => {
        expect(boxTransform(box(10, 20, 100, 150), box(10, 20, 100, 150))).toEqual({ translateX: 0, translateY: 0, scaleX: 1, scaleY: 1 })
    })
    it("moves the centre and scales around it", () => {
        // a 100×150 cover at (10, 400) flying into an 88×124 header cover at (16, 120)
        const t = boxTransform(box(10, 400, 100, 150), box(16, 120, 88, 124))
        expect(t.translateX).toBeCloseTo(16 + 44 - 60)
        expect(t.translateY).toBeCloseTo(120 + 62 - 475)
        expect(t.scaleX).toBeCloseTo(0.88)
        expect(t.scaleY).toBeCloseTo(124 / 150)
    })
    it("does not divide by a box of no size", () => {
        expect(boxTransform(box(0, 0, 0, 0), box(5, 5, 10, 10)).scaleX).toBe(1)
    })
    it("mixes the box linearly, so the transform follows the box", () => {
        const a = box(0, 0, 100, 100), b = box(100, 200, 50, 150)
        expect(mixBox(a, b, 0)).toEqual(a)
        expect(mixBox(a, b, 1)).toEqual(b)
        expect(mixBox(a, b, 0.5)).toEqual(box(50, 100, 75, 125))
    })
})

describe("cover flight", () => {
    it("flies 420 ms on the phone, 340 ms on a tablet", () => {
        expect(COVER_FLIGHT.phone.duration).toBe(420)
        expect(COVER_FLIGHT.tablet.duration).toBe(340)
        expect(COVER_FLIGHT.miss).toBe(120)
    })
    it("flies only a cover big enough and on screen", () => {
        const screen = { width: 400, height: 800 }
        expect(coverOnScreen(box(10, 100, 100, 150), screen)).toBe(true)
        expect(coverOnScreen(box(10, 100, 20, 30), screen)).toBe(false)
        expect(coverOnScreen(box(10, -160, 100, 150), screen)).toBe(false)
        expect(coverOnScreen(box(10, -100, 100, 150), screen)).toBe(true)
        expect(coverOnScreen(box(10, 800, 100, 150), screen)).toBe(false)
    })
    it("not a card scrolled sideways out of its row", () => {
        const screen = { width: 400, height: 800 }
        expect(coverOnScreen(box(-110, 100, 100, 150), screen)).toBe(false)
        expect(coverOnScreen(box(-90, 100, 100, 150), screen)).toBe(true)
        expect(coverOnScreen(box(390, 100, 100, 150), screen)).toBe(true)
        expect(coverOnScreen(box(400, 100, 100, 150), screen)).toBe(false)
    })
    it("the picture grows evenly and still covers the flying box", () => {
        // a 2:1 still flying into an 88×124 cover
        const base = box(0, 0, 300, 150), cover = box(0, 0, 88, 124)
        for (const t of [0, 0.3, 0.5, 1]) {
            const now = mixBox(base, cover, t)
            const boxScale = boxTransform(base, now)
            for (const layer of [base, cover]) {
                const s = coverLayerScale(base, now, layer)
                const netX = boxScale.scaleX * s.scaleX, netY = boxScale.scaleY * s.scaleY
                expect(netX).toBeCloseTo(netY, 6)
                expect(layer.width * netX).toBeGreaterThanOrEqual(now.width - 1e-6)
                expect(layer.height * netY).toBeGreaterThanOrEqual(now.height - 1e-6)
            }
        }
        // the landing picture lands at its own size; the start's at the start
        expect(coverLayerScale(base, cover, cover)).toEqual({ scaleX: 300 / 88, scaleY: 150 / 124 })
        expect(coverLayerScale(base, base, base)).toEqual({ scaleX: 1, scaleY: 1 })
        expect(coverLayerScale(box(0, 0, 0, 0), cover, cover)).toEqual({ scaleX: 1, scaleY: 1 })
    })
    it("cross-fades only between pictures of another shape", () => {
        expect(coverShapesDiffer(box(0, 0, 300, 150), box(0, 0, 88, 124))).toBe(true)
        // the 3:4 Home card into the 88:124 header is still a cover
        expect(coverShapesDiffer(box(0, 0, 120, 160), box(0, 0, 88, 124))).toBe(false)
        expect(coverShapesDiffer(box(0, 0, 44, 66), box(0, 0, 88, 124))).toBe(false)
        expect(coverShapesDiffer(box(0, 0, 0, 66), box(0, 0, 88, 124))).toBe(false)
    })
    it("the pictures' opacity: one picture goes from its card's to the landing place's; a cross-fade never dips", () => {
        expect(coverLayerOpacity(0, 0.5, 1, false)).toEqual({ base: 0.5, top: 0 })
        expect(coverLayerOpacity(1, 0.5, 1, false)).toEqual({ base: 1, top: 0 })
        expect(coverLayerOpacity(0, 0.5, 1, true)).toEqual({ base: 0.5, top: 0 })
        expect(coverLayerOpacity(1, 1, 0.5, true)).toEqual({ base: 0, top: 0.5 })
        // top over base: the pictures cover at least .85 (a straight cross-fade dips to .75 halfway)
        for (const t of [0.25, 0.5, 0.75]) {
            const { base, top } = coverLayerOpacity(t, 1, 1, true)
            expect(top + base * (1 - top)).toBeGreaterThanOrEqual(0.85)
        }
    })
    it("phone: waits WAIT_MS from when the page was built, at most MAX_WAIT_MS from the tap", () => {
        expect(coverWaitOver(200, 0, null, false)).toBe(false)
        // a heavy page built 325 ms after the tap still gets its wait
        expect(coverWaitOver(400, 0, 325, false)).toBe(false)
        expect(coverWaitOver(WAIT_MS + 101, 0, 100, false)).toBe(true)
        // built late (its data came slowly): it still gets WAIT_MS
        expect(coverWaitOver(MAX_WAIT_MS + 1, 0, 400, false)).toBe(false)
        expect(coverWaitOver(400 + WAIT_MS + 1, 0, 400, false)).toBe(true)
    })
    it("tablet: counts from the tap only", () => {
        expect(coverWaitOver(WAIT_MS + 200, 0, 100, true)).toBe(false)
        expect(coverWaitOver(MAX_WAIT_MS + 1, 0, 100, true)).toBe(true)
        expect(coverWaitOver(800, 0, 600, true)).toBe(false)
        expect(coverWaitOver(600 + WAIT_MS + 1, 0, 600, true)).toBe(true)
    })
    it("keeps the copy while the page still loads its data (first visit), up to LOAD_MAX_WAIT_MS", () => {
        for (const tablet of [false, true]) {
            expect(coverWaitOver(700, 0, null, tablet)).toBe(false)
            expect(coverWaitOver(LOAD_MAX_WAIT_MS, 0, null, tablet)).toBe(false)
            expect(coverWaitOver(LOAD_MAX_WAIT_MS + 1, 0, null, tablet)).toBe(true)
        }
    })
})

describe("scrimAtOnce (sheet → sheet without a flash)", () => {
    it("fades in alone", () => {
        expect(scrimAtOnce(0, 10_000)).toBe(false)
    })
    it("shows at once while another sheet is open or just closed", () => {
        expect(scrimAtOnce(1, 10_000)).toBe(true)
        expect(scrimAtOnce(0, SCRIM_HANDOFF_MS - 1)).toBe(true)
        expect(scrimAtOnce(0, SCRIM_HANDOFF_MS)).toBe(false)
    })
})

describe("barGrowDelay (statistics bars)", () => {
    it("staggers the first five 30 ms apart, the rest with the fifth", () => {
        expect([0, 1, 2, 3, 4, 5, 9].map(barGrowDelay)).toEqual([0, 30, 60, 90, 120, 120, 120])
        expect(barGrowDelay(-1)).toBe(0)
    })
})

describe("nextCarouselPlace (Upcoming episodes autoplay)", () => {
    it("moves one place on and starts over after the last", () => {
        expect(nextCarouselPlace(0, 3)).toBe(1)
        expect(nextCarouselPlace(1, 3)).toBe(2)
        expect(nextCarouselPlace(2, 3)).toBe(0)
    })
    it("stays at the start with one place or none", () => {
        expect(nextCarouselPlace(0, 1)).toBe(0)
        expect(nextCarouselPlace(0, 0)).toBe(0)
    })
})

describe("tour motion per device", () => {
    const from = { top: 1100, left: 20, width: 60, height: 60 }
    const to = { top: 100, left: 300, width: 200, height: 48 }
    it("phone: the spotlight always travels 340 ms", () => {
        expect(tourTravelMs(TOUR_MOTION.phone, from, to)).toBe(340)
    })
    it("tablet: 240 ms plus 0.17 ms per dp of the edge that moves most, at most 380 ms", () => {
        const short = { top: 1100, left: 40, width: 60, height: 60 }
        expect(tourTravelMs(TOUR_MOTION.tablet, from, short)).toBe(Math.round(240 + 0.17 * 20))
        expect(tourTravelMs(TOUR_MOTION.tablet, from, to)).toBe(380)
    })
    it("shows the tap ring only once the cutout got there (longest iris or travel)", () => {
        expect(tourRingDelayMs(TOUR_MOTION.phone)).toBe(340)
        expect(tourRingDelayMs(TOUR_MOTION.tablet)).toBe(380)
        expect(tourRingDelayMs(TOUR_MOTION.phone)).toBeGreaterThanOrEqual(TOUR_MOTION.phone.iris)
    })
    it("keeps the tablet's finale a little quicker", () => {
        expect(TOUR_FINALE.phone.badge).toBe(420)
        expect(TOUR_FINALE.tablet.badge).toBe(380)
        expect(TOUR_FINALE.phone.check).toBe(360)
        expect(TOUR_FINALE.tablet.check).toBe(320)
    })
})

describe("tourSparks", () => {
    const sparks = tourSparks(16, 40, 30, 24)
    it("makes 16 sparks 25 ms apart", () => {
        expect(sparks).toHaveLength(16)
        expect(sparks.map(s => s.delay)).toEqual(Array.from({ length: 16 }, (_, i) => i * 25))
    })
    it("starts each on the badge's oval and flies it outwards", () => {
        for (const s of sparks) {
            expect((s.fromX / 40) ** 2 + (s.fromY / 30) ** 2).toBeCloseTo(1)
            expect(Math.hypot(s.toX, s.toY)).toBeGreaterThan(Math.hypot(s.fromX, s.fromY))
        }
        // the first one points straight up
        expect(sparks[0].fromX).toBeCloseTo(0)
        expect(sparks[0].fromY).toBeCloseTo(-30)
    })
    it("flies less far up and down than sideways (nothing cut off at the card's edge)", () => {
        const up = sparks[0], side = sparks[4]
        expect(Math.abs(up.toY - up.fromY)).toBeLessThan(Math.abs(side.toX - side.fromX))
    })
})
