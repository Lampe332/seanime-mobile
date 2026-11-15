// geschrieben nach: Quelltext von whatwg-url-minimum 0.2.0 (liest beim Laden seine IDNA-Tabellen mit dem globalen atob); keine Vorlage

/*
 * whatwg-url-minimum reads its tables with the global atob while it loads, before install() runs. This module is
 * imported first and puts atob there early; install() then fixes it like the other helpers.
 */

import { atob } from "./base64.js"

globalThis.atob = atob
