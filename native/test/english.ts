import { storage } from "@/lib/storage"

// Without a stored choice the app follows the device language (lib/app-language.ts), here the language of the machine
// running the tests. The tests expect the English texts, so every test file starts with English chosen.
storage.set("seanime-mobile-language", JSON.stringify("en"))
