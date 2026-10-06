# FlowMap for Android

A small native app that opens https://flowmap-tau.vercel.app full screen. It adds what a browser tab can't do well: saving exports to Downloads, printing invoices, the share sheet, the back button, status bar colours that follow the theme, and opening FlowMap links in the app. The page talks to it through `window.FlowMapAndroid` (see `public/js/native.js`).

Because the app shows the live site, most FlowMap updates reach phones without a new APK.

## Build

Needs JDK 17+ and the Android SDK (platform 35, build-tools 35).

```sh
echo "sdk.dir=/path/to/android-sdk" > local.properties
./gradlew assembleRelease
cp app/build/outputs/apk/release/app-release.apk ../public/download/flowmap.apk
```

Raise `versionCode` in `app/build.gradle` for every APK you publish.

## Signing

Release builds are signed with the key named in `keystore.properties`. That file and the key are never committed:

```
storeFile=/path/to/flowmap-release.p12
storePassword=…
keyAlias=flowmap
keyPassword=…
```

Phones only accept an update that is signed with the same key as the installed app. Without `keystore.properties` the build falls back to the debug key; that APK installs, but it cannot update an app signed with the release key.

`public/.well-known/assetlinks.json` holds the release key's SHA-256 fingerprint, so FlowMap links open straight in the app. Update it if the key ever changes.

## Test against a local server

```sh
./gradlew assembleDebug -PhomeUrl=http://10.0.2.2:8820/
```

The emulator reaches the computer's localhost as 10.0.2.2. Plain-HTTP traffic is allowed only in debug builds.
