# The page calls these by name through window.FlowMapAndroid
-keepclassmembers class com.flowmap.app.MainActivity$Bridge {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface
