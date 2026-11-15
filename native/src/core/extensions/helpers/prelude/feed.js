// geschrieben nach: goja_plugin_types/core.d.ts ($goFeed.parse), RSS 2.0 Specification (RSS Advisory Board), RFC 4287 (Atom), RSS 1.0 (RDF Site Summary) und der öffentlichen README von gofeed (Felder des universellen Feeds); keine Vorlage

/*
 * $goFeed.parse: reads an RSS (0.9x, 1.0, 2.0) or Atom feed into one shape, whichever it was: the feed with its items,
 * named as gofeed's universal feed names its fields in JSON (title, link, links, items, enclosures, feedType …).
 * Elements of other namespaces (nyaa:infoHash, torrent:magnetURI …) land in `extensions[prefix][name]`.
 */

import { parseDocument } from "htmlparser2"

const isElement = node => node.type === "tag"
const local = name => name.slice(name.indexOf(":") + 1)
const prefixOf = name => (name.includes(":") ? name.slice(0, name.indexOf(":")) : "")

function textOf(node) {
    if (!node) return ""
    if (node.type === "text" || node.type === "cdata") return node.type === "cdata" ? node.children.map(textOf).join("") : node.data
    return (node.children ?? []).map(textOf).join("")
}

const kids = node => (node?.children ?? []).filter(isElement)
/** Children without a namespace prefix (or with the feed's own default one) named `name` */
const all = (node, name) => kids(node).filter(child => child.name === name || (prefixOf(child.name) === "atom" && local(child.name) === name && name !== "link"))
const one = (node, name) => all(node, name)[0]
const text = (node, name) => {
    const found = one(node, name)
    return found ? textOf(found).trim() : undefined
}

function parsedDate(value) {
    if (!value) return undefined
    const time = Date.parse(value)
    return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

/** Leaves out what is empty, as gofeed's JSON does */
function compact(object) {
    const out = {}
    for (const [key, value] of Object.entries(object)) {
        if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) continue
        if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) continue
        out[key] = value
    }
    return out
}

function extension(node) {
    const children = {}
    for (const child of kids(node)) (children[local(child.name)] ??= []).push(extension(child))
    return compact({ name: local(node.name), value: kids(node).length ? undefined : textOf(node).trim(), attrs: { ...node.attribs }, children })
}

/** Elements of other namespaces, by prefix and name */
function extensions(node) {
    const out = {}
    for (const child of kids(node)) {
        const prefix = prefixOf(child.name)
        if (!prefix || prefix === "atom") continue
        ((out[prefix] ??= {})[local(child.name)] ??= []).push(extension(child))
    }
    return out
}

function person(value) {
    if (!value) return undefined
    // RSS writes "mail@example.org (Name)"
    const match = /^\s*([^\s()]+@[^\s()]+)\s*\((.+)\)\s*$/.exec(value)
    return match ? { name: match[2], email: match[1] } : { name: value }
}

function rssItem(item) {
    const author = person(text(item, "author") ?? text(item, "dc:creator"))
    const enclosures = all(item, "enclosure").map(node => compact({ url: node.attribs.url, length: node.attribs.length, type: node.attribs.type }))
    const link = text(item, "link")
    const published = text(item, "pubDate") ?? text(item, "dc:date")
    return compact({
        title: text(item, "title"),
        description: text(item, "description"),
        content: text(item, "content:encoded"),
        link,
        links: link ? [link] : [],
        published,
        publishedParsed: parsedDate(published),
        author,
        authors: author ? [author] : [],
        guid: text(item, "guid"),
        categories: all(item, "category").map(node => textOf(node).trim()),
        enclosures,
        image: enclosures.find(enclosure => String(enclosure.type).startsWith("image/")) ? { url: enclosures.find(enclosure => String(enclosure.type).startsWith("image/")).url } : undefined,
        extensions: extensions(item),
    })
}

