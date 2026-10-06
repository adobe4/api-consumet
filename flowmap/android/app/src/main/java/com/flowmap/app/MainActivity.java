package com.flowmap.app;

import android.Manifest;
import android.app.Activity;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.Environment;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.RenderProcessGoneDetail;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * FlowMap for Android: the live site (flowmap-tau.vercel.app) in a fast, full-screen WebView, plus the phone
 * things a browser tab cannot do well: saving exports to Downloads, printing invoices, the share sheet, the back
 * button, status bar colours that follow the app's theme, and opening FlowMap links in the app.
 * The site itself does the rest, so most updates need no new APK.
 */
public class MainActivity extends Activity {
    private static final String HOME = BuildConfig.HOME_URL;
    private static final String HOST = Uri.parse(HOME).getHost();
    private static final String SCHEME = Uri.parse(HOME).getScheme();
    private static final String OFFLINE = "file:///android_asset/offline.html";
    private static final int PICK_FILES = 1;

    private FrameLayout root;
    private WebView web;
    private SharedPreferences prefs;
    private int barColor;
    private boolean barDark;
    private boolean ready;
    private String failedUrl;
    private volatile boolean trustedPage;
    private ValueCallback<Uri[]> fileCallback;
    private View fullView;
    private WebChromeClient.CustomViewCallback fullCallback;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        prefs = getSharedPreferences("flowmap", MODE_PRIVATE);
        barColor = prefs.getInt("barColor", 0xFF1D1C1A);
        barDark = prefs.getBoolean("barDark", true);

        root = new FrameLayout(this);
        web = new WebView(this);
        web.setBackgroundColor(barColor);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        setupInsets();
        applyBars();
        holdSplash();
        setupWebView();

