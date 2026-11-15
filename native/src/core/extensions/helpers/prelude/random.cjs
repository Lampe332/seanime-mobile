// geschrieben nach: Doku von crypto-js 4 (Zufall über `crypto.getRandomValues`) und MDN zu Crypto.getRandomValues; keine Vorlage

/*
 * crypto-js asks for `require("crypto")` when it needs random bytes (the salt of a passphrase, WordArray.random). The
 * sandbox has no source of secure randomness, so the bundle script hands it this instead: Math.random of the engine.
 * Good enough for a salt that only has to differ; not for keys. Only crypto-js sees it, the extension does not.
 */

module.exports = {
    getRandomValues(array) {
        for (let i = 0; i < array.length; i++) array[i] = Math.floor(Math.random() * 0x100000000)
        return array
    },
}
