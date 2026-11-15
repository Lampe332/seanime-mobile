// geschrieben nach: goja_plugin_types/core.d.ts (namespace $store, $clone); keine Vorlage

/*
 * $store: a map of keys to values the extension keeps while its sandbox lives (the contract names no lasting storage).
 * It sits inside the sandbox because every function of it answers at once. `get` and the other getters give copies,
 * the `…Unsafe` ones the values themselves, as the contract says.
 */

/** A deep copy of plain data (objects, arrays, dates, byte arrays); anything else is kept as it is */
export function clone(value) {
    if (value === null || typeof value !== "object") return value
    if (Array.isArray(value)) return value.map(clone)
    if (value instanceof Date) return new Date(value.getTime())
    if (ArrayBuffer.isView(value)) return value.slice()
    if (value instanceof Map) return new Map(Array.from(value, ([key, item]) => [clone(key), clone(item)]))
    if (value instanceof Set) return new Set(Array.from(value, clone))
    const proto = Object.getPrototypeOf(value)
    if (proto !== Object.prototype && proto !== null) return value
    const out = {}
    for (const key of Object.keys(value)) out[key] = clone(value[key])
    return out
}

export function makeStore() {
    const values = new Map()
    const watchers = new Map()

    function set(key, value) {
        values.set(String(key), value)
        for (const callback of watchers.get(String(key)) ?? []) callback(value)
    }

    return Object.freeze({
        set,
        get: key => clone(values.get(String(key))),
        getUnsafe: key => values.get(String(key)),
        has: key => values.has(String(key)),
        getOrSet(key, setFunc) {
            if (!values.has(String(key))) set(key, setFunc())
            return clone(values.get(String(key)))
        },
        setIfLessThanLimit(key, value, maxAllowedElements) {
            if (!values.has(String(key)) && values.size >= maxAllowedElements) return false
            set(key, value)
            return true
        },
        unmarshalJSON(data) {
            const parsed = JSON.parse(String(data))
            if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new TypeError("$store.unmarshalJSON: the JSON is not an object")
            for (const key of Object.keys(parsed)) set(key, parsed[key])
        },
        marshalJSON: value => JSON.stringify(value),
        reset() {
            values.clear()
        },
        values: () => Array.from(values.values(), clone),
        valuesUnsafe: () => Array.from(values.values()),
        getAll: () => Object.fromEntries(Array.from(values, ([key, value]) => [key, clone(value)])),
        getAllUnsafe: () => Object.fromEntries(values),
        watch(key, callback) {
            if (typeof callback !== "function") throw new TypeError("$store.watch: the callback is not a function")
            const list = watchers.get(String(key)) ?? []
            list.push(callback)
            watchers.set(String(key), list)
        },
    })
}
