package com.aizeek.newsnook;

import android.app.Application;
import android.content.Context;
import android.os.Process;
import android.os.SystemClock;
import android.util.Log;
import androidx.annotation.NonNull;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewOutcomeReceiver;
import androidx.webkit.WebViewStartUpConfig;
import androidx.webkit.WebViewStartUpResult;
import androidx.webkit.WebViewStartupException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Keep upgrade cleanup for storage owned by the retired private browser process. */
public final class NewsNookApplication extends Application {
    @Override public void onCreate() {
        super.onCreate();
        if (Process.myUid() != getApplicationInfo().uid) return; // isolated PDF worker

        // WebView is required for our primary UI. Advance its background-only startup
        // during Activity creation, without waiting for a startup callback or blocking
        // the main thread with additional WebView UI initialization.
        ExecutorService background = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "NewsNookWebViewWarmup");
            thread.setDaemon(true);
            return thread;
        });
        try {
            WebViewStartUpConfig config = new WebViewStartUpConfig.Builder(background)
                .setShouldRunUiThreadStartUpTasks(false)
                .build();
            Log.i("NewsNookStartup", "async-webview-start-requested elapsed=" + SystemClock.elapsedRealtime() + "ms");
            WebViewCompat.startUpWebView(this, config,
                new WebViewOutcomeReceiver<WebViewStartUpResult, WebViewStartupException>() {
                    @Override public void onResult(@NonNull WebViewStartUpResult result) {
                        Log.i("NewsNookStartup", "async-webview-start-complete elapsed=" + SystemClock.elapsedRealtime() + "ms");
                        background.shutdown();
                    }
                    @Override public void onError(@NonNull WebViewStartupException error) {
                        Log.w("NewsNookStartup", "Async WebView startup unavailable; normal startup continues", error);
                        background.shutdown();
                    }
                });
        } catch (RuntimeException | LinkageError error) {
            Log.w("NewsNookStartup", "Async WebView startup not supported; using normal startup", error);
            background.shutdown();
        }
    }

    @Override protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        android.util.Log.i("NewsNookStartup", "application-attachBaseContext elapsed=" + android.os.SystemClock.elapsedRealtime() + "ms");
        // Permissionless PDF worker processes must not initialize application storage services.
        if (Process.myUid() == base.getApplicationInfo().uid) LegacyPrivateBrowserCleanup.sweep(base);
    }
}
