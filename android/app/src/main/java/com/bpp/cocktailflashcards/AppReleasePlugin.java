package com.bpp.cocktailflashcards;

import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Logger;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Which binary is this? The APK's own versionCode and versionName.
 *
 * <p>The shell loads the deployed site (capacitor.config.json → server.url), so
 * every number the web bundle knows about itself — {@code __APP_VERSION__}, the
 * build stamp — describes the site and not the APK around it. A phone can be
 * running today's JavaScript inside a binary from months ago, and nothing in
 * that JavaScript could tell. This plugin is the one thing that can.
 *
 * <p>That gap is not hypothetical. A tester reported sign-in failing on an
 * install whose bridge listed no FirebaseAuthentication — an APK from before
 * the plugin shipped — and the diagnostics line under the error said "app
 * 1.3.5", the version of the site it had just loaded. The number that would
 * have ended the exchange in one message, versionCode, was the one number
 * nothing on the device could report. See docs/mobile-google-signin.md.
 *
 * <p>Registered in {@link CocktailActivity}; the JavaScript end is
 * src/app-release.js.
 */
@CapacitorPlugin(name = "AppRelease")
public class AppReleasePlugin extends Plugin {

    private static final String TAG = "AppRelease";

    /**
     * The running binary's versionCode and versionName.
     *
     * <p>Read from PackageManager rather than from {@code BuildConfig} so the
     * answer is what Android actually installed, and so this compiles whatever
     * the app module's {@code buildConfig} build feature is set to.
     */
    @PluginMethod
    public void get(PluginCall call) {
        try {
            PackageInfo info = getContext()
                .getPackageManager()
                .getPackageInfo(getContext().getPackageName(), 0);

            JSObject result = new JSObject();
            result.put("versionCode", versionCodeOf(info));
            result.put("versionName", info.versionName);
            call.resolve(result);
        } catch (PackageManager.NameNotFoundException e) {
            // Its own package, so this cannot happen in a running app. Reject
            // rather than crash: the caller treats any failure as "unknown",
            // and a footer is not worth taking the app down for.
            Logger.error(TAG, "Package manager does not know this package", e);
            call.reject("Could not read the app's release number", e);
        }
    }

    /**
     * versionCode as a long, on both sides of API 28.
     *
     * <p>{@code getLongVersionCode} is the one to use where it exists — the
     * field it replaces is the low 32 bits of it — but minSdk is 24, so the
     * deprecated field is still the only answer on the oldest devices we run
     * on. androidx's PackageInfoCompat would collapse this, and is not on this
     * module's compile classpath: capacitor-android pulls androidx.core in as
     * {@code implementation}, which does not transit to us.
     */
    @SuppressWarnings("deprecation")
    private static long versionCodeOf(PackageInfo info) {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
            ? info.getLongVersionCode()
            : info.versionCode;
    }
}