        if (state != null && web.restoreState(state) != null) return;
        web.loadUrl(urlFrom(getIntent()));
    }

    // ---------- screen edges ----------
    // The page sits between the status bar and the navigation bar (and above the keyboard); the strips behind
    // the bars take the page's background colour, so it looks edge to edge.
    private void setupInsets() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            w.setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                if (fullView != null) { v.setPadding(0, 0, 0, 0); return WindowInsets.CONSUMED; }
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            });
        }
    }

    private void applyBars() {
        Window w = getWindow();
        if (ready) {
            w.setBackgroundDrawable(new ColorDrawable(barColor));
            root.setBackgroundColor(barColor);
        }
        w.setStatusBarColor(barColor);
        w.setNavigationBarColor(barColor);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(barDark ? 0 : light, light);
            }
        } else {
            View d = w.getDecorView();
            int f = d.getSystemUiVisibility() & ~(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            if (!barDark) f |= View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
            d.setSystemUiVisibility(f);
        }
    }

    // the splash (logo on the app colour) is the window background; the page stays hidden over it until it has
    // drawn something, at most 3 seconds. Drawing is never held back, so the app always answers at once.
    private void holdSplash() {
        web.setVisibility(View.INVISIBLE);
        root.postDelayed(this::markReady, 3000);
    }

    private void markReady() {
        if (ready) return;
        ready = true;
        web.setVisibility(View.VISIBLE);
        applyBars();
    }

    // ---------- the WebView ----------
    private void setupWebView() {
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true); // test builds only: inspect the page from a computer
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setTextZoom(100); // the app has its own sizes; big system fonts must not break the board
        s.setUseWideViewPort(true);
        s.setLoadWithOverviewMode(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setSupportMultipleWindows(false);
        s.setOffscreenPreRaster(true);
        s.setUserAgentString(s.getUserAgentString() + " FlowMapApp/" + BuildConfig.VERSION_NAME);

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "FlowMapAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (isOurs(u)) return false;
                openOutside(u);
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                trustedPage = isOurs(Uri.parse(url));
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                markReady();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (!req.isForMainFrame() || OFFLINE.equals(req.getUrl().toString())) return;
                failedUrl = req.getUrl().toString();
                view.loadUrl(OFFLINE);
                markReady();
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                // the page's engine stopped (low memory): start it again instead of closing the app
                root.removeView(web);
                web.destroy();
                web = new WebView(MainActivity.this);
                web.setBackgroundColor(barColor);
                root.addView(web, 0, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                setupWebView();
                web.loadUrl(HOME);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(i, PICK_FILES);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }

            // full screen (presenting, the full-screen button, videos)
            @Override
            public void onShowCustomView(View view, CustomViewCallback cb) {
                if (fullView != null) { cb.onCustomViewHidden(); return; }
                fullView = view;
                fullCallback = cb;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                setFullScreen(true);
            }

            @Override
            public void onHideCustomView() {
                if (fullView == null) return;
                root.removeView(fullView);
                fullView = null;
                if (fullCallback != null) fullCallback.onCustomViewHidden();
                fullCallback = null;
                setFullScreen(false);
            }
        });

        web.setDownloadListener((url, userAgent, disposition, mime, length) -> {
            if (!url.startsWith("http")) return; // blob: files come through the bridge (saveFile)
            try {
                DownloadManager.Request r = new DownloadManager.Request(Uri.parse(url));
                String name = URLUtil.guessFileName(url, disposition, mime);
                r.setMimeType(mime);
                r.addRequestHeader("User-Agent", userAgent);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) r.addRequestHeader("Cookie", cookies);
                r.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                r.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "FlowMap/" + name);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(r);
                toast("Downloading " + name);
            } catch (Exception e) {
                openOutside(Uri.parse(url));
            }
        });
    }

    private void setFullScreen(boolean on) {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                if (on) {
                    c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                    c.hide(WindowInsets.Type.systemBars());
                } else c.show(WindowInsets.Type.systemBars());
            }
            root.requestApplyInsets();
        } else {
            View d = w.getDecorView();
            int f = View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY;
            d.setSystemUiVisibility(on ? d.getSystemUiVisibility() | f : d.getSystemUiVisibility() & ~f);
        }
    }

    private boolean isOurs(Uri u) {
        return u != null && SCHEME.equals(u.getScheme()) && HOST.equals(u.getHost()) && Uri.parse(HOME).getPort() == u.getPort();
    }

    // other sites, YouTube, WhatsApp, phone numbers, email: the phone's own apps
    private void openOutside(Uri u) {
        try {
            Intent i;
            if ("intent".equals(u.getScheme())) {
                i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
            } else {
                i = new Intent(Intent.ACTION_VIEW, u);
            }
            startActivity(i);
        } catch (Exception e) {
            toast("No app can open this link");
        }
    }

    private String urlFrom(Intent intent) {
        Uri u = intent == null ? null : intent.getData();
        return isOurs(u) ? u.toString() : HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri u = intent.getData();
        if (isOurs(u)) web.loadUrl(u.toString());
    }

    // ---------- back button ----------
    @Override
    protected void onPostCreate(Bundle state) {
        super.onPostCreate(state);
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBack);
        }
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        goBack();
    }

    // the page closes the newest thing first (a dialog, a menu, presenting, the open board); then pages; then
    // the app goes to the background, ready to come back instantly
    private void goBack() {
        if (fullView != null) {
            web.getWebChromeClient().onHideCustomView();
            return;
        }
        web.evaluateJavascript("(function(){try{return window.__fmBack&&window.__fmBack()?1:0}catch(e){return 0}})()", v -> {
            if ("1".equals(v)) return;
            if (web.canGoBack() && !OFFLINE.equals(web.getUrl())) web.goBack();
            else moveTaskToBack(true);
        });
    }

    // ---------- files ----------
    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != PICK_FILES || fileCallback == null) return;
        Uri[] out = null;
        if (result == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                out = new Uri[clip.getItemCount()];
                for (int i = 0; i < out.length; i++) out[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                out = new Uri[] { data.getData() };
            }
        }
        fileCallback.onReceiveValue(out);
        fileCallback = null;
    }

    private String save(String name, String mime, byte[] bytes) throws Exception {
        String safe = name.replaceAll("[\\\\/:*?\"<>|\\n\\r]", "_");
        if (safe.isEmpty()) safe = "flowmap-file";
        if (Build.VERSION.SDK_INT >= 29) {
            ContentResolver cr = getContentResolver();
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.Downloads.DISPLAY_NAME, safe);
            cv.put(MediaStore.Downloads.MIME_TYPE, mime);
            cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/FlowMap");
            cv.put(MediaStore.Downloads.IS_PENDING, 1);
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new Exception("Could not save the file");
            try (OutputStream o = cr.openOutputStream(uri)) {
                if (o == null) throw new Exception("Could not save the file");
                o.write(bytes);
            }
            cv.clear();
            cv.put(MediaStore.Downloads.IS_PENDING, 0);
            cr.update(uri, cv, null, null);
        } else {
            if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
                runOnUiThread(() -> requestPermissions(new String[] { Manifest.permission.WRITE_EXTERNAL_STORAGE }, 2));
                return "Allow FlowMap to save files, then tap again";
            }
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "FlowMap");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Could not open Downloads");
            try (FileOutputStream o = new FileOutputStream(new File(dir, safe))) { o.write(bytes); }
        }
        final String shown = safe;
        runOnUiThread(() -> toast("Saved to Downloads/FlowMap/" + shown));
        return "";
    }

    // ---------- printing (invoices) ----------
    private void print(String title) {
        PrintManager pm = (PrintManager) getSystemService(Context.PRINT_SERVICE);
        final PrintDocumentAdapter inner = web.createPrintDocumentAdapter(title);
        PrintDocumentAdapter outer = new PrintDocumentAdapter() {
            @Override public void onStart() { inner.onStart(); }
            @Override public void onLayout(PrintAttributes o, PrintAttributes n, CancellationSignal c, LayoutResultCallback cb, Bundle extras) { inner.onLayout(o, n, c, cb, extras); }
            @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal c, WriteResultCallback cb) { inner.onWrite(pages, dest, c, cb); }
            @Override public void onFinish() {
                inner.onFinish();
                web.evaluateJavascript("window.__fmPrinted&&window.__fmPrinted()", null);
            }
        };
        pm.print(title, outer, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build());
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    // ---------- the bridge the page talks to (window.FlowMapAndroid) ----------
    // Only FlowMap's own pages may use it; the site's security rules allow no other site's frames.
    final class Bridge {
        @JavascriptInterface
        public String version() { return BuildConfig.VERSION_NAME; }

        @JavascriptInterface
        public String saveFile(String name, String mime, String base64) {
            if (!trustedPage) return "Not allowed";
            try {
                return save(name == null ? "" : name, mime == null || mime.isEmpty() ? "application/octet-stream" : mime, Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception e) {
                return e.getMessage() == null ? "Could not save the file" : e.getMessage();
            }
        }

        @JavascriptInterface
        public void share(String title, String text, String url) {
            if (!trustedPage) return;
            String body = text == null ? "" : text;
            if (url != null && !url.isEmpty() && !body.contains(url)) body = body.isEmpty() ? url : body + "\n" + url;
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, body);
            if (title != null && !title.isEmpty()) i.putExtra(Intent.EXTRA_SUBJECT, title);
            final Intent chooser = Intent.createChooser(i, title == null || title.isEmpty() ? "Share" : title);
            runOnUiThread(() -> startActivity(chooser));
        }

        @JavascriptInterface
        public void copy(String text) {
            if (!trustedPage) return;
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                cm.setPrimaryClip(ClipData.newPlainText("FlowMap", text == null ? "" : text));
            });
        }

        @JavascriptInterface
        public void print(String title) {
            if (!trustedPage) return;
            runOnUiThread(() -> MainActivity.this.print(title == null || title.isEmpty() ? "FlowMap" : title));
        }

        @JavascriptInterface
        public void haptic(String kind) {
            runOnUiThread(() -> web.performHapticFeedback("heavy".equals(kind) ? HapticFeedbackConstants.LONG_PRESS
                : Build.VERSION.SDK_INT >= 27 ? HapticFeedbackConstants.KEYBOARD_PRESS : HapticFeedbackConstants.VIRTUAL_KEY));
        }

        @JavascriptInterface
        public void setBars(String color, boolean dark) {
            try {
                final int c = Color.parseColor(color);
                runOnUiThread(() -> {
                    barColor = c;
                    barDark = dark;
                    prefs.edit().putInt("barColor", c).putBoolean("barDark", dark).apply();
                    web.setBackgroundColor(c);
                    applyBars();
                });
            } catch (IllegalArgumentException ignored) {
                // not a colour
            }
        }

        @JavascriptInterface
        public void ready() { runOnUiThread(MainActivity.this::markReady); }

        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> web.loadUrl(failedUrl != null ? failedUrl : HOME));
        }
    }

    // ---------- lifecycle ----------
    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        if (web != null) {
            root.removeView(web);
            web.destroy();
        }
        super.onDestroy();
    }
}
