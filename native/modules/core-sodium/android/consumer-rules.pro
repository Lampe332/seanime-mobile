# The JNI functions are found by the class and method names (sodium-jni.c): R8 must not rename them
-keepclasseswithmembernames,includedescriptorclasses class com.seanime.coresodium.SodiumNative {
    native <methods>;
}
