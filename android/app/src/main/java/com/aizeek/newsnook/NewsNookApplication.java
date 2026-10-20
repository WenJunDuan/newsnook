package com.aizeek.newsnook;

import android.app.Application;
import android.content.Context;
import android.os.Process;

/** Keep upgrade cleanup for storage owned by the retired private browser process. */
public final class NewsNookApplication extends Application {
    @Override protected void attachBaseContext(Context base) {
        super.attachBaseContext(base);
        // Permissionless PDF worker processes must not initialize application storage services.
        if (Process.myUid() == base.getApplicationInfo().uid) LegacyPrivateBrowserCleanup.sweep(base);
    }
}