function rss(root, version) {
    const channel = one(root, "channel") ?? root
    // RSS 1.0 keeps its items next to the channel, RSS 2.0 inside it
    const items = [...all(channel, "item"), ...(channel === root ? [] : all(root, "item"))]
    const image = one(channel, "image") ?? one(root, "image")
    const link = text(channel, "link")
    const updated = text(channel, "lastBuildDate")
    const published = text(channel, "pubDate")
    const author = person(text(channel, "managingEditor") ?? text(channel, "webMaster"))
    const feedLink = kids(channel).find(child => child.name === "atom:link" && child.attribs.rel === "self")?.attribs.href
    return compact({
        title: text(channel, "title"),
        description: text(channel, "description"),
        link,
        feedLink,
        links: [link, feedLink].filter(Boolean),
        updated,
        updatedParsed: parsedDate(updated),
        published,
        publishedParsed: parsedDate(published),
        author,
        authors: author ? [author] : [],
        language: text(channel, "language"),
        image: image ? compact({ url: text(image, "url"), title: text(image, "title") }) : undefined,
        copyright: text(channel, "copyright"),
        generator: text(channel, "generator"),
        categories: all(channel, "category").map(node => textOf(node).trim()),
        extensions: extensions(channel),
        items: items.map(rssItem),
        feedType: "rss",
        feedVersion: version,
    })
}

function atomLinks(node) {
    return all(node, "link").map(link => ({ href: link.attribs.href, rel: link.attribs.rel ?? "alternate", type: link.attribs.type, length: link.attribs.length }))
}

function atomPeople(node) {
    return all(node, "author").map(author => compact({ name: text(author, "name"), email: text(author, "email") }))
}

function atomEntry(entry) {
    const links = atomLinks(entry)
    const authors = atomPeople(entry)
    const updated = text(entry, "updated")
    const published = text(entry, "published")
    const enclosures = links.filter(link => link.rel === "enclosure").map(link => compact({ url: link.href, length: link.length, type: link.type }))
    return compact({
        title: text(entry, "title"),
        description: text(entry, "summary"),
        content: text(entry, "content"),
        link: links.find(link => link.rel === "alternate")?.href ?? links[0]?.href,
        links: links.map(link => link.href).filter(Boolean),
        updated,
        updatedParsed: parsedDate(updated),
        published,
        publishedParsed: parsedDate(published),
        author: authors[0],
        authors,
        guid: text(entry, "id"),
        categories: all(entry, "category").map(node => node.attribs.term ?? node.attribs.label).filter(Boolean),
        enclosures,
        extensions: extensions(entry),
    })
}

function atom(root) {
    const links = atomLinks(root)
    const authors = atomPeople(root)
    const updated = text(root, "updated")
    const logo = text(root, "logo") ?? text(root, "icon")
    return compact({
        title: text(root, "title"),
        description: text(root, "subtitle"),
        link: links.find(link => link.rel === "alternate")?.href ?? links.find(link => link.rel !== "self")?.href,
        feedLink: links.find(link => link.rel === "self")?.href,
        links: links.map(link => link.href).filter(Boolean),
        updated,
        updatedParsed: parsedDate(updated),
        author: authors[0],
        authors,
        language: root.attribs["xml:lang"],
        image: logo ? { url: logo } : undefined,
        copyright: text(root, "rights"),
        generator: text(root, "generator"),
        categories: all(root, "category").map(node => node.attribs.term ?? node.attribs.label).filter(Boolean),
        extensions: extensions(root),
        items: all(root, "entry").map(atomEntry),
        feedType: "atom",
        feedVersion: "1.0",
    })
}

export function parse(source) {
    const document = parseDocument(String(source), { xmlMode: true, decodeEntities: true })
    const root = kids(document)[0]
    if (!root) throw new Error("$goFeed.parse: no XML in the text")
    const name = local(root.name).toLowerCase()
    if (name === "rss") return rss(root, root.attribs.version ?? "2.0")
    if (name === "rdf") return rss(root, "1.0")
    if (name === "feed") return atom(root)
    throw new Error(`$goFeed.parse: <${root.name}> is no RSS or Atom feed`)
}
