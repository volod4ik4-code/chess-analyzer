package ua.chess.analyzer;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import android.os.Build;
import android.provider.Settings;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.Map;

/**
 * Аналізатор шахових партій для Android: сторінка програми (assets/www) у WebView.
 * Файли віддаються з адреси https://appassets.androidplatform.net/ (без інтернету),
 * Stockfish 19 працює всередині сторінки (WebAssembly).
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final int FILE_REQ = 7;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private ClipboardManager clipboard;
    private volatile boolean downloading;

    /**
     * Рівень Java-частини. Маленьке оновлення сторінки (*-web-nN.zip) ставиться, лише якщо N <= цього числа;
     * інакше потрібен повний APK. Піднімати, коли змінюється Bridge або щось інше в Java.
     */
    static final int NATIVE_LEVEL = 10;   // 1.26.0: версії X.Y.Z.N

    private File webDir() {
        return new File(getFilesDir(), "www");
    }

    private File engineDir() {
        return new File(getFilesDir(), "engine");
    }

    private static int[] ver(String s) {
        int[] v = new int[4];                      // 1.26.0: багфікс X.Y.Z.N
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("(\\d+)\\.(\\d+)\\.(\\d+)(?:\\.(\\d+))?").matcher(s == null ? "" : s);
        if (m.find()) for (int i = 0; i < 4; i++) v[i] = m.group(i + 1) == null ? 0 : Integer.parseInt(m.group(i + 1));
        return v;
    }

    private static int cmp(int[] a, int[] b) {
        for (int i = 0; i < 4; i++) if (a[i] != b[i]) return a[i] - b[i];
        return 0;
    }

    private static String readAll(InputStream in) throws IOException {
        java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        in.close();
        return out.toString("UTF-8");
    }

    private String webUpdateVersion() {
        try {
            return new JSONObject(readAll(new java.io.FileInputStream(new File(webDir(), "version.json")))).optString("version", "");
        } catch (Exception e) {
            return "";
        }
    }

    /** Після встановлення повного APK новішої версії старе маленьке оновлення вже не потрібне. */
    private void dropStaleWebUpdate() {
        try {
            String bundled = new JSONObject(readAll(getAssets().open("www/version.json"))).optString("version", "0.0.0");
            String over = webUpdateVersion();
            if (over.isEmpty() || cmp(ver(over), ver(bundled)) <= 0) deleteTree(webDir());
        } catch (Exception e) {
            deleteTree(webDir());
        }
    }

    private static void deleteTree(File f) {
        if (f.isDirectory()) {
            File[] list = f.listFiles();
            if (list != null) for (File c : list) deleteTree(c);
        }
        f.delete();
    }

    // ---- рушій: процес Stockfish; його рядки пачками передаються сторінці (window.__sfLines)
    private Process sf;
    private java.io.Writer sfIn;
    private final StringBuilder sfOut = new StringBuilder();
    private boolean sfFlushPending;
    private final android.os.Handler ui = new android.os.Handler(android.os.Looper.getMainLooper());

    private synchronized boolean startEngine() {
        stopEngine();
        try {
            File bin = new File(getApplicationInfo().nativeLibraryDir, "libstockfish.so");
            if (!bin.isFile()) return false;
            final Process p = new ProcessBuilder(bin.getAbsolutePath()).redirectErrorStream(true).start();
            sf = p;
            sfIn = new java.io.OutputStreamWriter(p.getOutputStream(), "UTF-8");
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        java.io.BufferedReader r = new java.io.BufferedReader(
                                new java.io.InputStreamReader(p.getInputStream(), "UTF-8"));
                        String line;
                        while ((line = r.readLine()) != null) {
                            // сторінці потрібні лише uciok/readyok/bestmove і рядки з оцінкою
                            if (line.startsWith("option") || (line.startsWith("info") && !line.contains(" pv "))) continue;
                            synchronized (sfOut) {
                                sfOut.append(line).append('\n');
                                if (!sfFlushPending) {
                                    sfFlushPending = true;
                                    ui.postDelayed(new Runnable() {
                                        @Override
                                        public void run() {
                                            String text;
                                            synchronized (sfOut) {
                                                text = sfOut.toString();
                                                sfOut.setLength(0);
                                                sfFlushPending = false;
                                            }
                                            if (web != null && !text.isEmpty())
                                                web.evaluateJavascript("window.__sfLines && window.__sfLines("
                                                        + JSONObject.quote(text) + ")", null);
                                        }
                                    }, 30);
                                }
                            }
                        }
                    } catch (IOException ignored) {
                    }
                }
            }).start();
            return true;
        } catch (Exception e) {
            sf = null;
            sfIn = null;
            return false;
        }
    }

    private synchronized void stopEngine() {
        if (sf == null) return;
        try {
            sfIn.write("quit\n");
            sfIn.flush();
        } catch (Exception ignored) {
        }
        sf.destroy();
        sf = null;
        sfIn = null;
    }

    private void js(final String code) {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(code, null);
            }
        });
    }

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
        dropStaleWebUpdate();
        // сповіщення про нові версії: фонова перевірка раз на 6 годин (Android 13+ просить дозвіл на сповіщення)
        UpdateJob.schedule(this);
        if (Build.VERSION.SDK_INT >= 33
                && checkSelfPermission("android.permission.POST_NOTIFICATIONS") != android.content.pm.PackageManager.PERMISSION_GRANTED) {
            requestPermissions(new String[]{"android.permission.POST_NOTIFICATIONS"}, 9);
        }

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(0xFF1F1D1B);
        root.setOnApplyWindowInsetsListener(new View.OnApplyWindowInsetsListener() {
            @Override
            public WindowInsets onApplyWindowInsets(View v, WindowInsets in) {
                v.setPadding(in.getSystemWindowInsetLeft(), in.getSystemWindowInsetTop(),
                        in.getSystemWindowInsetRight(), in.getSystemWindowInsetBottom());
                return in.consumeSystemWindowInsets();
            }
        });
        web = new WebView(this);
        web.setBackgroundColor(0xFF1F1D1B);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setTextZoom(100);
        s.setSupportZoom(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (!HOST.equals(u.getHost())) return null;
                String path = u.getPath();
                if (path == null || path.equals("/") || path.isEmpty()) path = "/index.html";
                if (path.contains("..")) return notFound();
                try {
                    // маленьке оновлення сторінки (files/www) і завантажений рушій «усі ядра» (files/engine)
                    // мають перевагу над файлами з APK
                    File over = new File(webDir(), path.substring(1));
                    File eng = new File(engineDir(), path.substring(1));
                    InputStream in = over.isFile() ? new java.io.FileInputStream(over)
                            : eng.isFile() ? new java.io.FileInputStream(eng)
                            : getAssets().open("www" + path, android.content.res.AssetManager.ACCESS_STREAMING);
                    String mime = mime(path);
                    WebResourceResponse r = new WebResourceResponse(mime,
                            mime.startsWith("text/") || mime.endsWith("json") ? "utf-8" : null, in);
                    Map<String, String> h = new HashMap<String, String>();
                    h.put("Cache-Control", "no-cache");
                    h.put("Access-Control-Allow-Origin", "https://" + HOST);
                    // cross-origin isolation: без неї рушій не може працювати на кількох ядрах
                    h.put("Cross-Origin-Opener-Policy", "same-origin");
                    h.put("Cross-Origin-Embedder-Policy", "require-corp");
                    h.put("Cross-Origin-Resource-Policy", "same-origin");
                    r.setResponseHeaders(h);
                    return r;
                } catch (IOException e) {
                    return notFound();
                }
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openExternal(u);
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                try {
                    startActivityForResult(Intent.createChooser(i, null), FILE_REQ);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
                return true;
            }
        });

        if (state != null) web.restoreState(state);
        else web.loadUrl("https://" + HOST + "/index.html");
    }

    private static WebResourceResponse notFound() {
        return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
    }

    private static String mime(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js") || p.endsWith(".mjs")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    private void openExternal(Uri u) {
        String sc = u.getScheme();
        if (sc == null || !(sc.equals("https") || sc.equals("http"))) return;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u));
        } catch (ActivityNotFoundException ignored) {
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQ) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.onAndroidBack && window.onAndroidBack()) ? 'yes' : 'no'",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String v) {
                        if (!"\"yes\"".equals(v)) finish();
                    }
                });
    }

    @Override
    protected void onDestroy() {
        stopEngine();
        if (web != null) {
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }

    /** Те, чого сторінка не вміє сама: буфер обміну, «Поділитися», зовнішні посилання, екран не гасне. */
    private class Bridge {
        @JavascriptInterface
        public String readClipboard() {
            try {
                ClipData cd = clipboard.getPrimaryClip();
                if (cd == null || cd.getItemCount() == 0) return "";
                CharSequence t = cd.getItemAt(0).coerceToText(MainActivity.this);
                return t == null ? "" : t.toString();
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void share(final String text, final String name) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType("text/plain");
                    send.putExtra(Intent.EXTRA_TEXT, text);
                    send.putExtra(Intent.EXTRA_SUBJECT, name);
                    try {
                        startActivity(Intent.createChooser(send, name));
                    } catch (ActivityNotFoundException ignored) {
                    }
                }
            });
        }

        @JavascriptInterface
        public void openUrl(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    openExternal(Uri.parse(url));
                }
            });
        }

        /** Завантажує новий APK у кеш програми; хід завантаження - у window.onUpdateProgress. */
        @JavascriptInterface
        public void downloadUpdate(final String url) {
            if (downloading || url == null || !url.startsWith("https://")) return;
            downloading = true;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    File part = new File(getCacheDir(), "update.apk.part");
                    HttpURLConnection con = null;
                    try {
                        con = (HttpURLConnection) new URL(url).openConnection();
                        con.setInstanceFollowRedirects(true);
                        con.setConnectTimeout(20000);
                        con.setReadTimeout(30000);
                        con.setRequestProperty("User-Agent", "ChessAnalyzer");
                        if (url.contains("api.github.com")) con.setRequestProperty("Accept", "application/octet-stream");
                        int code = con.getResponseCode();
                        if (code != 200) throw new IOException("HTTP " + code);
                        long total = con.getContentLength();
                        InputStream in = con.getInputStream();
                        FileOutputStream out = new FileOutputStream(part);
                        byte[] buf = new byte[65536];
                        long done = 0, last = 0;
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            out.write(buf, 0, n);
                            done += n;
                            if (done - last > 512 * 1024) {
                                last = done;
                                js("window.onUpdateProgress && window.onUpdateProgress(" + done + "," + total + ")");
                            }
                        }
                        out.close();
                        in.close();
                        File dst = ApkProvider.file(MainActivity.this);
                        if (dst.exists() && !dst.delete()) throw new IOException("cannot replace file");
                        if (!part.renameTo(dst)) throw new IOException("cannot save file");
                        js("window.onUpdateReady && window.onUpdateReady()");
                    } catch (Exception e) {
                        part.delete();
                        js("window.onUpdateError && window.onUpdateError(" + JSONObject.quote(String.valueOf(e.getMessage())) + ")");
                    } finally {
                        if (con != null) con.disconnect();
                        downloading = false;
                    }
                }
            }).start();
        }

        /** Уміє качати файли релізу через API GitHub (Accept: application/octet-stream). */
        @JavascriptInterface
        public boolean apiDownloads() {
            return true;
        }

        @JavascriptInterface
        public int nativeLevel() {
            return NATIVE_LEVEL;
        }

        /** Справжній Stockfish 19 для Android (lib/arm64-v8a/libstockfish.so) окремим процесом. */
        @JavascriptInterface
        public boolean engineStart() {
            return startEngine();
        }

        @JavascriptInterface
        public void engineSend(String cmd) {
            try {
                synchronized (MainActivity.this) {
                    if (sfIn != null) {
                        sfIn.write(cmd + "\n");
                        sfIn.flush();
                    }
                }
            } catch (IOException ignored) {
            }
        }

        @JavascriptInterface
        public void engineStop() {
            stopEngine();
        }

        /** Маленьке оновлення: zip зі сторінкою програми -> files/www (рушій лишається з APK). */
        @JavascriptInterface
        public void installWebUpdate(final String url) {
            unzipFrom(url, webDir(), "index.html", "version.json", "onWebUpdateReady", "onUpdateProgress", "onUpdateError");
        }

        /** Рушій «усі ядра» (stockfish-19.js/.wasm, mt-boot.js) -> files/engine/stockfish. */
        @JavascriptInterface
        public void downloadEngine(final String url) {
            unzipFrom(url, engineDir(), "stockfish/stockfish-19.wasm", "stockfish/mt-boot.js",
                    "onEngineReady", "onEngineProgress", "onEngineError");
        }

        @JavascriptInterface
        public boolean hasEngine() {
            return new File(engineDir(), "stockfish/stockfish-19.wasm").isFile();
        }

        @JavascriptInterface
        public void deleteEngine() {
            deleteTree(engineDir());
        }

        private void unzipFrom(final String url, final File target, final String must1, final String must2,
                               final String readyCb, final String progressCb, final String errCb) {
            if (downloading || url == null || !url.startsWith("https://")) return;
            downloading = true;
            new Thread(new Runnable() {
                @Override
                public void run() {
                    File tmp = new File(getFilesDir(), target.getName() + "_new");
                    HttpURLConnection con = null;
                    try {
                        deleteTree(tmp);
                        con = (HttpURLConnection) new URL(url).openConnection();
                        con.setInstanceFollowRedirects(true);
                        con.setConnectTimeout(20000);
                        con.setReadTimeout(30000);
                        con.setRequestProperty("User-Agent", "ChessAnalyzer");
                        if (url.contains("api.github.com")) con.setRequestProperty("Accept", "application/octet-stream");
                        if (con.getResponseCode() != 200) throw new IOException("HTTP " + con.getResponseCode());
                        long total = con.getContentLength(), done = 0;
                        java.util.zip.ZipInputStream zin = new java.util.zip.ZipInputStream(
                                new java.io.BufferedInputStream(con.getInputStream()));
                        String base = tmp.getCanonicalPath() + File.separator;
                        byte[] buf = new byte[65536];
                        java.util.zip.ZipEntry e;
                        while ((e = zin.getNextEntry()) != null) {
                            File out = new File(tmp, e.getName());
                            if (!out.getCanonicalPath().startsWith(base)) throw new IOException("bad entry");
                            if (e.isDirectory()) { out.mkdirs(); continue; }
                            out.getParentFile().mkdirs();
                            FileOutputStream fo = new FileOutputStream(out);
                            int n;
                            long last = 0;
                            while ((n = zin.read(buf)) > 0) {
                                fo.write(buf, 0, n);
                                done += n;
                                if (done - last > 1024 * 1024) {
                                    last = done;
                                    js("window." + progressCb + " && window." + progressCb + "(" + Math.min(done, total) + "," + total + ")");
                                }
                            }
                            fo.close();
                        }
                        zin.close();
                        if (!new File(tmp, must1).isFile() || !new File(tmp, must2).isFile())
                            throw new IOException("incomplete download");
                        deleteTree(target);
                        if (!tmp.renameTo(target)) throw new IOException("cannot install");
                        js("window." + readyCb + " && window." + readyCb + "()");
                    } catch (Exception ex) {
                        deleteTree(tmp);
                        js("window." + errCb + " && window." + errCb + "(" + JSONObject.quote(String.valueOf(ex.getMessage())) + ")");
                    } finally {
                        if (con != null) con.disconnect();
                        downloading = false;
                    }
                }
            }).start();
        }

        /** Відкриває установник Android для завантаженого оновлення. */
        @JavascriptInterface
        public String installUpdate() {
            if (!ApkProvider.file(MainActivity.this).exists()) return "missing";
            if (Build.VERSION.SDK_INT >= 26 && !getPackageManager().canRequestPackageInstalls()) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + getPackageName())));
                        } catch (ActivityNotFoundException ignored) {
                        }
                    }
                });
                return "permission";
            }
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setDataAndType(ApkProvider.uri(), "application/vnd.android.package-archive");
                    i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    try {
                        startActivity(i);
                    } catch (ActivityNotFoundException ignored) {
                    }
                }
            });
            return "ok";
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
    }
}
