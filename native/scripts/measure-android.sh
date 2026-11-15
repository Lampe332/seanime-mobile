#!/usr/bin/env bash
# Measurements for docs/EIGENER-KERN.md, taken at the TEST app only (com.seanime.app.native).
# The table there is refilled after every stage, so the method lives here and stays the same.
# Since stage 8a-1 the app has no server process of its own; the app process is all there is to measure.
#
#   measure-android.sh <serial> <android-user> start <out-dir>     start until the first screen with content
#   measure-android.sh <serial> <android-user> mem                 PSS of the app process
#   measure-android.sh <serial> <android-user> cpu [seconds]       idle CPU of the app process (% of one core)
#   measure-android.sh <serial> <android-user> jank <x> <yFrom> <yTo> <swipes>   janky frames while scrolling a list
#
# Nothing here stops, clears or reconfigures anything: no force-stop, no settings, no logcat -c. "start" is a cold
# start only when the app is not running at that moment (after an install, or after Android removed it); otherwise
# it says "warm" and the number must be labelled so.
set -euo pipefail

SERIAL=$1
USER_ID=$2
COMMAND=$3
shift 3

# The scratch app (tablet) is measured the same way: MEASURE_PACKAGE=com.seanime.app.scratch
PKG=${MEASURE_PACKAGE:-com.seanime.app.native}
ACTIVITY=$PKG/com.seanime.app.nativeapp.MainActivity

sh() { adb -s "$SERIAL" shell "$@" | tr -d '\r'; }

app_pid() { sh "pidof $PKG" | awk '{print $1}'; }

cpu_ticks() { sh "cat /proc/$1/stat" | sed 's/.*) //' | awk '{print $12 + $13}'; }

case "$COMMAND" in
start)
    OUT=$1
    mkdir -p "$OUT"
    if [ -n "$(app_pid)" ]; then KIND=warm; else KIND=cold; fi
    REMOTE=/data/local/tmp/kern-start.mp4
    adb -s "$SERIAL" shell "screenrecord --time-limit 30 --bit-rate 6000000 $REMOTE" &
    RECORDER=$!
    sleep 3
    echo "kind: $KIND"
    echo "am start at: $(date '+%F %T')"
    sh "am start -W -n $ACTIVITY --user $USER_ID" | grep -E 'LaunchState|TotalTime|WaitTime'
    wait $RECORDER
    # exec-out instead of pull: Git Bash would rewrite a bare /data/... argument into a Windows path.
    adb -s "$SERIAL" exec-out "cat $REMOTE" > "$OUT/start-$SERIAL-$KIND.mp4"
    sh "rm $REMOTE"
    # Read the result off the pictures (20 per second, `ffmpeg -i <video> -vf fps=20 ...`): count from the first
    # picture that shows the app window to the first one with real content (covers and rows, not the loading text).
    echo "video: $OUT/start-$SERIAL-$KIND.mp4"
    ;;
mem)
    PID=$(app_pid)
    if [ -z "$PID" ]; then echo "app: not running"; exit 1; fi
    echo "app pid $PID: $(sh "dumpsys meminfo $PID" | grep -E 'TOTAL PSS:|^ *TOTAL ' | head -n 1 | tr -s ' ')"
    ;;
cpu)
    SECONDS_TO_WAIT=${1:-10}
    APP=$(app_pid)
    if [ -z "$APP" ]; then echo "app: not running"; exit 1; fi
    APP_BEFORE=$(cpu_ticks "$APP")
    FRAMES_BEFORE=$(sh "dumpsys gfxinfo $PKG" | grep 'Total frames rendered' | awk '{print $4}')
    sleep "$SECONDS_TO_WAIT"
    APP_AFTER=$(cpu_ticks "$APP")
    FRAMES_AFTER=$(sh "dumpsys gfxinfo $PKG" | grep 'Total frames rendered' | awk '{print $4}')
    # /proc/<pid>/stat counts in ticks of 1/100 s, so ticks per second = percent of one core.
    echo "app pid $APP: $(awk "BEGIN{printf \"%.1f\", ($APP_AFTER - $APP_BEFORE) / $SECONDS_TO_WAIT}") % over $SECONDS_TO_WAIT s"
    echo "frames drawn meanwhile: $((FRAMES_AFTER - FRAMES_BEFORE))"
    ;;
jank)
    X=$1
    Y_FROM=$2
    Y_TO=$3
    SWIPES=$4
    sh "dumpsys gfxinfo $PKG reset" > /dev/null
    for _ in $(seq "$SWIPES"); do sh "input swipe $X $Y_FROM $X $Y_TO 300"; sleep 0.7; done
    for _ in $(seq "$SWIPES"); do sh "input swipe $X $Y_TO $X $Y_FROM 300"; sleep 0.7; done
    sh "dumpsys gfxinfo $PKG" | grep -E 'Total frames rendered|Janky frames:|90th percentile|99th percentile|Slow UI thread|Slow bitmap uploads' | tr -s ' '
    ;;
*)
    echo "unknown command: $COMMAND" >&2
    exit 2
    ;;
esac
