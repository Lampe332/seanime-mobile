#!/usr/bin/env node
// geschrieben nach: docs/EIGENER-KERN.md §4c (Quellen und Ziele des Umzugs) und dem Aufbau der DB-Kopien vom 13.11.2026 (a-scratch-frisch, b-scratch-nach-aufzeichnung, c-test bereinigt); ruft den Umzug aus src/core/move/ auf, kein Server-Quelltext
// Runs the core's move (src/core/move/move.ts, docs/EIGENER-KERN.md §4c) against copies of the server's files and says,
// part by part, what was taken over, what was empty and where the core's copy differs from the server's.
//
//   node scripts/check-migration.mjs <folder> [<folder> …]
//
// A folder holds `seanime.db` and, if there is one, `watch_history.cache` (also looked for under `cache/`), the way the
// DB copies lie under kern-aufzeichnungen\<day>\db-kopien\ (docs/EIGENER-KERN.md §6). The files are opened read-only;
// the core's database lives in memory and is gone afterwards. The output carries counts and names of fields, never a
// value: it is safe to paste. Exit code 1 when any folder shows a difference.

import { Buffer } from "node:buffer"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"
import { fileURLToPath } from "node:url"
import { createJiti } from "jiti"

const nativeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const jiti = createJiti(import.meta.url, { alias: { "@": path.join(nativeRoot, "src") } })
const core = await jiti.import(path.join(nativeRoot, "src/core/index.ts"))
const { columnOf, settingsColumnOf, timeOf } = await jiti.import(path.join(nativeRoot, "src/core/move/move.ts"))
const { APPEARANCE_SHAPE, SETTINGS_SECTIONS, SETTINGS_SHAPE } = await jiti.import(path.join(nativeRoot, "src/core/settings/shape.ts"))

const folders = process.argv.slice(2)
if (folders.length === 0) {
    console.error("usage: node scripts/check-migration.mjs <folder with seanime.db> [<folder> …]")
    process.exit(2)
}

const hashOf = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")
const text = value => (ArrayBuffer.isView(value) ? Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString("utf8") : value)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

/** The stored value the way the core keeps a field of this kind: NULL is the empty value, 0/1 is no/yes, a list is JSON */
function asKind(sample, stored) {
    const value = text(stored)
    if (Array.isArray(sample)) return value === null ? [] : JSON.parse(value) ?? []
    if (typeof sample === "boolean") return value === null ? false : value === 1 || value === true
    if (typeof sample === "number") return value ?? 0
    return value ?? ""
}

