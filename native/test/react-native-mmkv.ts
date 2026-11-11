// Vitest runs in Node, which cannot load MMKV's native module (and react-native itself is Flow source). The package ships
// its own in-memory instance for tests (what createMMKV returns under Jest/Vitest); this alias hands it out without the
// react-native import in front of it.
export { createMockMMKV as createMMKV } from "react-native-mmkv/lib/createMMKV/createMockMMKV"
