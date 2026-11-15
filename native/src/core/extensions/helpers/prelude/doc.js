// geschrieben nach: goja_plugin_types/core.d.ts (DocSelection, Doc, LoadDoc, DocSelectionFunction) und öffentlicher Doku von htmlparser2, css-select, domutils und jQuery (Traversing); keine Vorlage

/*
 * LoadDoc / Doc: reads HTML and asks it with CSS selectors, as the contract's DocSelection describes. htmlparser2 reads
 * the HTML into a tree (the same tree browsers' tools build: elements, text, comments), css-select answers the
 * selectors, domutils gives text and HTML. A selection is a list of nodes of that tree; every method gives a new one
 * and remembers the one it came from (end()).
 */

import { selectAll, is as matches } from "css-select"
import { getInnerHTML, textContent } from "domutils"
import { parseDocument } from "htmlparser2"

const isElement = node => node.type === "tag" || node.type === "script" || node.type === "style"
const elementsOf = nodes => nodes.filter(isElement)

/** The nodes once each, in the order they came */
function unique(nodes) {
    const seen = new Set()
    return nodes.filter(node => (seen.has(node) ? false : (seen.add(node), true)))
}

const siblingsAfter = node => {
    const out = []
    for (let next = node.nextSibling; next; next = next.nextSibling) if (isElement(next)) out.push(next)
    return out
}
const siblingsBefore = node => {
    const out = []
    for (let previous = node.previousSibling; previous; previous = previous.previousSibling) if (isElement(previous)) out.push(previous)
    return out
}
const ancestors = node => {
    const out = []
    for (let parent = node.parent; parent && isElement(parent); parent = parent.parent) out.push(parent)
    return out
}

/** Takes nodes from a list until one matches `until` (that one not taken) */
function takeUntil(list, until) {
    const out = []
    for (const node of list) {
        if (until && matches(node, until)) break
        out.push(node)
    }
    return out
}

export class DocSelection {
    constructor(nodes, previous = null) {
        Object.defineProperty(this, "nodes", { value: nodes })
        Object.defineProperty(this, "previous", { value: previous })
    }

    #next(nodes) {
        return new DocSelection(unique(nodes), this)
    }

    #filtered(nodes, selector) {
        return this.#next(selector === undefined || selector === "" ? nodes : nodes.filter(node => isElement(node) && matches(node, selector)))
    }

    #test(selector) {
        return typeof selector === "function"
            ? (node, index) => Boolean(selector(index, new DocSelection([node], this)))
            : node => isElement(node) && matches(node, String(selector))
    }

    attr(name) {
        const first = elementsOf(this.nodes)[0]
        return first && Object.hasOwn(first.attribs, name) ? first.attribs[name] : undefined
    }

    attrs() {
        const first = elementsOf(this.nodes)[0]
        return first ? { ...first.attribs } : {}
    }

    children(selector) {
        return this.#filtered(this.nodes.flatMap(node => elementsOf(node.children ?? [])), selector)
    }

    closest(selector) {
        return this.#next(elementsOf(this.nodes).flatMap(node => {
            if (selector === undefined) return [node]
            const found = [node, ...ancestors(node)].find(candidate => matches(candidate, selector))
            return found ? [found] : []
        }))
    }

    contents() {
        return this.#next(this.nodes.flatMap(node => node.children ?? []))
    }

    contentsFiltered(selector) {
        return this.#filtered(this.nodes.flatMap(node => node.children ?? []), selector)
    }

    data(name) {
        const attributes = this.attrs()
        if (name !== undefined) return attributes[`data-${name}`]
        const out = {}
        for (const key of Object.keys(attributes)) if (key.startsWith("data-")) out[key.slice(5)] = attributes[key]
        return out
    }

    each(callback) {
        this.nodes.forEach((node, index) => callback(index, new DocSelection([node], this)))
        return this
    }

    end() {
        return this.previous ?? new DocSelection([])
    }

    eq(index) {
        const at = index < 0 ? this.nodes.length + index : index
        return this.#next(at >= 0 && at < this.nodes.length ? [this.nodes[at]] : [])
    }

    filter(selector) {
        const test = this.#test(selector)
        return this.#next(this.nodes.filter((node, index) => test(node, index)))
    }

    find(selector) {
        return this.#next(this.nodes.flatMap(node => selectAll(selector, node.children ?? [])))
    }

    first() {
        return this.eq(0)
    }

    has(selector) {
        return this.#next(this.nodes.filter(node => selectAll(selector, node.children ?? []).length > 0))
    }

    text() {
        return this.nodes.map(node => textContent(node)).join("")
    }

    html() {
        const first = this.nodes[0]
        return first ? getInnerHTML(first, { decodeEntities: false }) : null
    }

    is(selector) {
        const test = this.#test(selector)
        return this.nodes.some((node, index) => test(node, index))
    }

    last() {
        return this.eq(-1)
    }

    length() {
        return this.nodes.length
    }

    map(callback) {
        return this.nodes.map((node, index) => callback(index, new DocSelection([node], this)))
    }

    next(selector) {
        return this.#filtered(this.nodes.flatMap(node => siblingsAfter(node).slice(0, 1)), selector)
    }

    nextAll(selector) {
        return this.#filtered(this.nodes.flatMap(siblingsAfter), selector)
    }

    /** One selector: up to it. Two: the first filters, the second is where it stops. */
    nextUntil(selector, until) {
        return until === undefined
            ? this.#next(this.nodes.flatMap(node => takeUntil(siblingsAfter(node), selector)))
            : this.#filtered(this.nodes.flatMap(node => takeUntil(siblingsAfter(node), until)), selector)
    }

    not(selector) {
        const test = this.#test(selector)
        return this.#next(this.nodes.filter((node, index) => !test(node, index)))
    }

    parent(selector) {
        return this.#filtered(this.nodes.flatMap(node => (node.parent && isElement(node.parent) ? [node.parent] : [])), selector)
    }

    parents(selector) {
        return this.#filtered(this.nodes.flatMap(ancestors), selector)
    }

    parentsUntil(selector, until) {
        return until === undefined
            ? this.#next(this.nodes.flatMap(node => takeUntil(ancestors(node), selector)))
            : this.#filtered(this.nodes.flatMap(node => takeUntil(ancestors(node), until)), selector)
    }

    prev(selector) {
        return this.#filtered(this.nodes.flatMap(node => siblingsBefore(node).slice(0, 1)), selector)
    }

    prevAll(selector) {
        return this.#filtered(this.nodes.flatMap(siblingsBefore), selector)
    }

    prevUntil(selector, until) {
        return until === undefined
            ? this.#next(this.nodes.flatMap(node => takeUntil(siblingsBefore(node), selector)))
            : this.#filtered(this.nodes.flatMap(node => takeUntil(siblingsBefore(node), until)), selector)
    }

    siblings(selector) {
        return this.#filtered(this.nodes.flatMap(node => [...siblingsBefore(node).reverse(), ...siblingsAfter(node)]), selector)
    }
}

/** `new Doc(html)`: the whole document as a selection; find() asks it */
export class Doc extends DocSelection {
    constructor(html) {
        super([parseDocument(String(html))])
    }
}

/** `LoadDoc(html)`: a function of a selector, as jQuery's $ */
export function LoadDoc(html) {
    const root = parseDocument(String(html))
    return selector => new DocSelection(selectAll(String(selector), root))
}