async function check(folder) {
    const databaseFile = path.join(folder, "seanime.db")
    const cacheFile = [path.join(folder, "watch_history.cache"), path.join(folder, "cache", "watch_history.cache")].find(file => fs.existsSync(file))
    const sourceFiles = [databaseFile, cacheFile].filter(file => file && fs.existsSync(file))
    const before = sourceFiles.map(hashOf)
    const old = fs.existsSync(databaseFile) ? new DatabaseSync(databaseFile, { readOnly: true }) : null
    const oldRows = table => old.prepare(`SELECT * FROM ${table} ORDER BY id`).all()

    const own = new DatabaseSync(":memory:")
    const driver = async (sql, params, method) => {
        const statement = own.prepare(sql)
        statement.setReturnArrays(true)
        const rows = statement.all(...params)
        return { rows: method === "run" ? [] : method === "get" ? rows[0] : rows }
    }
    const ownRows = table => own.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()
    const everything = () => JSON.stringify(["account", "appearance", "home_items", "move_parts", "settings_sections", "watch_positions"].map(ownRows))
    const secrets = new Map()
    const environment = {
        database: await core.openCoreDatabase(driver, Date.now),
        old: {
            rows: async table => (old ? old.prepare(`SELECT * FROM ${table}`).all() : null),
            cacheFile: async bucket => (bucket === "watch_history" && cacheFile ? fs.readFileSync(cacheFile, "utf8") : null),
        },
        secrets: { read: async name => secrets.get(name) ?? null, write: async (name, value) => void secrets.set(name, value) },
        now: Date.now,
    }

    const results = await core.moveFromServerOnce(environment)
    const differences = []
    const compared = {}
    const differ = (part, field, a, b) => {
        compared[part] = (compared[part] ?? 0) + 1
        if (!same(a, b)) differences.push(`${part}.${field}`)
    }
    const leftovers = Object.fromEntries(ownRows("move_parts").map(row => [row.part, JSON.parse(row.leftovers ?? "{}")]))
    const moved = part => results.find(result => result.part === part).outcome === "moved"

    if (moved("settings")) {
        const [row] = oldRows("settings")
        const sections = Object.fromEntries(ownRows("settings_sections").map(section => [section.section, JSON.parse(section.content)]))
        const used = new Set(["id", "created_at", "updated_at"])
        for (const section of SETTINGS_SECTIONS) {
            for (const [field, sample] of Object.entries(SETTINGS_SHAPE[section])) {
                const column = settingsColumnOf(section, field)
                used.add(column)
                differ("settings", column, asKind(sample, row[column]), sections[section]?.[field])
            }
        }
        for (const column of Object.keys(row).filter(name => !used.has(name))) differ("settings", column, text(row[column]), leftovers.settings[column])
        differ("settings", "updated_at", timeOf(row.updated_at), Math.max(...ownRows("settings_sections").map(section => section.changed_at)))
    }
    if (moved("appearance")) {
        const [row] = oldRows("themes")
        const [look] = ownRows("appearance")
        const content = JSON.parse(look.content)
        const used = new Set(["id", "created_at", "updated_at", "unpinned_menu_items", "home_items"])
        for (const [field, sample] of Object.entries(APPEARANCE_SHAPE)) {
            used.add(columnOf(field))
            differ("appearance", columnOf(field), asKind(sample, row[columnOf(field)]), content[field])
        }
        differ("appearance", "unpinned_menu_items", row.unpinned_menu_items === null ? null : JSON.parse(text(row.unpinned_menu_items)), content.unpinnedMenuItems)
        for (const column of Object.keys(row).filter(name => !used.has(name))) differ("appearance", column, text(row[column]), leftovers.appearance[column])
        differ("appearance", "created_at", timeOf(row.created_at), look.created_at)
        differ("appearance", "updated_at", timeOf(row.updated_at), look.changed_at)
    }
    if (moved("homeItems")) {
        const items = JSON.parse(text(oldRows("themes")[0].home_items))
        const rows = ownRows("home_items")
        differ("homeItems", "count", items.length, rows.length)
        items.forEach((item, index) => {
            const row = rows[index] ?? {}
            differ("homeItems", "id", item.id, row.item_id)
            differ("homeItems", "type", item.type, row.kind)
            differ("homeItems", "schemaVersion", item.schemaVersion ?? 0, row.schema_version)
            differ("homeItems", "options", item.options ?? null, row.options === null || row.options === undefined ? null : JSON.parse(row.options))
        })
    }
    if (moved("account")) {
        const [row] = oldRows("accounts")
        const [mine] = ownRows("account")
        differ("account", "username", text(row.username), mine.username)
        differ("account", "viewer", text(row.viewer), mine.viewer)
        differ("account", "created_at", timeOf(row.created_at), mine.created_at)
        differ("account", "updated_at", timeOf(row.updated_at), mine.changed_at)
        differ("account", "token (secured storage)", text(row.token), secrets.get(core.ACCOUNT_TOKEN_SECRET))
        // the token must be nowhere in the core's database (a token shorter than 8 characters could be there by chance)
        const token = text(row.token) ?? ""
        differ("account", "token (not in the database)", false, token.length >= 8 && everything().includes(token))
    }
    if (moved("watchHistory")) {
        const entries = Object.values(JSON.parse(fs.readFileSync(cacheFile, "utf8")))
        const rows = new Map(ownRows("watch_positions").map(row => [row.media_id, row]))
        differ("watchHistory", "count", entries.length, rows.size)
        for (const { value, expiration } of entries) {
            const row = rows.get(value.mediaId) ?? {}
            differ("watchHistory", "currentTime", value.currentTime, row.position_seconds)
            differ("watchHistory", "duration", value.duration, row.duration_seconds)
            differ("watchHistory", "episodeNumber", value.episodeNumber, row.episode_number)
            differ("watchHistory", "filepath", value.filepath, row.filepath)
            differ("watchHistory", "kind", value.kind, row.kind)
            differ("watchHistory", "timeAdded", timeOf(value.timeAdded), row.added_at)
            differ("watchHistory", "timeUpdated", timeOf(value.timeUpdated), row.changed_at)
            differ("watchHistory", "expiration", timeOf(expiration), row.expires_at)
        }
    }

    const after = everything()
    const again = await core.moveFromServer(environment)
    const repeatChanged = everything() !== after || again.some(result => moved(result.part) && result.outcome !== "kept")
    old?.close()
    const sourceChanged = !same(before, sourceFiles.map(hashOf))

    console.log(`== ${path.basename(path.resolve(folder))}`)
    for (const result of results) {
        const word = { moved: "übernommen", empty: "leer", kept: "behalten", missing: "Datei fehlt", failed: "gescheitert" }[result.outcome]
        const notes = [
            compared[result.part] ? `${compared[result.part]} Werte verglichen` : "",
            result.extraFields.length > 0 ? `mitgenommen: ${result.extraFields.join(" ")}` : "",
            result.unfitFields.length > 0 ? `unpassend: ${result.unfitFields.join(" ")}` : "",
            result.reason ?? "",
        ].filter(Boolean)
        console.log(`  ${result.part.padEnd(13)} ${word.padEnd(11)} ${String(result.count).padStart(3)}${notes.length > 0 ? `   (${notes.join("; ")})` : ""}`)
    }
    console.log(`  Abweichungen: ${differences.length}${differences.length > 0 ? ` (${[...new Set(differences)].join(", ")})` : ""}`)
    console.log(`  Wiederholung ändert nichts: ${repeatChanged ? "NEIN" : "ja"} · Quelldateien unverändert: ${sourceChanged ? "NEIN" : "ja"} (${sourceFiles.length} Dateien)`)
    return differences.length === 0 && !repeatChanged && !sourceChanged
}

let good = true
for (const folder of folders) good = (await check(folder)) && good
process.exit(good ? 0 : 1)
